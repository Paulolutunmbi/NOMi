const { MAX_RECIPIENTS, splitRecipientTokens } = require("../validation/recipientList");

const SUPPORTED_ACTIONS = new Set([
  "gmail.search", "gmail.read", "gmail.draft", "gmail.send", "gmail.draft.reply", "gmail.send.reply", "gmail.draft.update", "gmail.markRead",
]);
const MAX_MARK_READ_IDS = 50;

const MAX_RESULTS = 50;
const MAX_QUERY_LENGTH = 500;
const MAX_BODY_LENGTH = 20 * 1024;
const MAX_HTML_BODY_LENGTH = 400 * 1024;
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

const crypto = require("node:crypto");

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
  if (includeBody) {
    result.body = plainText(message?.payload);
    // Newsletters and marketing mail are mostly HTML (images, buttons). The
    // client sanitizes this and shows it in a sandboxed frame. It is only
    // ever returned to the signed-in user for display; it is never added to
    // the AI prompt or stored in the conversation context.
    const threadRef = text(message?.threadId || message?.id, 200);
    if (/^[A-Za-z0-9_-]+$/.test(threadRef)) result.webLink = `https://mail.google.com/mail/u/0/#all/${threadRef}`;
    const html = htmlBodyPart(message?.payload);
    if (html) result.bodyHtml = decodeBase64Url(html).slice(0, MAX_HTML_BODY_LENGTH);
  }
  return result;
};
const encodeRaw = (value) => Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const encodeHeader = (value) => /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
const validEmail = (value) => EMAIL.test(value || "");
const messageId = (value) => typeof value === "string" && value.trim() && value.length <= 200 ? value.trim() : null;
// One address or a comma/semicolon separated list, returned as a ready-to-use
// "To" header value. Every address must be valid. Addresses cannot contain
// whitespace, so no token can smuggle in an extra header line.
const recipientHeader = (value) => {
  const tokens = splitRecipientTokens(value);
  if (!tokens.length || tokens.length > MAX_RECIPIENTS || !tokens.every(validEmail)) return null;
  return tokens.join(", ");
};
const makeMime = ({ recipient, subject, body, reply, attachments = [] }) => {
  const toHeader = recipientHeader(recipient);
  if (!toHeader) throw safeError("gmail_invalid_request", "A valid recipient is required");
  if (typeof body !== "string" || body.length > MAX_BODY_LENGTH) throw safeError("gmail_invalid_request", "A valid message body is required");

  if (!attachments || !attachments.length) {
    const headers = ["To: " + toHeader, "Subject: " + encodeHeader(text(subject || "", MAX_HEADER_LENGTH)), "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit"];
    if (reply?.messageId) headers.push("In-Reply-To: <" + reply.messageId.replace(/[<>\s]/g, "") + ">", "References: " + reply.references);
    return encodeRaw(headers.join("\r\n") + "\r\n\r\n" + body.replace(/\r?\n/g, "\r\n"));
  }

  const boundary = `----=_Nomi_Part_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
  const headers = [
    "To: " + toHeader,
    "Subject: " + encodeHeader(text(subject || "", MAX_HEADER_LENGTH)),
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  if (reply?.messageId) headers.push("In-Reply-To: <" + reply.messageId.replace(/[<>\s]/g, "") + ">", "References: " + reply.references);

  const parts = [
    headers.join("\r\n"),
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body.replace(/\r?\n/g, "\r\n"),
  ];

  for (const att of attachments) {
    const filename = att.filename || "attachment";
    const mimeType = att.mimeType || "application/octet-stream";
    // att.data is a Buffer when it comes straight from an upload, but once an
    // attachment has round-tripped through a Mongo Mixed field (e.g. staged
    // inside a PendingSendAction awaiting approval) the driver hands back a
    // BSON Binary wrapper instead of a plain Buffer — its bytes live on
    // `.buffer`/`.value()`, not on the wrapper itself. Falling through to
    // `att.buffer` (which never exists on the attachment object) silently
    // produced a 0-byte, unopenable attachment. Handle every shape here.
    let rawBuffer;
    if (Buffer.isBuffer(att.data)) rawBuffer = att.data;
    else if (typeof att.data === "string") rawBuffer = Buffer.from(att.data, "base64");
    else if (att.data && typeof att.data.value === "function") rawBuffer = Buffer.from(att.data.value());
    else if (att.data && Buffer.isBuffer(att.data.buffer)) rawBuffer = att.data.buffer;
    else if (att.data instanceof Uint8Array) rawBuffer = Buffer.from(att.data);
    else if (att.data?.buffer instanceof ArrayBuffer) rawBuffer = Buffer.from(att.data.buffer);
    else rawBuffer = Buffer.from(att.buffer || "");
    const base64Content = rawBuffer.toString("base64").replace(/(.{76})/g, "$1\r\n");

    parts.push(
      `--${boundary}`,
      `Content-Type: ${mimeType}; name="${encodeHeader(filename)}"`,
      `Content-Disposition: attachment; filename="${encodeHeader(filename)}"`,
      "Content-Transfer-Encoding: base64",
      "",
      base64Content
    );
  }

  parts.push(`--${boundary}--`, "");
  return encodeRaw(parts.join("\r\n"));
};
const addressFromHeader = (value) => {
  const match = String(value || "").match(/<([^<>\s]+@[^<>\s]+)>/) || String(value || "").match(/[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+/);
  return match?.[1] || match?.[0] || null;
};
const senderFromHeader = (value) => {
  const raw = text(value);
  if (!raw) return { name: null, email: null };
  const email = addressFromHeader(raw);
  if (!email) return { name: raw || null, email: null };
  const name = text(raw.replace(/<[^>]*>/g, "").replace(/^\s*['\"]|['\"]\s*$/g, "")) || null;
  return { name: name === email ? null : name, email };
};
const normalizeSearchMessage = (message, includeBody = false) => {
  const normalized = normalizeMessage(message, includeBody);
  const rawFrom = header(message, "From") || normalized.sender;
  return { ...normalized, from: senderFromHeader(rawFrom) };
};

// The model sometimes puts plain words like "this week" in the query. Gmail does
// not read those as dates: it treats them as keywords, so the search returns
// unread mail that happens to contain "this" and "week" instead of recent mail.
// Turn the common phrases into real Gmail operators. Quoted queries are left alone.
const DATE_OPERATOR = /\b(?:after|before|newer_than|older_than):/i;
const NATURAL_DATE_RULES = [
  [/\b(?:this|past)\s+week\b/gi, "newer_than:7d"],
  [/\blast\s+7\s+days\b/gi, "newer_than:7d"],
  [/\btoday\b/gi, "newer_than:1d"],
];
const normalizeNaturalDates = (query) => {
  if (query.includes('"')) return query;
  let out = query;
  for (const [pattern, operator] of NATURAL_DATE_RULES) {
    out = out.replace(pattern, DATE_OPERATOR.test(out) ? "" : operator);
  }
  return out.replace(/\s+/g, " ").trim() || query;
};

const createGmailProvider = ({ gmailFactory } = {}) => {
  const clientFor = (auth) => (gmailFactory ? gmailFactory(auth) : require("googleapis").google.gmail({ version: "v1", auth }));
  const getMessage = async (gmail, id, format = "full", metadataHeaders) => {
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
        const listed = await gmail.users.messages.list({ userId: "me", q: normalizeNaturalDates(query), maxResults });
        const records = await Promise.all((listed.data.messages || []).slice(0, maxResults).map(({ id }) => getMessage(gmail, id, "full")));
        // Gmail's list order is not strictly by time, so sort newest first here.
        // markRead and "the last N" rely on index 0 being the newest message.
        records.sort((a, b) => Number(b?.internalDate || 0) - Number(a?.internalDate || 0));
        return { messages: records.map(normalizeSearchMessage), auditMetadata: { count: records.length } };
      }
      if (action === "gmail.read") {
        const id = messageId(payload.messageId);
        if (!id) throw safeError("gmail_invalid_request", "A Gmail message ID is required");
        const message = await getMessage(gmail, id, "full");
        return { message: normalizeSearchMessage(message, true), auditMetadata: { messageId: message.id } };
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
      if (action === "gmail.markRead") {
        const ids = [...new Set((Array.isArray(payload.messageIds) ? payload.messageIds : []).map((value) => messageId(value)).filter(Boolean))].slice(0, MAX_MARK_READ_IDS);
        if (!ids.length) throw safeError("gmail_invalid_request", "At least one Gmail message ID is required");
        await gmail.users.messages.batchModify({ userId: "me", requestBody: { ids, removeLabelIds: ["UNREAD"] } });
        // Gmail's inbox shows conversations, so a thread with two unread messages
        // still looks unread if only one of them is marked. Also clear UNREAD on
        // every message in the threads of the messages we just marked.
        const threadIds = [...new Set((Array.isArray(payload.threadIds) ? payload.threadIds : []).map((value) => messageId(value)).filter(Boolean))].slice(0, MAX_MARK_READ_IDS);
        await Promise.all(threadIds.map((id) => gmail.users.threads.modify({ userId: "me", id, requestBody: { removeLabelIds: ["UNREAD"] } })));
        return { markedRead: ids.length, auditMetadata: { operation: "messages_marked_read", count: ids.length, threads: threadIds.length } };
      }
      if (action === "gmail.draft.update") {
        const draftId = messageId(payload.draftId);
        if (!draftId) throw safeError("gmail_invalid_request", "A valid draft ID is required");
        if (typeof payload.body !== "string" || payload.body.length > MAX_BODY_LENGTH) throw safeError("gmail_invalid_request", "A valid message body is required");
        let raw;
        let threadId;
        if (payload.replyToMessageId) {
          // Reply-draft edit: rebuild against the original trusted message so the
          // thread, subject, and reply headers stay correct — never trust a
          // caller-supplied subject/thread for a reply update.
          const originalId = messageId(payload.replyToMessageId);
          if (!originalId) throw safeError("gmail_invalid_request", "A valid original message ID is required");
          const target = await getMessage(gmail, originalId, "metadata", ["From", "Reply-To", "Subject", "Message-ID", "References"]);
          const recipient = addressFromHeader(header(target, "Reply-To")) || addressFromHeader(header(target, "From"));
          if (!recipient) throw safeError("gmail_invalid_request", "The selected message has no reply address");
          const originalSubject = header(target, "Subject");
          const subject = /^re:/i.test(originalSubject) ? originalSubject : "Re: " + originalSubject;
          const originalMessageId = header(target, "Message-ID").replace(/[<>\s]/g, "");
          const references = text((header(target, "References") + " <" + originalMessageId + ">").trim(), 1800);
          raw = makeMime({ recipient, subject, body: payload.body, reply: { messageId: originalMessageId, references }, attachments: payload.attachments });
          threadId = target.threadId;
        } else {
          if (!recipientHeader(payload.recipient)) throw safeError("gmail_invalid_request", "A valid recipient is required");
          raw = makeMime({ recipient: payload.recipient, subject: payload.subject, body: payload.body, attachments: payload.attachments });
          threadId = payload.threadId || undefined;
        }
        const response = await gmail.users.drafts.update({ userId: "me", id: draftId, requestBody: { message: { raw, ...(threadId ? { threadId } : {}) } } });
        const data = response.data || {};
        return {
          draftId: text(data.id, 200), messageId: text(data.message?.id, 200), threadId: text(data.message?.threadId || threadId, 200),
          auditMetadata: { operation: "draft_updated" },
        };
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
      const raw = makeMime({ recipient, subject, body: payload.body, reply: { messageId: originalMessageId, references }, attachments: payload.attachments });
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

module.exports = { createGmailProvider, normalizeGoogleError, SUPPORTED_ACTIONS, MAX_BODY_LENGTH, senderFromHeader };