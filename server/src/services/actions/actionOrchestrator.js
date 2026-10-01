const { executeAction } = require("./actionExecutor");
const { resolveIdentity } = require("../identity/identityResolver");
const { isSelfRecipientMarker, generateSubjectFromBody } = require("../ai/intentValidator");
const { getAttachmentsForUser, removeAttachments } = require("../attachments/attachmentService");
const { checkEmailDomain: checkEmailDomainDefault } = require("../validation/emailDomainCheck");
const { MAX_RECIPIENTS, splitRecipientTokens } = require("../validation/recipientList");
const { timeZoneFromText, describeTimeZone, stripOffset, addHoursWallClock, addMillisWallClock } = require("../calendar/timeZoneResolver");

const REPLY_ACTIONS = new Set(["gmail.draft.reply", "gmail.send.reply"]);
const DRAFT_ACTIONS = new Set(["gmail.draft", "gmail.draft.reply"]);
const SEND_ACTIONS = new Set(["gmail.send", "gmail.send.reply"]);
const NEW_MESSAGE_ACTIONS = new Set(["gmail.draft", "gmail.send"]);
const MESSAGE_ACTIONS = new Set(["gmail.read", ...REPLY_ACTIONS]);
// Compound intents: model proposes search query + reply body; the orchestrator
// resolves the trusted target server-side and then executes the reply.
const SEARCH_THEN_REPLY_ACTIONS = new Set(["gmail.search_then_reply", "gmail.search_then_draft_reply", "gmail.search_then_send_reply"]);
const CALENDAR_ACTIONS = new Set(["calendar.search", "calendar.read", "calendar.freebusy", "calendar.create", "calendar.update", "calendar.delete"]);
// Same trust boundary as Gmail's MESSAGE_ACTIONS: these actions require an
// eventId that is already server-trusted (from a prior calendar.search/read
// in this conversation), never one invented by the client or the model.
const CALENDAR_EVENT_ACTIONS = new Set(["calendar.read", "calendar.update", "calendar.delete"]);
const SUPPORTED_ACTIONS = new Set(["gmail.search", "gmail.read", "gmail.draft", "gmail.send", "gmail.draft.edit", "gmail.markRead", "clarification", "chat.respond", ...REPLY_ACTIONS, ...SEARCH_THEN_REPLY_ACTIONS, ...CALENDAR_ACTIONS]);
const EMAIL = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const SECRET_KEYS = /token|credential|secret|authorization|api.?key|password/i;
const PRONOUN_MATCH = /\b(him|her|them|that\s+person|this\s+person|the\s+sender)\b/i;
const PRONOUN_REPLY = /^(?:him|her|them|that\s+person|this\s+person|the\s+sender)$/i;
// Short, explicit "send the draft" style follow-ups. These are matched loosely
// but only acted upon when a server-trusted draft already exists in context.
const SEND_FOLLOWUP = /^\s*(?:send(?:\s+(?:it|that|this|the\s+draft|the\s+email|the\s+message))?|just\s+send|send\s+now|go\s+ahead\s+and\s+send)\s*[.!?]?\s*$/i;
// Heuristic: does this message look like a short candidate-selection reply
// (number, name, pronoun, ordinal) vs a full new instruction with verbs?
// We conservatively treat any message containing an action verb (draft/send/reply/etc)
// as a NEW request rather than a pending-ambiguity resolution.
const ACTION_VERBS = /\b(craft|compose|draft|send|write|message|reply|respond|response|find|search|look\s+up|locate|read|check)\b/i;
const looksLikeAmbiguityResolution = (message) => {
  if (typeof message !== "string") return false;
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (ACTION_VERBS.test(trimmed)) return false;
  // Numbers / ordinals / short names.
  if (trimmed.length <= 120) return true;
  return false;
};
const isSelfRecipient = ({ recipient } = {}) => isSelfRecipientMarker(recipient);

const cleanText = (value, max) => typeof value === "string" ? value.slice(0, max) : null;
const providerMessages = (result) => {
  const messages = result?.messages || result?.data?.messages || [];
  return Array.isArray(messages) ? messages : [];
};
const addressFromHeader = (value) => {
  const match = String(value || "").match(/<([^<>\s]+@[^<>\s]+)>/) || String(value || "").match(/[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+/);
  return match?.[1] || match?.[0] || null;
};
const senderFromHeader = (value) => {
  const raw = cleanText(value, 500);
  if (!raw) return { name: null, email: null };
  const email = addressFromHeader(raw);
  if (!email) return { name: raw || null, email: null };
  const name = cleanText(raw.replace(/<[^>]*>/g, "").replace(/^\s*['\"]|['\"]\s*$/g, ""), 320) || null;
  return { name: name === email ? null : name, email };
};
const participantsFromHeader = (value) => {
  const header = String(value || "");
  const entries = [];
  const pattern = /([^,<>]*?)\s*<([^<>\s]+@[^<>\s]+)>|([^\s,<>]+@[^\s,<>]+\.[A-Z]{2,})/ig;
  for (const match of header.matchAll(pattern)) {
    const email = match[2] || match[3];
    if (!EMAIL.test(email || "")) continue;
    const name = (match[1] || "").replace(/^\s*["']|["']\s*$/g, "").trim();
    entries.push({ email: email.toLowerCase(), displayName: name && name.toLowerCase() !== email.toLowerCase() ? name : null });
  }
  return entries;
};
const normalizedCandidates = (result) => providerMessages(result)
  .filter((message) => typeof message?.id === "string" && message.id.trim())
  .slice(0, 50)
  .map((message) => {
    const fromObj = message.from && typeof message.from === "object" ? message.from : null;
    const parsedSender = typeof message.sender === "string" ? senderFromHeader(message.sender) : null;
    const email = cleanText(fromObj?.email || parsedSender?.email || message.fromEmail || message.email, 320);
    const displayName = cleanText(fromObj?.name || parsedSender?.name || message.fromName || message.displayName || (typeof message.from === "string" ? message.from : null), 320);
    const recipients = participantsFromHeader(message.recipient || message.to);
    const participants = [{ email: email || null, displayName: displayName || null }, ...recipients]
      .filter((person, index, list) => person.email && list.findIndex((entry) => entry.email.toLowerCase() === person.email.toLowerCase()) === index);
    const threadId = cleanText(message.threadId, 200);
    const subjectRaw = cleanText(message.subject, 500);
    return {
      id: message.id,
      threadId,
      email: email || null,
      displayName: displayName || null,
      participants,
      subject: subjectRaw || null,
      date: cleanText(message.date, 100),
      snippet: cleanText(message.snippet, 1000),
    };
  });
// Presentation helper: normalize subjects so the client never sees null for display.
const displaySubject = (subject) => {
  if (typeof subject === "string" && subject.trim()) return subject.trim();
  return "No subject";
};
const publicCandidate = (candidate, index) => {
  const { subject, date, displayName, email, name, snippet } = candidate || {};
  return {
    selectionId: typeof index === "number" ? String(index + 1) : null,
    name: displayName || name || null,
    email: email || null,
    subject: displaySubject(subject),
    date: date || null,
    snippet: typeof snippet === "string" && snippet.trim() ? cleanText(snippet, 500) : null,
  };
};
// Identity candidates answer "which person/account do you mean?" — they must
// NEVER carry message-level detail (subject/date/snippet/Gmail IDs). Exposing
// those here would leak the wrong Gmail account's message metadata alongside
// an identity representative picked from a mixed candidate list.
const publicIdentityCandidate = (candidate, index) => ({
  selectionId: typeof index === "number" ? String(index + 1) : null,
  name: candidate?.displayName || candidate?.name || null,
  email: candidate?.email || null,
});
// Chooses the correct public shape for a given ambiguity type so identity
// candidates never leak message metadata and message candidates keep it.
const formatCandidates = (candidates, ambiguityType) => (Array.isArray(candidates) ? candidates : [])
  .map((c, i) => (ambiguityType === "identity" ? publicIdentityCandidate(c, i) : publicCandidate(c, i)));
const statusForAmbiguity = (ambiguityType) => (ambiguityType === "message" ? "ambiguous_message" : "ambiguous_identity");
// Identity key: two candidates share the same identity if their normalized email
// matches, or (if emails are absent) their display names match.
const identityKey = (candidate) => {
  const email = String(candidate?.email || "").trim().toLowerCase();
  if (email) return `email:${email}`;
  const name = String(candidate?.displayName || candidate?.name || "").trim().toLowerCase();
  return name ? `name:${name}` : `unknown:${String(candidate?.id || Math.random())}`;
};
const groupCandidatesByIdentity = (candidates) => {
  const groups = new Map();
  for (const c of candidates) {
    const key = identityKey(c);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  return groups;
};
const identityGroupsToCandidates = (groups) => {
  // Return one representative candidate per identity (for the ambiguous_identity view).
  const result = [];
  for (const group of groups.values()) {
    const rep = group[0];
    result.push({
      ...rep,
      _groupSize: group.length,
      _messages: group,
    });
  }
  return result;
};
const candidatePrompt = (query, candidates, { ambiguityType = "identity", identityDisplayName = null, identityEmail = null } = {}) => {
  if (ambiguityType === "message") {
    const identityLabel = identityDisplayName || identityEmail ? `${identityDisplayName || ""}${identityDisplayName && identityEmail ? " " : ""}${identityEmail ? `<${identityEmail}>` : ""}`.trim() : "this person";
    const numbered = candidates.map((candidate, index) => {
      const subjectPart = displaySubject(candidate.subject);
      const datePart = candidate.date ? ` (${candidate.date})` : "";
      return `${index + 1}. "${subjectPart}"${datePart}`;
    }).join("\n");
    const queryLabel = query ? ` for ${query}` : "";
    return `I found multiple messages${queryLabel} from ${identityLabel}. Which conversation should I reply to?\n\n${numbered}\n\nReply with the number.`;
  }
  const numbered = candidates.map((candidate, index) => {
    const sender = candidate.displayName || candidate.name || "Unknown sender";
    const emailPart = candidate.email ? ` <${candidate.email}>` : "";
    const subjectPart = candidate.subject ? ` — "${displaySubject(candidate.subject)}"` : "";
    return `${index + 1}. ${sender}${emailPart}${subjectPart}`;
  }).join("\n");
  const queryLabel = query ? ` for ${query}` : "";
  return `I found multiple possible matches${queryLabel}. Which one should I reply to?\n\n${numbered}\n\nReply with the number or the person's email.`;
};
const safeResult = (result) => {
  if (!result || typeof result !== "object") return result || null;
  if (Array.isArray(result)) return result.map(safeResult);
  return Object.fromEntries(Object.entries(result)
    .filter(([key]) => !SECRET_KEYS.test(key) && key !== "auditMetadata" && key !== "id" && key !== "messageId" && key !== "threadId" && key !== "draftId")
    .map(([key, value]) => [key, safeResult(value)]));
};
const replyIdentityQuery = (message) => {
  if (typeof message !== "string") return null;
  const pronounMatch = message.match(PRONOUN_MATCH);
  if (pronounMatch) return pronounMatch[1].trim();

  const findMatch = message.match(/\b(?:find|search(?:\s+for)?|look\s+up|locate)\s+(?:an?\s+)?(?:email|message)?\s*(?:from\s+)?([A-Za-z][A-Za-z .'-]{1,80}?)(?:'s)?(?:\s+(?:email|message|thread))?\s+(?:and\s+)?(?:reply|respond|draft|send)\b/i);
  if (findMatch) return findMatch[1].trim();

  const namedMatch = message.match(/\b(?:reply|response)\s+(?:to\s+)?([A-Za-z][A-Za-z .'-]{1,80}?)(?:\s+(?:about|regarding|on|with|saying|telling|that)\b|[.!?,]|$)/i)
    || message.match(/\b(?:tell|telling)\s+([A-Za-z][A-Za-z .'-]{1,80}?)(?:\s+(?:that|about|regarding|to|I|i|we|they|he|she)\b|[.!?,]|$)/i)
    || message.match(/\b(?:craft|compose|draft|send|write|message)\s+(?:a\s+)?(?:message|email|note|reply|response)?\s*(?:to\s+|for\s+|telling\s+)?([A-Za-z][A-Za-z .'-]{1,80}?)(?:\s+(?:about|regarding|on|with|saying|telling|that)\b|[.!?,]|$)/i);
  return namedMatch ? namedMatch[1].trim() : null;
};
const personSearchQuery = (message, query) => {
  const source = String(message || "").trim();
  const hasSearchVerb = /^(?:please\s+)?(?:search|find|locate|look\s+for|look\s+up)\b/i.test(source);
  if (!hasSearchVerb) return null;
  const utterance = hasSearchVerb ? source
    .replace(/^(?:please\s+)?(?:search|find|locate|look\s+for|look\s+up)\s+(?:in\s+)?(?:gmail\s+)?(?:for\s+)?/i, "")
    .replace(/^(?:(?:my|the)\s+)?(?:contact|person|user|someone)\s+/i, "")
    .replace(/[’']s\s+(?:email|emails|message|messages|thread)\.?$/i, "")
    .replace(/\s+(?:he|she|they)\s+(?:is|are)\s+(?:a\s+)?(?:contact|person)\b.*$/i, "")
    .trim() : "";
  let raw = utterance || (typeof query === "string" ? query.trim() : "");
  raw = raw.replace(/^(?:from|to):\s*/i, "").trim();
  if (!raw || raw.length > 80 || /[@{}():]/.test(raw) || /\b(?:after|before|newer_than|older_than)\s*:/i.test(raw)) return null;
  if (/\b(?:inbox|emails?|messages?|thread|calendar|unread|read|last|recent|after|before|from|to)\b/i.test(raw)) return null;
  if (!/^[\p{L}][\p{L}'-]+(?:\s+[\p{L}][\p{L}'-]*){0,2}$/iu.test(raw)) return null;
  return raw;
};
const payloadFor = (intent) => {
  const { action, parameters } = intent;
  if (action === "gmail.search") return { query: parameters.query, maxResults: parameters.maxResults || undefined };
  if (action === "gmail.read") return { messageId: parameters.messageId };
  if (REPLY_ACTIONS.has(action)) return { messageId: parameters.messageId, body: parameters.body };
  const finalSubject = typeof parameters.subject === "string" && parameters.subject.trim()
    ? parameters.subject
    : generateSubjectFromBody(parameters.body);
  return { recipient: parameters.recipient, subject: finalSubject, body: parameters.body };
};
// Calendar events never expose their eventId to the client — only a
// per-response selectionId, mirroring publicIdentityCandidate/publicCandidate.
const displayEventSummary = (summary) => (typeof summary === "string" && summary.trim() ? summary.trim() : "Untitled event");
const publicCalendarCandidate = (event, index) => ({
  selectionId: typeof index === "number" ? String(index + 1) : null,
  summary: displayEventSummary(event?.summary),
  start: event?.start || null,
  end: event?.end || null,
  location: event?.location || null,
});
const calendarPayloadFor = (intent) => {
  const { action, parameters: p } = intent;
  if (action === "calendar.search") return { query: p.query || undefined, timeMin: p.timeMin || undefined, timeMax: p.timeMax || undefined, maxResults: p.maxResults || undefined, timeZone: p.timeZone || undefined };
  if (action === "calendar.freebusy") return { timeMin: p.timeMin, timeMax: p.timeMax, timeZone: p.timeZone || undefined };
  if (action === "calendar.read" || action === "calendar.delete") return { eventId: p.eventId };
  if (action === "calendar.create") {
    // The model isn't required to supply endDateTime (see intentValidator):
    // when the user never mentioned an end time or duration, default the
    // event to one hour long rather than failing the whole request.
    const start = new Date(p.startDateTime);
    const defaultEnd = !Number.isNaN(start.getTime()) ? new Date(start.getTime() + 60 * 60 * 1000).toISOString() : undefined;
    return { summary: p.summary, description: p.description || undefined, location: p.location || undefined,
      startDateTime: p.startDateTime, endDateTime: p.endDateTime || defaultEnd, timeZone: p.timeZone || undefined,
      attendees: p.attendees || undefined, addMeet: !!p.addMeet };
  }
  // calendar.update — only forward fields the model actually set (null means "unchanged").
  return { eventId: p.eventId,
    ...(p.summary !== null ? { summary: p.summary } : {}), ...(p.description !== null ? { description: p.description } : {}),
    ...(p.location !== null ? { location: p.location } : {}), ...(p.startDateTime !== null ? { startDateTime: p.startDateTime } : {}),
    ...(p.endDateTime !== null ? { endDateTime: p.endDateTime } : {}), ...(p.timeZone !== null ? { timeZone: p.timeZone } : {}),
    ...(p.attendees !== null ? { attendees: p.attendees } : {}) };
};
// Same execution-boundary recheck Gmail applies to recipients (lines below,
// NEW_MESSAGE_ACTIONS): a self-marker resolves only to the authenticated
// user's own address; any other literal address must already have appeared
// verbatim in the user's own message text. The model can never invent one.
const resolveAttendees = (attendeesValue, { message, user }) => {
  if (attendeesValue === undefined || attendeesValue === null) return { ok: true, attendees: undefined };
  const tokens = String(attendeesValue).split(/[,;]/).map((token) => token.trim()).filter(Boolean);
  const resolved = [];
  for (const token of tokens) {
    if (isSelfRecipient({ recipient: token })) {
      const userEmail = typeof user?.email === "string" && EMAIL.test(user.email.trim()) ? user.email.trim().toLowerCase() : null;
      if (!userEmail) return { ok: false };
      resolved.push(userEmail);
    } else if (EMAIL.test(token) && typeof message === "string" && message.toLowerCase().includes(token.toLowerCase())) {
      resolved.push(token);
    } else {
      return { ok: false };
    }
  }
  return { ok: true, attendees: resolved.join(", ") };
};
// Map a compound search_then_* action to the corresponding reply action.
const replyActionFor = (compoundAction) => {
  if (compoundAction === "gmail.search_then_send_reply") return "gmail.send.reply";
  return "gmail.draft.reply"; // search_then_reply and search_then_draft_reply both draft
};

// Fallback when a user has no country set yet in their profile.
const DEFAULT_TIME_ZONE = "Africa/Lagos";

const createActionOrchestrator = ({ contextService, actionExecutor = executeAction, resolve = resolveIdentity, checkEmailDomain = checkEmailDomainDefault } = {}) => {
  if (!contextService) throw new Error("contextService is required");

  // Resolve ambiguity: separates identity-level ambiguity from message-level ambiguity.
  // Returns { status, candidates, ambiguityType?, identityDisplayName?, identityEmail?, identityGroup? }
  const resolveAmbiguity = (query, rawCandidates) => {
    if (!rawCandidates || !rawCandidates.length) return { status: "none" };
    // First filter candidates by identity query, keeping the original order.
    const filtered = query && !PRONOUN_REPLY.test(query)
      ? rawCandidates.filter((c) => {
        const normalizedQuery = String(query || "").trim().toLowerCase();
        const email = String(c.email || "").trim().toLowerCase();
        const name = String(c.displayName || c.name || "").trim().toLowerCase();
        if (normalizedQuery === email) return true;
        if (normalizedQuery === name) return true;
        const nameParts = name.split(/\s+/).filter(Boolean);
        if (nameParts.includes(normalizedQuery)) return true;
        if (email.startsWith(`${normalizedQuery}@`)) return true;
        return false;
      })
      : rawCandidates.slice();
    const candidates = filtered.length ? filtered : rawCandidates;

    // Group by identity.
    const groups = groupCandidatesByIdentity(candidates);
    const groupKeys = [...groups.keys()];

    // Single identity, single message: fully resolved.
    if (groupKeys.length === 1 && groups.get(groupKeys[0]).length === 1) {
      return { status: "resolved", identity: groups.get(groupKeys[0])[0] };
    }
    // Single identity, multiple messages: message-level ambiguity.
    if (groupKeys.length === 1) {
      const messages = groups.get(groupKeys[0]);
      const rep = messages[0];
      return {
        status: "ambiguous",
        candidates: messages,
        ambiguityType: "message",
        identityDisplayName: rep.displayName || null,
        identityEmail: rep.email || null,
        identityGroup: messages,
      };
    }
    // Multiple identities: identity-level ambiguity.
    const identityReps = identityGroupsToCandidates(groups);
    return {
      status: "ambiguous",
      candidates: identityReps,
      ambiguityType: "identity",
    };
  };

  const selectReplyCandidate = (message, conversation) => {
    const query = replyIdentityQuery(message);
    const candidates = Array.isArray(conversation.gmailCandidates) ? conversation.gmailCandidates : [];
    if (!candidates.length) {
      if (Array.isArray(conversation.gmailMessageIds) && conversation.gmailMessageIds.length === 1) {
        return { status: "resolved", identity: { id: conversation.gmailMessageIds[0] } };
      }
      return { status: "none" };
    }
    return resolveAmbiguity(query, candidates);
  };

  const selectPendingCandidate = (message, candidates) => {
    const choice = typeof message === "string" ? message.trim() : "";
    const numbered = choice.match(/^(?:#?\s*)?(\d+)(?:\s*(?:st|nd|rd|th))?(?:\s+(?:one|option))?$/i)
      || choice.match(/^(?:the\s+)?(first|second|third|fourth|fifth)(?:\s+(?:one|option|[A-Za-z]+))?$/i);
    if (numbered) {
      const labels = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
      const index = Number(numbered[1]) || labels[String(numbered[1]).toLowerCase()];
      return candidates[index - 1] ? { status: "resolved", identity: candidates[index - 1] } : { status: "invalid_selection" };
    }
    if (!choice) return { status: "invalid_selection" };
    const resolution = resolve({ query: choice, candidates });
    return resolution.status === "resolved" ? resolution : { status: resolution.status === "ambiguous" ? "ambiguous" : "invalid_selection", candidates: resolution.candidates };
  };

  // Resolves a user selection against an identity-grouped candidate set.
  // If the user selected an identity representative, we may still need to
  // disambiguate messages within that identity.
  const resolvePendingSelection = (message, candidates, { ambiguityType = "identity" } = {}) => {
    if (ambiguityType === "message") {
      return selectPendingCandidate(message, candidates);
    }
    // For identity reps, the candidate may be an identity representative with
    // a _messages array. Selecting by number or identity name picks the identity.
    const baseSelection = selectPendingCandidate(message, candidates);
    if (baseSelection.status === "resolved") {
      const selected = baseSelection.identity;
      const innerMessages = selected?._messages || [selected];
      if (innerMessages.length === 1) {
        return { status: "resolved", identity: innerMessages[0] };
      }
      // Same-identity, multiple messages: ask which message.
      const rep = innerMessages[0];
      return {
        status: "ambiguous",
        candidates: innerMessages,
        ambiguityType: "message",
        identityDisplayName: rep.displayName || null,
        identityEmail: rep.email || null,
      };
    }
    return baseSelection;
  };

  // Two explicit, server-owned selections: identity first, then a fresh Gmail
  // search scoped to that identity, then conversation. Public selection IDs
  // never expose or accept Gmail IDs.
  const executePendingInteraction = async ({ user, conversationId, message, conversation, approval }) => {
    const pending = conversation.pendingInteraction;
    if (!pending || !["identity_selection", "conversation_selection", "no_history"].includes(pending.stage)) return null;
    if (pending.stage === "no_history") {
      if (String(message).trim() !== "start_new_email") return { status: "no_previous_conversation", selectedIdentity: pending.selectedIdentity };
      const recipient = pending.selectedIdentity?.email;
      if (!EMAIL.test(recipient || "")) return { status: "rejected", reason: "selected_identity_has_no_email" };
      if (pending.action === "gmail.search") {
        await contextService.update({ userId: user._id, conversationId, pendingInteraction: null, trustedGmailPerson: pending.selectedIdentity, trustedTarget: null, trustedDraft: null, gmailMessageIds: [], gmailCandidates: [] });
        return { status: "success", action: "gmail.person.selected", selectedIdentity: pending.selectedIdentity, result: {} };
      }
      const payload = { recipient, subject: generateSubjectFromBody(pending.body), body: pending.body };
      const execution = await actionExecutor({ user, provider: "google", action: "gmail.draft", payload,
        target: { type: "gmail", id: null, label: null }, approval, conversationId });
      if (execution.status !== "success") return { status: execution.status, action: "gmail.draft", selectedIdentity: pending.selectedIdentity };
      await persistDraftContext({ user, conversationId, action: "gmail.draft", result: execution.result, payload });
      await contextService.update({ userId: user._id, conversationId, pendingInteraction: null });
      return { status: "success", action: "gmail.draft", selectedIdentity: pending.selectedIdentity, result: safeResult(execution.result) };
    }
    const source = pending.stage === "identity_selection" ? pending.identityCandidates : pending.conversationCandidates;
    const selection = selectPendingCandidate(message, Array.isArray(source) ? source : []);
    if (selection.status !== "resolved") {
      const ambiguityType = pending.stage === "identity_selection" ? "identity" : "message";
      const hasRealAmbiguity = Array.isArray(source) && source.length > 1;
      return { status: hasRealAmbiguity ? statusForAmbiguity(ambiguityType) : "clarification", action: pending.action,
        candidates: formatCandidates(source, ambiguityType),
        prompt: pending.stage === "identity_selection" ? "Please choose one of the matching accounts." : "Please choose one of the conversations." };
    }
    const selected = selection.identity;
    if (pending.stage === "identity_selection") {
      if (!EMAIL.test(selected.email || "")) return { status: "rejected", reason: "selected_identity_has_no_email" };
      const selectedIdentity = { name: selected.displayName || selected.name || null, email: selected.email.toLowerCase() };
      const searchExecution = await actionExecutor({ user, provider: "google", action: "gmail.search",
        payload: { query: `{from:${selectedIdentity.email} to:${selectedIdentity.email}}`, maxResults: 20 }, target: { type: "gmail", id: null, label: null }, approval, conversationId });
      if (searchExecution.status !== "success") return { status: searchExecution.status, action: pending.action };
      const conversationsByThread = new Map();
      for (const candidate of normalizedCandidates(searchExecution.result)) {
        if (!(candidate.participants || []).some((person) => String(person.email || "").toLowerCase() === selectedIdentity.email)) continue;
        const key = candidate.threadId || candidate.id;
        const current = conversationsByThread.get(key);
        // Prefer an actual message sent by the selected person as reply target
        // when a thread also contains one of the user's outgoing messages.
        const isIncomingFromPerson = String(candidate.email || "").toLowerCase() === selectedIdentity.email;
        const currentIsIncomingFromPerson = String(current?.email || "").toLowerCase() === selectedIdentity.email;
        if (!current || (isIncomingFromPerson && !currentIsIncomingFromPerson)) conversationsByThread.set(key, candidate);
      }
      const conversations = [...conversationsByThread.values()]
        .map((candidate) => ({ ...candidate, email: selectedIdentity.email, displayName: selectedIdentity.name || candidate.displayName }));
      if (!conversations.length) {
        await contextService.update({ userId: user._id, conversationId, pendingInteraction: { stage: "no_history", action: pending.action, body: pending.body, selectedIdentity } });
        return { status: "no_previous_conversation", action: pending.action, selectedIdentity,
          message: "No previous conversation. You can start a new email." };
      }
      const next = { ...pending, stage: "conversation_selection", selectedIdentity, conversationCandidates: conversations };
      await contextService.update({ userId: user._id, conversationId, pendingInteraction: next,
        gmailMessageIds: conversations.map((c) => c.id), gmailCandidates: conversations });
      return { status: "ambiguous_message", action: pending.action, selectedIdentity,
        candidates: conversations.map((c, i) => publicCandidate(c, i)),
        prompt: `Which conversation with ${selectedIdentity.name || selectedIdentity.email}?` };
    }
    if (pending.action === "gmail.search") {
      const trustedTarget = { type: "gmail_message", messageId: selected.id, threadId: selected.threadId, email: pending.selectedIdentity?.email, subject: selected.subject };
      await contextService.update({ userId: user._id, conversationId, pendingInteraction: null, trustedGmailPerson: { ...pending.selectedIdentity, source: "selected_conversation" }, trustedTarget, gmailMessageIds: [selected.id], gmailCandidates: [selected] });
      return { status: "success", action: "gmail.conversation.selected", selectedIdentity: pending.selectedIdentity,
        selectedConversation: publicCandidate(selected, 0), result: {} };
    }
    const payload = { messageId: selected.id, recipient: pending.selectedIdentity?.email || selected.email || null, subject: selected.subject || null, body: pending.body };
    const execution = await actionExecutor({ user, provider: "google", action: pending.action, payload,
      target: { type: "gmail_message", id: selected.id }, approval, conversationId });
    const publicSelectedConversation = publicCandidate(selected, 0);
    if (execution.status !== "success") return { status: execution.status, action: pending.action, pendingAction: execution.pendingAction, selectedIdentity: pending.selectedIdentity, selectedConversation: publicSelectedConversation };
    await contextService.update({ userId: user._id, conversationId,
      pendingInteraction: { ...pending, stage: "draft_created", selectedConversation: selected } });
    await persistTrustedTarget({ user, conversationId, candidate: selected });
    await persistDraftContext({ user, conversationId, action: pending.action, result: execution.result, payload, candidate: selected });
    return { status: "success", action: pending.action, selectedIdentity: pending.selectedIdentity, selectedConversation: publicSelectedConversation, result: safeResult(execution.result) };
  };

  const executePendingReply = async ({ user, conversationId, message, conversation, approval }) => {
    const pending = conversation.pendingGmailReply;
    if (!pending) return null;
    const candidates = Array.isArray(conversation.gmailCandidates) ? conversation.gmailCandidates : [];
    const pendingAmbiguity = conversation.pendingAmbiguity || {};
    const hasStoredSelectionList = Array.isArray(pendingAmbiguity.candidateSelectionList) && pendingAmbiguity.candidateSelectionList.length > 0;
    let ambiguityType;
    let sourceCandidates;
    if (hasStoredSelectionList) {
      ambiguityType = pendingAmbiguity.ambiguityType || "identity";
      sourceCandidates = pendingAmbiguity.candidateSelectionList;
    } else {
      const ambiguityCheck = resolveAmbiguity(null, candidates);
      ambiguityType = ambiguityCheck.status === "ambiguous" ? ambiguityCheck.ambiguityType : "identity";
      sourceCandidates = ambiguityCheck.status === "ambiguous" ? ambiguityCheck.candidates : candidates;
    }
    const selection = resolvePendingSelection(message, sourceCandidates, { ambiguityType });
    if (selection.status === "ambiguous") {
      const displayedAmbiguityType = selection.ambiguityType || ambiguityType;
      return {
        status: statusForAmbiguity(displayedAmbiguityType),
        action: pending.action,
        candidates: formatCandidates(selection.candidates, displayedAmbiguityType),
        prompt: candidatePrompt(null, selection.candidates, {
          ambiguityType: selection.ambiguityType,
          identityDisplayName: selection.identityDisplayName,
          identityEmail: selection.identityEmail,
        }),
      };
    }
    if (selection.status !== "resolved") {
      // Only relabel as ambiguous_* when there's a genuine multi-way choice to
      // re-present. A single leftover candidate plus an invalid selection is
      // not "ambiguous" — there's nothing to disambiguate — so it stays a
      // generic clarification re-prompt.
      const hasRealAmbiguity = Array.isArray(sourceCandidates) && sourceCandidates.length > 1;
      return {
        status: hasRealAmbiguity ? statusForAmbiguity(ambiguityType) : "clarification",
        action: pending.action,
        candidates: formatCandidates(sourceCandidates, ambiguityType),
        prompt: candidatePrompt(null, sourceCandidates, { ambiguityType }),
      };
    }
    const trustedMessageId = selection.identity.id;
    const execution = await actionExecutor({ user, provider: "google", action: pending.action,
      payload: { messageId: trustedMessageId, body: pending.body }, target: { type: "gmail_message", id: trustedMessageId }, approval, conversationId });
    if (execution.status !== "success") return { status: execution.status, action: pending.action, pendingAction: execution.pendingAction };
    await contextService.update({ userId: user._id, conversationId, pendingGmailReply: null });
    await persistDraftContext({ user, conversationId, action: pending.action, result: execution.result, payload: { body: pending.body, messageId: trustedMessageId }, candidate: selection.identity });
    return { status: "success", action: pending.action, result: safeResult(execution.result) };
  };

  const executePendingAmbiguity = async ({ user, conversationId, message, conversation, approval }) => {
    const pending = conversation.pendingAmbiguity;
    if (!pending) return null;
    const candidates = Array.isArray(conversation.gmailCandidates) ? conversation.gmailCandidates : [];
    const hasStoredSelectionList = Array.isArray(pending.candidateSelectionList) && pending.candidateSelectionList.length > 0;
    const ambiguityType = pending.ambiguityType || "identity";
    let sourceCandidates;
    if (hasStoredSelectionList) {
      sourceCandidates = pending.candidateSelectionList;
    } else if (ambiguityType === "identity") {
      const check = resolveAmbiguity(null, candidates);
      sourceCandidates = check.status === "ambiguous" ? check.candidates : candidates;
    } else {
      sourceCandidates = candidates;
    }
    const selection = resolvePendingSelection(message, sourceCandidates, { ambiguityType });
    if (selection.status === "ambiguous") {
      const displayedAmbiguityType = selection.ambiguityType || ambiguityType;
      return {
        status: statusForAmbiguity(displayedAmbiguityType),
        action: pending.action,
        candidates: formatCandidates(selection.candidates, displayedAmbiguityType),
        prompt: candidatePrompt(null, selection.candidates, {
          ambiguityType: selection.ambiguityType,
          identityDisplayName: selection.identityDisplayName,
          identityEmail: selection.identityEmail,
        }),
      };
    }
    if (selection.status !== "resolved") {
      const hasRealAmbiguity = Array.isArray(sourceCandidates) && sourceCandidates.length > 1;
      return {
        status: hasRealAmbiguity ? statusForAmbiguity(ambiguityType) : "clarification",
        action: pending.action,
        candidates: formatCandidates(sourceCandidates, ambiguityType),
        prompt: candidatePrompt(null, sourceCandidates, { ambiguityType }),
      };
    }
    await contextService.update({ userId: user._id, conversationId, pendingAmbiguity: null });
    const trustedMessageId = selection.identity.id;
    if (REPLY_ACTIONS.has(pending.action)) {
      const target = { type: "gmail_message", id: trustedMessageId };
      const payload = { messageId: trustedMessageId, body: pending.body };
      const execution = await actionExecutor({ user, provider: "google", action: pending.action, payload, target, approval, conversationId });
      if (execution.status !== "success") return { status: execution.status, action: pending.action, pendingAction: execution.pendingAction };
      await persistDraftContext({ user, conversationId, action: pending.action, result: execution.result, payload, candidate: selection.identity });
      await persistTrustedTarget({ user, conversationId, candidate: selection.identity });
      return { status: "success", action: pending.action, result: safeResult(execution.result) };
    }
    return { status: "rejected", reason: "unsupported_pending_ambiguity_action" };
  };

  const persistTrustedTarget = async ({ user, conversationId, candidate }) => {
    if (!candidate || typeof candidate.id !== "string") return;
    const trustedTarget = {
      type: "gmail_message",
      messageId: candidate.id,
      threadId: candidate.threadId || null,
      email: candidate.email || null,
      subject: candidate.subject || null,
    };
    await contextService.update({ userId: user._id, conversationId, trustedTarget }).catch(() => {});
  };

  const persistDraftContext = async ({ user, conversationId, action, result, payload, candidate }) => {
    if (!result || typeof result !== "object") return;
    const draftData = {
      draftId: result.draftId || null,
      threadId: result.threadId || candidate?.threadId || null,
      // Reply follow-ups must retain the original server-selected Gmail
      // message, not the newly-created draft's message ID.
      messageId: REPLY_ACTIONS.has(action) ? (payload?.messageId || null) : (result.messageId || payload?.messageId || null),
      recipient: payload?.recipient || candidate?.email || null,
      subject: payload?.subject || candidate?.subject || null,
      action: DRAFT_ACTIONS.has(action) ? action
        : SEND_ACTIONS.has(action) ? (action === "gmail.send.reply" ? "gmail.send.reply" : "gmail.send")
        : action,
      body: payload?.body || null,
      // Authorization state stores only durable attachment references. Raw
      // bytes must never be embedded in MongoDB context documents.
      attachments: Array.isArray(payload?.attachments) ? payload.attachments.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size })) : [],
    };
    await contextService.update({ userId: user._id, conversationId, trustedDraft: draftData }).catch(() => {});
  };

  // Calendar actions follow the identical trust pattern as Gmail: eventId is
  // rechecked against server-trusted state, attendees are rechecked against
  // the same self-marker/explicit-address rule as Gmail recipients, and
  // eventId is never echoed back to the client (only a selectionId).
  const executeCalendarAction = async ({ user, conversationId, message, intent, activeConversation, approval }) => {
    if (CALENDAR_EVENT_ACTIONS.has(intent.action)
      && activeConversation.trustedCalendarEvent?.id !== intent.parameters.eventId) {
      return { status: "rejected", reason: "untrusted_or_unknown_event_id" };
    }
    if (["calendar.create", "calendar.update"].includes(intent.action) && intent.parameters.attendees !== null) {
      const resolved = resolveAttendees(intent.parameters.attendees, { message, user });
      if (!resolved.ok) return { status: "rejected", reason: "untrusted_attendee_email" };
      intent.parameters.attendees = resolved.attendees || null;
      // Same domain sanity check as a new Gmail recipient — skip the
      // authenticated user's own (already-verified) address.
      const userEmailLower = typeof user?.email === "string" ? user.email.trim().toLowerCase() : null;
      for (const attendeeEmail of (resolved.attendees || "").split(",").map((value) => value.trim()).filter(Boolean)) {
        if (attendeeEmail === userEmailLower) continue;
        const domainCheck = await checkEmailDomain(attendeeEmail);
        if (domainCheck.status === "likely_typo" || domainCheck.status === "no_mail_server") {
          return { status: "email_domain_warning", action: intent.action, reason: domainCheck.status, domain: domainCheck.domain, suggestion: domainCheck.suggestion || null, correctedEmail: domainCheck.correctedEmail || null };
        }
      }
    }
    // Time zone: the model only proposes a wall-clock time. If the user
    // named one in this message ("10am WAT", "in Kenya time") that wins;
    // otherwise this defaults to the country the user set at sign-up (or in
    // Settings), falling back to Nigeria time for an account with none set.
    // A default use is flagged with timeZoneDefaulted so the reply can tell
    // the user what zone was used and that they can just say a different
    // one, or a country, to change it.
    let chosenTimeZone = null;
    let timeZoneDefaulted = false;
    const reschedulingTime = intent.action === "calendar.update" && (intent.parameters.startDateTime || intent.parameters.endDateTime);
    if (intent.action === "calendar.create" || reschedulingTime) {
      const stated = timeZoneFromText(message);
      chosenTimeZone = stated || user.timeZone || DEFAULT_TIME_ZONE;
      timeZoneDefaulted = !stated;
      const p = intent.parameters;
      if (p.startDateTime) p.startDateTime = stripOffset(p.startDateTime);
      if (p.endDateTime) {
        p.endDateTime = stripOffset(p.endDateTime);
      } else if (intent.action === "calendar.create") {
        p.endDateTime = addHoursWallClock(p.startDateTime, 1) || null;
      } else if (p.startDateTime) {
        // Rescheduling with only a new start time: keep the meeting's
        // original length instead of leaving Google's old absolute end time
        // in place, which would otherwise shrink, stretch, or even land
        // before the new start.
        const original = activeConversation.trustedCalendarEvent;
        const durationMs = original?.start && original?.end ? new Date(original.end).getTime() - new Date(original.start).getTime() : NaN;
        p.endDateTime = Number.isFinite(durationMs) && durationMs > 0 ? addMillisWallClock(p.startDateTime, durationMs) : null;
      }
      p.timeZone = chosenTimeZone;
    }
    if (intent.action === "calendar.search" || intent.action === "calendar.freebusy") {
      const p = intent.parameters;
      // Same rule as create: a zone named in the message wins, then the user's
      // saved zone. Offsets are dropped so "today" means today for the user, not
      // for the UTC server clock.
      p.timeZone = timeZoneFromText(message) || user.timeZone || DEFAULT_TIME_ZONE;
      if (p.timeMin) p.timeMin = stripOffset(p.timeMin);
      if (p.timeMax) p.timeMax = stripOffset(p.timeMax);
    }
    const target = CALENDAR_EVENT_ACTIONS.has(intent.action)
      ? { type: "calendar_event", id: intent.parameters.eventId }
      : { type: "calendar", id: null };
    const execution = await actionExecutor({ user, provider: "google", action: intent.action, payload: calendarPayloadFor(intent), target, approval, conversationId });
    if (execution.status !== "success") return { status: execution.status, action: intent.action };

    if (intent.action === "calendar.search") {
      const events = Array.isArray(execution.result?.events) ? execution.result.events : [];
      await contextService.update({ userId: user._id, conversationId, calendarEventIds: events.map((e) => e.id), calendarCandidates: events, trustedCalendarEvent: null }).catch(() => {});
      return { status: "success", action: intent.action, result: { events: events.map((e, i) => publicCalendarCandidate(e, i)), count: events.length } };
    }
    if (intent.action === "calendar.read" && execution.result?.event?.id) {
      const event = execution.result.event;
      const existingCandidates = Array.isArray(activeConversation.calendarCandidates) ? activeConversation.calendarCandidates : [];
      const existingIds = Array.isArray(activeConversation.calendarEventIds) ? activeConversation.calendarEventIds : [];
      await contextService.update({
        userId: user._id, conversationId,
        calendarEventIds: [...new Set([event.id, ...existingIds])].slice(0, 50),
        calendarCandidates: [event, ...existingCandidates.filter((c) => c.id !== event.id)].slice(0, 50),
        trustedCalendarEvent: event,
      }).catch(() => {});
    }
    if (intent.action === "calendar.create" && execution.result?.event?.id) {
      const event = execution.result.event;
      const existingCandidates = Array.isArray(activeConversation.calendarCandidates) ? activeConversation.calendarCandidates : [];
      const existingIds = Array.isArray(activeConversation.calendarEventIds) ? activeConversation.calendarEventIds : [];
      await contextService.update({
        userId: user._id, conversationId,
        calendarEventIds: [...new Set([event.id, ...existingIds])].slice(0, 50),
        calendarCandidates: [event, ...existingCandidates].slice(0, 50),
        trustedCalendarEvent: event,
      }).catch(() => {});
    }
    if (intent.action === "calendar.update" && execution.result?.event?.id) {
      const event = execution.result.event;
      const existingCandidates = Array.isArray(activeConversation.calendarCandidates) ? activeConversation.calendarCandidates : [];
      await contextService.update({ userId: user._id, conversationId, trustedCalendarEvent: event,
        calendarCandidates: [event, ...existingCandidates.filter((candidate) => candidate.id !== event.id)] }).catch(() => {});
    }
    if (intent.action === "calendar.delete") {
      // The event no longer exists — drop it from trusted state so it can't be referenced again.
      const remainingCandidates = (activeConversation.calendarCandidates || []).filter((c) => c.id !== intent.parameters.eventId);
      const remainingIds = (activeConversation.calendarEventIds || []).filter((id) => id !== intent.parameters.eventId);
      await contextService.update({ userId: user._id, conversationId, calendarEventIds: remainingIds, calendarCandidates: remainingCandidates, trustedCalendarEvent: null }).catch(() => {});
    }
    return { status: "success", action: intent.action, result: { ...safeResult(execution.result), ...(chosenTimeZone ? { timeZone: chosenTimeZone, timeZoneLabel: describeTimeZone(chosenTimeZone), timeZoneDefaulted, timeZoneCountry: timeZoneDefaulted ? (user.country || null) : null } : {}) } };
  };

  // Content-only revision of the currently trusted draft ("make it more
  // casual"). The draftId, recipient/subject (new-message drafts) or original
  // messageId (reply drafts) all come from server-trusted conversation state
  // — the model supplies only the revised body text.
  const executeDraftEdit = async ({ user, conversationId, intent, conversation, approval, attachments }) => {
    const draft = conversation.trustedDraft;
    if (!draft || !draft.draftId || !DRAFT_ACTIONS.has(draft.action)) {
      return { status: "rejected", reason: "no_active_draft_to_edit" };
    }
    let resolvedAttachments = attachments;
    if (resolvedAttachments === undefined) {
      try { resolvedAttachments = await getAttachmentsForUser({ user, attachmentIds: (draft.attachments || []).map((item) => item.id).filter(Boolean) }); }
      catch (error) { return { status: "rejected", reason: error.code || "attachment_not_found" }; }
    }
    const payload = draft.action === "gmail.draft.reply"
      ? { draftId: draft.draftId, body: intent.parameters.body, replyToMessageId: draft.messageId, attachments: resolvedAttachments }
      : { draftId: draft.draftId, body: intent.parameters.body, recipient: draft.recipient, subject: draft.subject, threadId: draft.threadId, attachments: resolvedAttachments };
    const target = { type: "gmail_message", id: draft.draftId };
    const execution = await actionExecutor({ user, provider: "google", action: "gmail.draft.update", payload, target, approval, conversationId });
    if (execution.status !== "success") return { status: execution.status, action: "gmail.draft.edit" };
    await contextService.update({ userId: user._id, conversationId, trustedDraft: { ...draft, body: intent.parameters.body, attachments: resolvedAttachments } }).catch(() => {});
    return { status: "success", action: "gmail.draft.edit", result: safeResult(execution.result) };
  };

  // "send it" / "send the draft" resolver. Only triggers when a server-trusted
  // draft exists in the conversation context.
  const executeTrustedDraftSend = async ({ user, conversationId, message, conversation, approval }) => {
    if (!SEND_FOLLOWUP.test(message)) return null;
    const draft = conversation.trustedDraft;
    if (!draft || typeof draft !== "object") return null;
    const originalAction = draft.action;
    let sendAction;
    let payload;
    let target;
    if (originalAction === "gmail.draft.reply") {
      sendAction = "gmail.send.reply";
      // For a reply draft we use the trusted messageId the reply was created
      // against. The Gmail provider will re-resolve recipient/thread server-side.
      if (!draft.messageId) return null;
      let attachments;
      try { attachments = await getAttachmentsForUser({ user, attachmentIds: (draft.attachments || []).map((item) => item.id).filter(Boolean) }); }
      catch (error) { return { status: "rejected", reason: error.code || "attachment_not_found" }; }
      payload = { messageId: draft.messageId, recipient: draft.recipient || conversation.trustedTarget?.email || "", subject: draft.subject || "", body: draft.body || "", attachments };
      target = { type: "gmail_message", id: draft.messageId };
    } else if (originalAction === "gmail.draft") {
      sendAction = "gmail.send";
      if (!draft.recipient) return null;
      let attachments;
      try { attachments = await getAttachmentsForUser({ user, attachmentIds: (draft.attachments || []).map((item) => item.id).filter(Boolean) }); }
      catch (error) { return { status: "rejected", reason: error.code || "attachment_not_found" }; }
      payload = {
        recipient: draft.recipient,
        subject: draft.subject || generateSubjectFromBody(draft.body),
        body: draft.body || "",
        attachments,
      };
      target = { type: "gmail", id: null, label: null };
    } else if (SEND_ACTIONS.has(originalAction)) {
      // Already a send action; this shouldn't normally happen but handle it.
      return null;
    } else {
      return null;
    }
    const execution = await actionExecutor({ user, provider: "google", action: sendAction, payload, target, approval, conversationId });
    if (execution.status === "success") {
      // Clear the draft context since we've sent it.
      await contextService.update({ userId: user._id, conversationId, trustedDraft: null }).catch(() => {});
      if (Array.isArray(draft.attachments) && draft.attachments.length) {
        await removeAttachments({ user, attachmentIds: draft.attachments.map((a) => a.id).filter(Boolean) }).catch(() => {});
      }
    }
    return { status: execution.status, action: sendAction, pendingAction: execution.pendingAction, result: execution.status === "success" ? safeResult(execution.result) : undefined };
  };

  // Executes the compound "search then reply" flow:
  //   1. Runs gmail.search under the search permission.
  //   2. Stores trusted candidates in the user's conversation context.
  //   3. Resolves identity + message deterministically.
  //   4. Continues to gmail.draft.reply / gmail.send.reply under the reply permission.
  // No permission is ever conflated: search needs its own grant, reply needs its own grant.
  const executeSearchThenReply = async ({ user, conversationId, message, intent, activeConversation, approval, attachments = [] }) => {
    const replyAction = replyActionFor(intent.action);
    const searchPayload = { query: intent.parameters.query, maxResults: intent.parameters.maxResults || undefined };
    const searchTarget = { type: "gmail", id: null, label: null };
    // Step 1 — execute gmail.search (subject to its own permission check)
    const searchExecution = await actionExecutor({ user, provider: "google", action: "gmail.search", payload: searchPayload, target: searchTarget, approval });
    if (searchExecution.status !== "success") {
      return { status: searchExecution.status, action: intent.action };
    }
    // Step 2 — store server-trusted candidates in conversation context
    const candidates = normalizedCandidates(searchExecution.result);
    if (candidates.length) {
      const retrievedContext = candidates.map(({ id, ...candidate }) => ({ source: "gmail", content: JSON.stringify(candidate) }));
      await contextService.update({ userId: user._id, conversationId, gmailMessageIds: candidates.map(({ id }) => id), gmailCandidates: candidates, retrievedContext });
    }
    // Step 3 — identity + message resolution (deduplicated by identity)
    if (!candidates.length) {
      return { status: "not_found", action: intent.action, message: "I couldn't find any emails matching that search." };
    }
    const targetQuery = replyIdentityQuery(message);
    // Always stop at identity selection. The former code below is retained for
    // compatibility but is unreachable: conversations must be re-searched
    // only after the selected account is trusted.
    const matching = targetQuery && !PRONOUN_REPLY.test(targetQuery)
      ? candidates.flatMap((candidate) => (candidate.participants || [{ email: candidate.email, displayName: candidate.displayName }])
        .filter((person) => String(person.email || "").toLowerCase().startsWith(`${targetQuery.toLowerCase()}@`)
          || String(person.displayName || "").toLowerCase().includes(targetQuery.toLowerCase()))
        .map((person) => ({ ...candidate, email: person.email, displayName: person.displayName })))
      : candidates;
    // A requested person's identity must come from sender/recipient headers.
    // Falling back to every Gmail hit here made body mentions look like people.
    if (targetQuery && !PRONOUN_REPLY.test(targetQuery) && matching.length === 0) {
      return { status: "not_found", action: intent.action, message: `I couldn't find a Gmail identity matching ${targetQuery}.` };
    }
    const identities = identityGroupsToCandidates(groupCandidatesByIdentity(targetQuery && !PRONOUN_REPLY.test(targetQuery) ? matching : candidates));
    if (identities.length > 0) {
      await contextService.update({ userId: user._id, conversationId,
        pendingInteraction: { stage: "identity_selection", action: replyAction, body: intent.parameters.body, subject: intent.parameters.subject || null, selectedIdentity: null, identityCandidates: identities },
        pendingGmailReply: null, pendingAmbiguity: null });
      return { status: "ambiguous_identity", action: intent.action,
        candidates: identities.map((candidate, index) => publicIdentityCandidate(candidate, index)),
        prompt: `Which ${targetQuery || "person"} do you mean?` };
    }

    const resolution = resolveAmbiguity(targetQuery, candidates);
    if (resolution.status === "ambiguous") {
      const displayedAmbiguityType = resolution.ambiguityType;
      const displayedCandidates = resolution.candidates;
      await contextService.update({
        userId: user._id, conversationId,
        pendingGmailReply: { action: replyAction, body: intent.parameters.body },
        pendingAmbiguity: {
          action: replyAction,
          body: intent.parameters.body,
          ambiguityType: displayedAmbiguityType,
          candidateSelectionList: displayedCandidates,
        },
      });
      return {
        status: statusForAmbiguity(displayedAmbiguityType),
        action: intent.action,
        candidates: formatCandidates(displayedCandidates, displayedAmbiguityType),
        prompt: candidatePrompt(targetQuery, displayedCandidates, {
          ambiguityType: displayedAmbiguityType,
          identityDisplayName: resolution.identityDisplayName,
          identityEmail: resolution.identityEmail,
        }),
      };
    }
    if (resolution.status !== "resolved") {
      return { status: "not_found", action: intent.action, message: "I couldn't identify a unique recipient from the search results." };
    }
    // Step 4 — execute the reply under its own independent permission check.
    // The server-trusted message ID comes from resolution.identity.id (never from the model or client).
    const trustedMessageId = resolution.identity.id;
    const replyTarget = { type: "gmail_message", id: trustedMessageId };
    const replyPayload = { messageId: trustedMessageId, recipient: resolution.identity.email || "", subject: resolution.identity.subject || "", body: intent.parameters.body, ...(attachments?.length ? { attachments } : {}) };
    await persistTrustedTarget({ user, conversationId, candidate: resolution.identity });
    const replyExecution = await actionExecutor({ user, provider: "google", action: replyAction, payload: replyPayload, target: replyTarget, approval, conversationId });
    if (replyExecution.status !== "success") {
      return { status: replyExecution.status, action: replyAction, pendingAction: replyExecution.pendingAction };
    }
    await persistDraftContext({ user, conversationId, action: replyAction, result: replyExecution.result, payload: replyPayload, candidate: resolution.identity });
    if (SEND_ACTIONS.has(replyAction) && attachments?.length) {
      await removeAttachments({ user, attachmentIds: attachments.map((a) => a.id).filter(Boolean) }).catch(() => {});
    }
    return { status: "success", action: replyAction, result: safeResult(replyExecution.result) };
  };

  // Shared by both the main gmail.read flow and the gmail_select:N shortcut so
  // clicking a search result behaves exactly like the model proposing gmail.read.
  const persistReadMessageContext = async ({ user, conversationId, activeConversation, message: msg }) => {
    const emailMatch = msg.from?.email || (typeof msg.sender === "string" ? msg.sender.match(/<([^<>]+)>/)?.[1] || (EMAIL.test(msg.sender) ? msg.sender : null) : null);
    const nameClean = msg.from?.name || (typeof msg.sender === "string" ? msg.sender.replace(/<[^>]+>/, "").trim() : null);
    const readCandidate = {
      id: msg.id,
      threadId: cleanText(msg.threadId, 200),
      email: cleanText(emailMatch, 320),
      displayName: cleanText(nameClean || msg.sender, 320),
      subject: cleanText(msg.subject, 500),
      date: cleanText(msg.date, 100),
      snippet: cleanText(msg.snippet, 1000),
    };
    const existingCandidates = Array.isArray(activeConversation.gmailCandidates) ? activeConversation.gmailCandidates : [];
    const updatedCandidates = [readCandidate, ...existingCandidates.filter((c) => c.id !== readCandidate.id)].slice(0, 50);
    const existingIds = Array.isArray(activeConversation.gmailMessageIds) ? activeConversation.gmailMessageIds : [];
    const updatedIds = [...new Set([readCandidate.id, ...existingIds])].slice(0, 50);
    const retrievedContext = updatedCandidates.map(({ id, ...candidate }) => ({ source: "gmail", content: JSON.stringify(candidate) }));
    await contextService.update({ userId: user._id, conversationId, gmailMessageIds: updatedIds, gmailCandidates: updatedCandidates, retrievedContext });
  };

  // Opening a message is the user explicitly choosing to read it, so marking it
  // read (like any mail client) is covered by that same action. It is passed as
  // a one-time approval so it works without a separate permission prompt —
  // previously it silently did nothing unless the user had already granted
  // gmail.markRead permanently, which new users never had. An explicit "deny"
  // for gmail.markRead is still honoured by actionExecutor. Failure never
  // affects the read result; it is logged and reported as false.
  const autoMarkMessageRead = async ({ user, conversationId, messageId }) => {
    if (!messageId) return false;
    try {
      const outcome = await actionExecutor({ user, provider: "google", action: "gmail.markRead", payload: { messageIds: [messageId] }, target: { type: "gmail_message", id: null }, approval: "allow_once", conversationId });
      if (outcome.status !== "success") console.warn(`[NOMI] auto mark-as-read skipped: status=${outcome.status}`);
      return outcome.status === "success";
    } catch (error) {
      console.warn(`[NOMI] auto mark-as-read failed: code=${error?.code || "unknown"}`);
      return false;
    }
  };

  const execute = async ({ user, conversationId, message, proposal, conversation, approval, attachmentIds }) => {
    let activeConversation = conversation || await contextService.getActive({ userId: user._id, conversationId });
    if (!activeConversation) activeConversation = await contextService.create({ userId: user._id, conversationId });

    let resolvedAttachments = [];
    if (Array.isArray(attachmentIds) && attachmentIds.length) {
      try {
        resolvedAttachments = await getAttachmentsForUser({ user, attachmentIds });
      } catch (attErr) {
        return { status: "rejected", reason: attErr.code || "attachment_validation_failed" };
      }
    }

    const calendarSelection = String(message || "").match(/^calendar_select:(\d+)$/);
    if (calendarSelection) {
      const index = Number(calendarSelection[1]) - 1;
      const candidates = Array.isArray(activeConversation.calendarCandidates) ? activeConversation.calendarCandidates : [];
      const selected = candidates[index];
      if (!selected?.id) return { status: "rejected", reason: "invalid_calendar_selection" };
      await contextService.update({ userId: user._id, conversationId, trustedCalendarEvent: selected });
      return { status: "success", action: "calendar.selected", result: { event: publicCalendarCandidate(selected, index) } };
    }

    // Clicking a Gmail search result. The client only ever passes back the
    // 1-based position it was shown (selectionId) — never a Gmail message ID —
    // so the actual ID always comes from this conversation's own server-side
    // trusted list, resolved the same way any other message reference is.
    const gmailSelection = String(message || "").match(/^gmail_select:(\d+)$/);
    if (gmailSelection) {
      const index = Number(gmailSelection[1]) - 1;
      const trustedIds = Array.isArray(activeConversation.gmailMessageIds) ? activeConversation.gmailMessageIds : [];
      const id = trustedIds[index];
      if (!id) return { status: "rejected", reason: "invalid_gmail_selection" };
      const execution = await actionExecutor({ user, provider: "google", action: "gmail.read", payload: { messageId: id }, target: { type: "gmail_message", id }, approval, conversationId });
      if (execution.status !== "success") return { status: execution.status, action: "gmail.read", pendingAction: execution.pendingAction };
      if (execution.result?.message) await persistReadMessageContext({ user, conversationId, activeConversation, message: execution.result.message });
      const markedRead = await autoMarkMessageRead({ user, conversationId, messageId: id });
      return { status: "success", action: "gmail.read", result: { ...safeResult(execution.result), markedRead } };
    }

    const interactionOutcome = await executePendingInteraction({ user, conversationId, message, conversation: activeConversation, approval });
    if (interactionOutcome) return interactionOutcome;

    // A prior compound search may be waiting for an explicit user selection.
    // This runs before interpreting the newly generated proposal, so "1" cannot
    // trigger a fresh search or introduce a model/client-supplied Gmail ID.
    // We only route to the pending handler if the message looks like a selection.
    if (activeConversation.pendingGmailReply && looksLikeAmbiguityResolution(message)) {
      return executePendingReply({ user, conversationId, message, conversation: activeConversation, approval });
    }
    // If there's a pendingGmailReply but the message is a NEW instruction, clear
    // the stale pending state so the new proposal runs cleanly.
    if (activeConversation.pendingGmailReply && !looksLikeAmbiguityResolution(message)) {
      await contextService.update({ userId: user._id, conversationId, pendingGmailReply: null, pendingAmbiguity: null }).catch(() => {});
      activeConversation.pendingGmailReply = null;
      activeConversation.pendingAmbiguity = null;
    }

    // A non-compound ambiguity may be pending from a prior turn.
    if (activeConversation.pendingAmbiguity && !activeConversation.pendingGmailReply && looksLikeAmbiguityResolution(message)) {
      const pendingOutcome = await executePendingAmbiguity({ user, conversationId, message, conversation: activeConversation, approval });
      if (pendingOutcome) return pendingOutcome;
    }
    // Stale pendingAmbiguity with a new-style instruction: drop.
    if (activeConversation.pendingAmbiguity && !activeConversation.pendingGmailReply && !looksLikeAmbiguityResolution(message)) {
      await contextService.update({ userId: user._id, conversationId, pendingAmbiguity: null }).catch(() => {});
      activeConversation.pendingAmbiguity = null;
    }

    // "send it" / "send the draft" resolves strictly against server-trusted draft context.
    const sendFollowup = await executeTrustedDraftSend({ user, conversationId, message, conversation: activeConversation, approval });
    if (sendFollowup) return sendFollowup;

    if (!proposal || !proposal.action || !proposal.parameters) return { status: "invalid", reason: "invalid_proposal" };
    if (!SUPPORTED_ACTIONS.has(proposal.action)) return { status: "rejected", reason: "unsupported_action" };
    const intent = { action: proposal.action, parameters: { ...proposal.parameters } };

    if (CALENDAR_ACTIONS.has(intent.action)) {
      return executeCalendarAction({ user, conversationId, message, intent, activeConversation, approval });
    }

    // ── Compound search-then-reply flow ──────────────────────────────────────
    if (SEARCH_THEN_REPLY_ACTIONS.has(intent.action)) {
      return executeSearchThenReply({ user, conversationId, message, intent, activeConversation, approval, attachments: resolvedAttachments });
    }

    // Plain conversation: no Gmail/Calendar target, no privileged state to
    // touch. Never routed through actionExecutor/provider calls.
    if (intent.action === "chat.respond") {
      const chatText = cleanText(intent.parameters?.body, 4000) || "Hi! How can I help with your email or calendar today?";
      return { status: "chat", action: "chat.respond", message: chatText, prompt: chatText };
    }

    if (intent.action === "clarification") {
      const clarificationText = cleanText(intent.parameters?.body, 1000) || "Who would you like me to send this to?";
      return {
        status: "clarification",
        action: "clarification",
        message: clarificationText,
        prompt: clarificationText,
      };
    }

    if (intent.action === "gmail.draft.edit") {
      return executeDraftEdit({ user, conversationId, intent, conversation: activeConversation, approval, attachments: resolvedAttachments.length ? resolvedAttachments : undefined });
    }

    // Never takes a model-supplied ID. Operates only on whatever message IDs
    // are already server-trusted in this conversation (from a prior
    // search/read), the same trust boundary MESSAGE_ACTIONS enforces below.
    if (intent.action === "gmail.markRead") {
      const requested = Number.isInteger(intent.parameters?.maxResults) ? Math.min(Math.max(intent.parameters.maxResults, 1), 50) : 50;
      let trustedIds = (Array.isArray(activeConversation.gmailMessageIds) ? activeConversation.gmailMessageIds : []).slice(0, 50);
      if (!trustedIds.length) {
        // Nothing listed yet in this conversation: find the unread messages
        // server-side instead of failing, so "mark my last 3 unread as read"
        // works in one step. The IDs come from Gmail, never from the model.
        const searchExecution = await actionExecutor({ user, provider: "google", action: "gmail.search", payload: { query: "is:unread", maxResults: requested }, target: { type: "gmail_search", id: null }, approval, conversationId });
        if (searchExecution.status !== "success") return { status: searchExecution.status, action: "gmail.search", pendingAction: searchExecution.pendingAction };
        const found = normalizedCandidates(searchExecution.result);
        if (!found.length) return { status: "not_found", action: intent.action, message: "You have no unread emails to mark as read." };
        trustedIds = found.map(({ id }) => id);
        await contextService.update({ userId: user._id, conversationId, gmailMessageIds: trustedIds, gmailCandidates: found, retrievedContext: found.map(({ id, ...candidate }) => ({ source: "gmail", content: JSON.stringify(candidate) })) });
      }
      // Search results are newest-first, so "the last N" is the first N.
      const idsToMark = trustedIds.slice(0, requested);
      const execution = await actionExecutor({ user, provider: "google", action: intent.action, payload: { messageIds: idsToMark }, target: { type: "gmail_message", id: null }, approval, conversationId });
      if (execution.status !== "success") return { status: execution.status, action: intent.action, pendingAction: execution.pendingAction };
      return { status: "success", action: intent.action, result: safeResult(execution.result) };
    }

    if (REPLY_ACTIONS.has(intent.action)) {
      const resolution = selectReplyCandidate(message, activeConversation);
      if (resolution.status === "ambiguous") {
        const displayedAmbiguityType = resolution.ambiguityType;
        const displayedCandidates = resolution.candidates;
        await contextService.update({
          userId: user._id, conversationId,
          pendingAmbiguity: {
            action: intent.action,
            body: intent.parameters.body,
            ambiguityType: displayedAmbiguityType,
            candidateSelectionList: displayedCandidates,
          },
        });
        return {
          status: statusForAmbiguity(displayedAmbiguityType),
          candidates: formatCandidates(displayedCandidates, displayedAmbiguityType),
          prompt: candidatePrompt(null, displayedCandidates, {
            ambiguityType: displayedAmbiguityType,
            identityDisplayName: resolution.identityDisplayName,
            identityEmail: resolution.identityEmail,
          }),
        };
      }
      if (resolution.status === "resolved") {
        intent.parameters.messageId = resolution.identity.id;
        await persistTrustedTarget({ user, conversationId, candidate: resolution.identity });
      }
    }
    // Recheck at the execution boundary. The model's validated proposal is
    // never enough by itself, and client input has no path to this value.
    if (MESSAGE_ACTIONS.has(intent.action)
      && !(activeConversation.gmailMessageIds || []).includes(intent.parameters.messageId)) {
      return { status: "rejected", reason: "untrusted_or_unknown_message_id" };
    }
    if (NEW_MESSAGE_ACTIONS.has(intent.action)) {
      // recipient may be one address or a comma/semicolon separated list. Every
      // token is rechecked here with the exact rule a single recipient always
      // had: a self marker resolves only to the authenticated user's own
      // address, and any other address must appear verbatim in the user's own
      // message (or be the person they clicked). The model cannot add anyone.
      const tokens = splitRecipientTokens(intent.parameters.recipient);
      if (!tokens.length || tokens.length > MAX_RECIPIENTS) return { status: "rejected", reason: "untrusted_recipient_email" };
      const userEmail = typeof user?.email === "string" && EMAIL.test(user.email.trim()) ? user.email.trim().toLowerCase() : null;
      const trustedPersonEmail = String(activeConversation.trustedGmailPerson?.email || "").toLowerCase();
      const resolved = [];
      const externalRecipients = [];
      for (const token of tokens) {
        if (isSelfRecipient({ recipient: token })) {
          if (!userEmail) return { status: "rejected", reason: "untrusted_recipient_email" };
          resolved.push(userEmail);
        } else if (!EMAIL.test(token)
          || (!message.toLowerCase().includes(token.toLowerCase()) && trustedPersonEmail !== token.toLowerCase())) {
          return { status: "rejected", reason: "untrusted_recipient_email" };
        } else {
          resolved.push(token);
          externalRecipients.push(token);
        }
      }
      const seen = new Set();
      intent.parameters.recipient = resolved.filter((address) => !seen.has(address.toLowerCase()) && seen.add(address.toLowerCase())).join(", ");
      // Domain sanity check — a typo-of-a-known-provider or a domain with no
      // mail server at all is surfaced to the user instead of silently
      // sending/drafting to it. Never flags an unfamiliar domain that
      // resolves fine — that's just someone's company address. Every external
      // recipient is checked; the first problem address is reported.
      for (const address of externalRecipients) {
        const domainCheck = await checkEmailDomain(address);
        if (domainCheck.status === "likely_typo" || domainCheck.status === "no_mail_server") {
          return { status: "email_domain_warning", action: intent.action, reason: domainCheck.status, domain: domainCheck.domain, suggestion: domainCheck.suggestion || null, correctedEmail: domainCheck.correctedEmail || null };
        }
      }
    }
    const target = MESSAGE_ACTIONS.has(intent.action)
      ? { type: "gmail_message", id: intent.parameters.messageId }
      : { type: "gmail", id: null, label: null };
    const executionPayload = payloadFor(intent);
    if (REPLY_ACTIONS.has(intent.action)) {
      const trustedReplyRecipient = activeConversation.trustedTarget?.email
        || activeConversation.gmailCandidates?.find((candidate) => candidate.id === intent.parameters.messageId)?.email;
      if (trustedReplyRecipient) executionPayload.recipient = String(trustedReplyRecipient).toLowerCase();
    }
    if (resolvedAttachments.length) executionPayload.attachments = resolvedAttachments;
    const execution = await actionExecutor({ user, provider: "google", action: intent.action, payload: executionPayload, target, approval, conversationId });
    if (execution.status !== "success") return { status: execution.status, action: intent.action, pendingAction: execution.pendingAction };

    if (SEND_ACTIONS.has(intent.action) && resolvedAttachments.length) {
      await removeAttachments({ user, attachmentIds: resolvedAttachments.map((a) => a.id).filter(Boolean) }).catch(() => {});
    }

    const candidates = intent.action === "gmail.search" ? normalizedCandidates(execution.result) : [];
    if (candidates.length) {
      const personQuery = intent.action === "gmail.search" ? personSearchQuery(message, intent.parameters.query) : null;
      if (personQuery) {
        const matching = candidates.flatMap((candidate) => (candidate.participants || [{ email: candidate.email, displayName: candidate.displayName }])
          .filter((person) => String(person.email || "").toLowerCase().startsWith(`${personQuery.toLowerCase()}@`)
            || String(person.displayName || "").toLowerCase().includes(personQuery.toLowerCase()))
          .map((person) => ({ ...candidate, email: person.email, displayName: person.displayName })));
        if (!matching.length) {
          await contextService.update({ userId: user._id, conversationId, pendingInteraction: null, gmailMessageIds: [], gmailCandidates: [], retrievedContext: [] });
          return { status: "not_found", action: "gmail.search", message: `I couldn't find a Gmail identity matching ${personQuery}.` };
        }
        const identities = identityGroupsToCandidates(groupCandidatesByIdentity(matching));
        await contextService.update({ userId: user._id, conversationId,
          pendingInteraction: { stage: "identity_selection", action: "gmail.search", selectedIdentity: null, identityCandidates: identities },
          gmailMessageIds: candidates.map((item) => item.id), gmailCandidates: candidates });
        return { status: "ambiguous_identity", action: "gmail.search", candidates: identities.map((candidate, index) => publicIdentityCandidate(candidate, index)) };
      }
      const retrievedContext = candidates.map(({ id, ...candidate }) => ({ source: "gmail", content: JSON.stringify(candidate) }));
      await contextService.update({ userId: user._id, conversationId, gmailMessageIds: candidates.map(({ id }) => id), gmailCandidates: candidates, retrievedContext });
    } else if (intent.action === "gmail.read" && execution.result?.message) {
      await persistReadMessageContext({ user, conversationId, activeConversation, message: execution.result.message });
      await autoMarkMessageRead({ user, conversationId, messageId: execution.result.message.id });
    }

    // Persist trusted draft context for follow-up "send it".
    if (DRAFT_ACTIONS.has(intent.action) || NEW_MESSAGE_ACTIONS.has(intent.action)) {
      const resolvedCandidate = REPLY_ACTIONS.has(intent.action) ? activeConversation.gmailCandidates?.find((c) => c.id === intent.parameters.messageId) : null;
      await persistDraftContext({
        user, conversationId, action: intent.action,
        result: execution.result,
        payload: executionPayload,
        candidate: resolvedCandidate || null,
      });
    }

    let searchDomainHint = null;
    if (intent.action === "gmail.search" && !candidates.length) {
      const rawQuery = String(intent.parameters.query || "").trim();
      if (EMAIL.test(rawQuery)) {
        const domainCheck = await checkEmailDomain(rawQuery);
        if (domainCheck.status === "likely_typo" || domainCheck.status === "no_mail_server") searchDomainHint = domainCheck;
      }
    }

    return { status: "success", action: intent.action, result: intent.action === "gmail.search"
      ? { messages: candidates.map((c, i) => publicCandidate(c, i)), count: candidates.length, ...(searchDomainHint ? { domainHint: { reason: searchDomainHint.status, domain: searchDomainHint.domain, suggestion: searchDomainHint.suggestion || null } } : {}) }
      : safeResult(execution.result) };
  };
  return { execute, resolveAmbiguity, identityKey, groupCandidatesByIdentity };
};

module.exports = { createActionOrchestrator, normalizedCandidates, safeResult, replyIdentityQuery, isSelfRecipient, replyActionFor, SEARCH_THEN_REPLY_ACTIONS, displaySubject, identityKey, groupCandidatesByIdentity, SEND_FOLLOWUP };
