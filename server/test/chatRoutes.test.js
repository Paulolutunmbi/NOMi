const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const { createChatRouter, sanitizeChatMetadata } = require("../src/routes/chatRoutes");

const makeQuery = (items) => ({
  direction: 1, count: items.length,
  sort(sort) { this.direction = Object.values(sort)[0]; return this; },
  limit(count) { this.count = count; return this; },
  lean: async function lean() { return [...items].sort((a, b) => this.direction * (a.createdAt - b.createdAt)).slice(0, this.count); },
});

test("persistent Gmail and Calendar chats reload for their owner and remain account-isolated", async (t) => {
  const chats = [];
  const messages = [];
  const ChatSession = {
    find: (filter) => makeQuery(chats.filter((item) => String(item.user) === String(filter.user))),
    findOne: async (filter) => chats.find((item) => String(item._id) === String(filter._id) && String(item.user) === String(filter.user)) || null,
    findOneAndUpdate: async (filter, update) => {
      let item = chats.find((chat) => String(chat.user) === String(filter.user) && chat.type === filter.type);
      if (!item) { item = { _id: new mongoose.Types.ObjectId(), user: filter.user, type: filter.type, title: null, summary: "", lastMessageAt: new Date(), metadata: {} }; chats.push(item); }
      return item;
    },
    updateOne: async (filter, update) => { const item = chats.find((chat) => String(chat._id) === String(filter._id) && String(chat.user) === String(filter.user)); if (item) Object.assign(item, update.$set); },
  };
  const ChatMessage = {
    find: (filter) => makeQuery(messages.filter((item) => String(item.chat) === String(filter.chat) && String(item.user) === String(filter.user))),
    create: async (item) => { const saved = { ...item, _id: new mongoose.Types.ObjectId(), createdAt: new Date(Date.now() + messages.length) }; messages.push(saved); return saved; },
  };
  const app = express(); app.use(express.json());
  app.use("/api/chats", createChatRouter({
    authMiddleware: (req, _res, next) => { req.user = { sub: req.header("x-user") || "user-a" }; next(); },
    getUser: async (claims) => ({ _id: claims.sub }), chatSessionModel: ChatSession, chatMessageModel: ChatMessage,
  }));
  const server = app.listen(0); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/chats`;
  const create = async (type, owner = "user-a") => fetch(base, { method: "POST", headers: { "content-type": "application/json", "x-user": owner }, body: JSON.stringify({ type }) }).then((r) => r.json());
  const gmail = (await create("gmail")).chat;
  const calendar = (await create("calendar")).chat;
  assert.equal((await create("gmail")).chat.id, gmail.id);
  assert.notEqual(calendar.id, gmail.id);
  for (let index = 0; index < 24; index += 1) {
    const response = await fetch(`${base}/${gmail.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "user", content: `Find Paul ${index} ${"x".repeat(300)}` }) });
    assert.equal(response.status, 201);
  }
  const reloaded = await fetch(`${base}/${gmail.id}/messages`).then((r) => r.json());
  assert.equal(reloaded.messages.length, 24);
  assert.equal(reloaded.messages[0].content.startsWith("Find Paul 0"), true);
  assert.ok(reloaded.chat.summary.length <= 5000);
  const denied = await fetch(`${base}/${gmail.id}/messages`, { headers: { "x-user": "user-b" } });
  assert.equal(denied.status, 404);
  const listB = await fetch(base, { headers: { "x-user": "user-b" } }).then((r) => r.json());
  assert.equal(listB.chats.length, 0);
  assert.ok(gmail.summary.length <= 5000);
});

test("chat transcript metadata strips binary payload fields", () => {
  const safe = sanitizeChatMetadata("user", { attachments: [{ filename: "photo.png", mimeType: "image/png", size: 25, data: "base64-data", buffer: Buffer.from("raw") }] });
  assert.deepEqual(safe.attachments, [{ filename: "photo.png", mimeType: "image/png", size: 25 }]);
  const assistant = sanitizeChatMetadata("assistant", { kind: "success", result: { buffer: "raw", data: "bytes", status: "ok" } });
  assert.deepEqual(assistant.result, { status: "ok" });
});
