const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createActionExecutor } = require("../src/services/actions/actionExecutor");
const { createPermissionRouter } = require("../src/routes/permissionRoutes");

const makeExecutor = (permissions = new Map()) => {
  const executions = [];
  const executor = createActionExecutor({
    check: async ({ userId, provider, action }) => {
      const decision = permissions.get(`${userId}:${provider}:${action}`) || null;
      return { allowed: decision === "always_allow", requiresApproval: !decision, decision };
    },
    save: async ({ userId, provider, action, decision }) => permissions.set(`${userId}:${provider}:${action}`, decision),
    getProvider: () => ({ capabilities: ["gmail.draft", "gmail.send", "gmail.draft.reply", "calendar.create", "calendar.delete"], execute: async (input) => { executions.push(input); return { id: "safe" }; } }),
    audit: async () => {},
  });
  return { executor, permissions, executions };
};

test("allow_once executes but does not persist", async () => {
  const { executor, permissions, executions } = makeExecutor();
  const result = await executor({ user: { _id: "u1" }, provider: "google", action: "gmail.draft", approval: "allow_once" });
  assert.equal(result.status, "success");
  assert.equal(executions.length, 1);
  assert.equal(permissions.size, 0);
});

test("always_allow executes, persists, and skips approval for the identical next action", async () => {
  const { executor, permissions, executions } = makeExecutor();
  const first = await executor({ user: { _id: "u1" }, provider: "google", action: "gmail.draft", approval: "always_allow" });
  const second = await executor({ user: { _id: "u1" }, provider: "google", action: "gmail.draft" });
  assert.equal(first.status, "success");
  assert.equal(permissions.get("u1:google:gmail.draft"), "always_allow");
  assert.equal(second.status, "success");
  assert.equal(executions.length, 2);
});

test("deny never calls the provider", async () => {
  const { executor, executions } = makeExecutor();
  const result = await executor({ user: { _id: "u1" }, provider: "google", action: "gmail.draft", approval: "deny" });
  assert.equal(result.status, "denied");
  assert.equal(executions.length, 0);
});

test("gmail draft grants never authorize send or draft reply", async () => {
  const { executor } = makeExecutor();
  await executor({ user: { _id: "u1" }, provider: "google", action: "gmail.draft", approval: "always_allow" });
  const send = await executor({ user: { _id: "u1" }, provider: "google", action: "gmail.send" });
  const reply = await executor({ user: { _id: "u1" }, provider: "google", action: "gmail.draft.reply" });
  assert.equal(send.status, "approval_required");
  assert.equal(reply.status, "approval_required");
});

// Calendar mutations follow the identical per-action permission model as
// Gmail — no special-casing, no provider-wide grant, and a grant for one
// mutating action never authorizes a different one.
test("calendar mutations require approval per-action, exactly like Gmail", async () => {
  const { executor, permissions } = makeExecutor();
  const create = await executor({ user: { _id: "u1" }, provider: "google", action: "calendar.create" });
  assert.equal(create.status, "approval_required");
  const approved = await executor({ user: { _id: "u1" }, provider: "google", action: "calendar.create", approval: "always_allow" });
  assert.equal(approved.status, "success");
  assert.equal(permissions.get("u1:google:calendar.create"), "always_allow");
  // A grant for calendar.create does not authorize calendar.delete.
  const del = await executor({ user: { _id: "u1" }, provider: "google", action: "calendar.delete" });
  assert.equal(del.status, "approval_required");
});

test("revoking one always_allow permission leaves unrelated permissions and Google connection untouched", async (t) => {
  const permissions = new Map([
    ["u1:google:gmail.draft", "always_allow"],
    ["u1:google:gmail.send", "always_allow"],
  ]);
  let googleDisconnected = false;
  const app = express();
  app.use("/api/permissions", createPermissionRouter({
    authMiddleware: (req, res, next) => { req.user = { uid: "u1" }; next(); },
    getUser: async () => ({ _id: "u1" }),
    list: async () => [...permissions.entries()].map(([key, decision]) => {
      const [, provider, action] = key.split(":");
      return { provider, action, decision };
    }),
    revoke: async ({ userId, provider, action }) => {
      const key = `${userId}:${provider}:${action}`;
      const deletedCount = permissions.delete(key) ? 1 : 0;
      return { deletedCount };
    },
  }));
  const server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/permissions/google/gmail.draft`, { method: "DELETE" });
  assert.equal(response.status, 200);
  assert.equal(permissions.has("u1:google:gmail.draft"), false);
  assert.equal(permissions.get("u1:google:gmail.send"), "always_allow");
  assert.equal(googleDisconnected, false);
  const { executor } = makeExecutor(permissions);
  const nextDraft = await executor({ user: { _id: "u1" }, provider: "google", action: "gmail.draft" });
  assert.equal(nextDraft.status, "approval_required");
});
