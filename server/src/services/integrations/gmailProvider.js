const SUPPORTED_ACTIONS = new Set([
  "gmail.search", "gmail.read", "gmail.draft", "gmail.send", "gmail.draft.reply", "gmail.send.reply",
]);

const MAX_RESULTS = 50;
const MAX_QUERY_LENGTH = 500;
const MAX_BODY_LENGTH = 20 * 1024;
const MAX_SNIPPET_LENGTH = 1000;
const MAX_HEADER_LENGTH = 500;
const EMAIL = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

const safeError = (code, message) => Object.assign(new Error(message), { code, safe: true });

const normalizeGoogleError = (error, { messageNotFound = false } = {}) => {
  if (error?.safe) return error;
  const status = Number(error?.code || error?.response?.status || error?.status);
  const reason = String(error?.response?.data?.error?.errors?.[0]?.reason || error?.message || "").toLowerCase();
  if (messageNotFound && status === 404) return safeError("gmail_message_not_found", "The selected Gmail message was not found");
  if (status === 401 || reason.includes("invalid_grant") || reason.includes("invalid credentials")) {
    return safeError("google_reconnect_required", "Google connection needs to be reconnected");
  }
  if (status === 403 && (reason.includes("insufficient") || reason.includes("scope") || reason.includes("permission"))) {
    return safeError("google_insufficient_scope", "Google account does not have the required permission");
  }
  if (status === 429 || reason.includes("rate limit") || reason.includes("quota")) {
    return safeError("google_rate_limited", "Google is temporarily rate limited");
  }
  return safeError("google_api_error", "Google API request could not be completed");
};

const text = (value, max = MAX_HEADER_LENGTH) => typeof value === "string" ? value.replace(/[\r\n]+/g, " ").trim().slice(0, max) : "";
const header = (message, name) => text((message?.payload?.headers || []).find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value);
const decodeBase64Url = (value) => {
  if (typeof value !== "string") return "";
  try { return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); } catch { return ""; }
};
const bodyPart = (payload) => {
  if (!payload) return null;
  if (payload.mimeType === "text/plain" && payload.body?.data) return payload.body.data;
  for (const part of payload.parts || []) {
    const found = bodyPart(part);
    if (found) return found;
  }
  return null;
};
const htmlBodyPart = (payload) => {
  if (!payload) return null;
  if (payload.mimeType === "text/html" && payload.body?.data) return payload.body.data;
  for (const part of payload.parts || []) {
    const found = htmlBodyPart(part);
    if (found) return found;
  }
  return null;
};
const plainText = (payload) => {
  const raw = bodyPart(payload);
  if (raw) return decodeBase64Url(raw).slice(0, MAX_BODY_LENGTH);
  const html = htmlBodyPart(payload);
  return html ? decodeBase64Url(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_BODY_LENGTH) : "";
};
const normalizeMessage = (message, includeBody = false) => {
  const result = {
    id: text(message?.id, 200), threadId: text(message?.threadId, 200), sender: header(message, "From"),
    recipient: header(message, "To"), subject: header(message, "Subject"), date: header(message, "Date"),
    snippet: text(message?.snippet, MAX_SNIPPET_LENGTH),
  };
  if (includeBody) result.body = plainText(message?.payload);
  return result;
};
const encodeRaw = (value) => Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const encodeHeader = (value) => /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
const validEmail = (value) => EMAIL.test(value || "");
const messageId = (value) => typeof value === "string" && value.trim() && value.length <= 200 ? value.trim() : null;
const makeMime = ({ recipient, subject, body, reply }) => {
  if (!validEmail(recipient)) throw safeError("gmail_invalid_request", "A valid recipient is required");
  if (typeof body !== "string" || body.length > MAX_BODY_LENGTH) throw safeError("gmail_invalid_request", "A valid message body is required");
  const headers = ["To: " + recipient, "Subject: " + encodeHeader(text(subject || "", MAX_HEADER_LENGTH)), "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit"];
  if (reply?.messageId) headers.push("In-Reply-To: <" + reply.messageId.replace(/[<>\s]/g, "") + ">", "References: " + reply.references);
  return encodeRaw(headers.join("\r\n") + "\r\n\r\n" + body.replace(/\r?\n/g, "\r\n"));
};
const addressFromHeader = (value) => {
  const match = String(value || "").match(/<([^<>\s]+@[^<>\s]+)>/) || String(value || "").match(/[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+/);
  return match?.[1] || match?.[0] || null;
};

const createGmailProvider = ({ gmailFactory } = {}) => {
  const clientFor = (auth) => (gmailFactory ? gmailFactory(auth) : require("googleapis").google.gmail({ version: "v1", auth }));
  const getMessage = async (gmail, id, format, metadataHeaders) => {
    try { return (await gmail.users.messages.get({ userId: "me", id, format, ...(metadataHeaders ? { metadataHeaders } : {}) })).data; }
    catch (error) { throw normalizeGoogleError(error, { messageNotFound: true }); }
  };
  const execute = async (auth, action, payload = {}) => {
    if (!SUPPORTED_ACTIONS.has(action)) throw safeError("gmail_invalid_request", "Unsupported Gmail action");
    const gmail = clientFor(auth);
    try {
      if (action === "gmail.search") {
        const query = text(payload.query, MAX_QUERY_LENGTH);
        if (!query) throw safeError("gmail_invalid_request", "A Gmail query is required");
        const requested = payload.maxResults === undefined ? 10 : Number(payload.maxResults);
        if (!Number.isInteger(requested) || requested < 1) throw safeError("gmail_invalid_request", "maxResults must be between 1 and 50");
        const maxResults = Math.min(requested, MAX_RESULTS);
        const listed = await gmail.users.messages.list({ userId: "me", q: query, maxResults });
        const records = await Promise.all((listed.data.messages || []).slice(0, maxResults).map(({ id }) => getMessage(gmail, id, "metadata", ["From", "To", "Subject", "Date"])));
        return { messages: records.map((message) => normalizeMessage(message)), auditMetadata: { count: records.length } };
      }
      if (action === "gmail.read") {
        const id = messageId(payload.messageId);
        if (!id) throw safeError("gmail_invalid_request", "A Gmail message ID is required");
        const message = await getMessage(gmail, id, "full");
        return { message: normalizeMessage(message, true), auditMetadata: { messageId: message.id } };
      }
      if (action === "gmail.draft" || action === "gmail.send") {
        const raw = makeMime(payload);
        const requestBody = { raw };
        const response = action === "gmail.draft"
          ? await gmail.users.drafts.create({ userId: "me", requestBody: { message: requestBody } })
          : await gmail.users.messages.send({ userId: "me", requestBody });
        const data = response.data || {};
        const result = action === "gmail.draft" ? { draftId: text(data.id, 200), messageId: text(data.message?.id, 200), threadId: text(data.message?.threadId, 200) } : { messageId: text(data.id, 200), threadId: text(data.threadId, 200) };
        return { ...result, auditMetadata: { operation: action === "gmail.draft" ? "draft_created" : "message_sent" } };
      }
      const id = messageId(payload.messageId);
      if (!id || typeof payload.body !== "string") throw safeError("gmail_invalid_request", "A Gmail message ID and body are required");
      const target = await getMessage(gmail, id, "metadata", ["From", "Reply-To", "Subject", "Message-ID", "References"]);
      const recipient = addressFromHeader(header(target, "Reply-To")) || addressFromHeader(header(target, "From"));
      if (!recipient) throw safeError("gmail_invalid_request", "The selected message has no reply address");
      const originalSubject = header(target, "Subject");
      const subject = /^re:/i.test(originalSubject) ? originalSubject : "Re: " + originalSubject;
      const originalMessageId = header(target, "Message-ID").replace(/[<>\s]/g, "");
      const references = text((header(target, "References") + " <" + originalMessageId + ">").trim(), 1800);
      const raw = makeMime({ recipient, subject, body: payload.body, reply: { messageId: originalMessageId, references } });
      const requestBody = { raw, threadId: target.threadId };
      const response = action === "gmail.draft.reply"
        ? await gmail.users.drafts.create({ userId: "me", requestBody: { message: requestBody } })
        : await gmail.users.messages.send({ userId: "me", requestBody });
      const data = response.data || {};
      const result = action === "gmail.draft.reply" ? { draftId: text(data.id, 200), messageId: text(data.message?.id, 200), threadId: text(data.message?.threadId || target.threadId, 200) } : { messageId: text(data.id, 200), threadId: text(data.threadId || target.threadId, 200) };
      return { ...result, auditMetadata: { operation: action === "gmail.draft.reply" ? "reply_draft_created" : "reply_sent" } };
    } catch (error) { throw normalizeGoogleError(error); }
  };
  return { execute };
};

module.exports = { createGmailProvider, normalizeGoogleError, SUPPORTED_ACTIONS, MAX_BODY_LENGTH };
