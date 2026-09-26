const test = require("node:test");
const assert = require("node:assert/strict");
const { createEmailDomainCheck, suggestKnownProviderTypo } = require("../src/services/validation/emailDomainCheck");

test("known providers pass without a DNS lookup", async () => {
  const { checkEmailDomain } = createEmailDomainCheck({ resolveMailServer: async () => { throw new Error("should not be called"); } });
  const result = await checkEmailDomain("paul@gmail.com");
  assert.deepEqual(result, { status: "ok" });
});

test("a close typo of a known provider is suggested, not silently corrected", async () => {
  const { checkEmailDomain } = createEmailDomainCheck({ resolveMailServer: async () => { throw new Error("should not be called"); } });
  const result = await checkEmailDomain("oreoluwapaul0110@gmal.com");
  assert.equal(result.status, "likely_typo");
  assert.equal(result.suggestion, "gmail.com");
  assert.equal(result.correctedEmail, "oreoluwapaul0110@gmail.com");
});

test("a short unrelated domain is never flagged as a provider typo", () => {
  assert.equal(suggestKnownProviderTypo("acme.co"), null);
  assert.equal(suggestKnownProviderTypo("nomi.dev"), null);
});

test("an unfamiliar domain with a real mail server is treated as valid (custom company domain)", async () => {
  const { checkEmailDomain } = createEmailDomainCheck({ resolveMailServer: async (domain) => domain === "acme.com" });
  const result = await checkEmailDomain("hr@acme.com");
  assert.deepEqual(result, { status: "ok" });
});

test("a domain with no mail server at all is flagged, not silently allowed", async () => {
  const { checkEmailDomain } = createEmailDomainCheck({ resolveMailServer: async () => false });
  const result = await checkEmailDomain("someone@totallymadeupdomainxyz123.com");
  assert.deepEqual(result, { status: "no_mail_server", domain: "totallymadeupdomainxyz123.com" });
});

test("an unparseable address returns unknown without a DNS lookup", async () => {
  const { checkEmailDomain } = createEmailDomainCheck({ resolveMailServer: async () => { throw new Error("should not be called"); } });
  assert.deepEqual(await checkEmailDomain("not-an-email"), { status: "unknown" });
});
