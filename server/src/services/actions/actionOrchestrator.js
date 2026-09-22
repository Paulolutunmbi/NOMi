const { executeAction } = require("./actionExecutor");
const { resolveIdentity } = require("../identity/identityResolver");
const { isSelfRecipientMarker, generateSubjectFromBody } = require("../ai/intentValidator");

const REPLY_ACTIONS = new Set(["gmail.draft.reply", "gmail.send.reply"]);
const DRAFT_ACTIONS = new Set(["gmail.draft", "gmail.draft.reply"]);
const SEND_ACTIONS = new Set(["gmail.send", "gmail.send.reply"]);
const NEW_MESSAGE_ACTIONS = new Set(["gmail.draft", "gmail.send"]);
const MESSAGE_ACTIONS = new Set(["gmail.read", ...REPLY_ACTIONS]);
// Compound intents: model proposes search query + reply body; the orchestrator
// resolves the trusted target server-side and then executes the reply.
const SEARCH_THEN_REPLY_ACTIONS = new Set(["gmail.search_then_reply", "gmail.search_then_draft_reply", "gmail.search_then_send_reply"]);
const SUPPORTED_ACTIONS = new Set(["gmail.search", "gmail.read", "gmail.draft", "gmail.send", "clarification", ...REPLY_ACTIONS, ...SEARCH_THEN_REPLY_ACTIONS]);
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
const normalizedCandidates = (result) => providerMessages(result)
  .filter((message) => typeof message?.id === "string" && message.id.trim())
  .slice(0, 50)
  .map((message) => {
    const fromObj = message.from && typeof message.from === "object" ? message.from : null;
    const parsedSender = typeof message.sender === "string" ? senderFromHeader(message.sender) : null;
    const email = cleanText(fromObj?.email || parsedSender?.email || message.fromEmail || message.email, 320);
    const displayName = cleanText(fromObj?.name || parsedSender?.name || message.fromName || message.displayName || (typeof message.from === "string" ? message.from : null), 320);
    const threadId = cleanText(message.threadId, 200);
    const subjectRaw = cleanText(message.subject, 500);
    return {
      id: message.id,
      threadId,
      email: email || null,
      displayName: displayName || null,
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
const publicIdentityCandidate = (candidate, index) => ({
  selectionId: typeof index === "number" ? String(index + 1) : null,
  name: candidate?.displayName || candidate?.name || null,
  email: candidate?.email || null,
  date: candidate?.date || null,
  snippet: typeof candidate?.snippet === "string" && candidate.snippet.trim() ? cleanText(candidate.snippet, 500) : null,
});
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
// Map a compound search_then_* action to the corresponding reply action.
const replyActionFor = (compoundAction) => {
  if (compoundAction === "gmail.search_then_send_reply") return "gmail.send.reply";
  return "gmail.draft.reply"; // search_then_reply and search_then_draft_reply both draft
};

const createActionOrchestrator = ({ contextService, actionExecutor = executeAction, resolve = resolveIdentity } = {}) => {
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
    if (!pending || !["identity_selection", "conversation_selection"].includes(pending.stage)) return null;
    const source = pending.stage === "identity_selection" ? pending.identityCandidates : pending.conversationCandidates;
    const selection = selectPendingCandidate(message, Array.isArray(source) ? source : []);
    if (selection.status !== "resolved") return { status: "clarification", action: pending.action,
      candidates: (source || []).map((c, i) => publicCandidate(c, i)),
      prompt: pending.stage === "identity_selection" ? "Please choose one of the matching accounts." : "Please choose one of the conversations." };
    const selected = selection.identity;
    if (pending.stage === "identity_selection") {
      if (!EMAIL.test(selected.email || "")) return { status: "rejected", reason: "selected_identity_has_no_email" };
      const selectedIdentity = { name: selected.displayName || selected.name || null, email: selected.email.toLowerCase() };
      const searchExecution = await actionExecutor({ user, provider: "google", action: "gmail.search",
        payload: { query: `from:${selectedIdentity.email}`, maxResults: 20 }, target: { type: "gmail", id: null, label: null }, approval });
      if (searchExecution.status !== "success") return { status: searchExecution.status, action: pending.action };
      const conversations = normalizedCandidates(searchExecution.result)
        .filter((candidate) => String(candidate.email || "").toLowerCase() === selectedIdentity.email);
      if (!conversations.length) return { status: "not_found", action: pending.action, message: `I couldn't find conversations from ${selectedIdentity.email}.` };
      const next = { ...pending, stage: "conversation_selection", selectedIdentity, conversationCandidates: conversations };
      await contextService.update({ userId: user._id, conversationId, pendingInteraction: next,
        gmailMessageIds: conversations.map((c) => c.id), gmailCandidates: conversations });
      return { status: "ambiguous_message", action: pending.action, selectedIdentity,
        candidates: conversations.map((c, i) => publicCandidate(c, i)),
        prompt: `Which conversation with ${selectedIdentity.name || selectedIdentity.email}?` };
    }
    const payload = { messageId: selected.id, body: pending.body };
    const execution = await actionExecutor({ user, provider: "google", action: pending.action, payload,
      target: { type: "gmail_message", id: selected.id }, approval });
    if (execution.status !== "success") return { status: execution.status, action: pending.action };
    await contextService.update({ userId: user._id, conversationId,
      pendingInteraction: { ...pending, stage: "draft_created", selectedConversation: selected } });
    await persistTrustedTarget({ user, conversationId, candidate: selected });
    await persistDraftContext({ user, conversationId, action: pending.action, result: execution.result, payload, candidate: selected });
    return { status: "success", action: pending.action, result: safeResult(execution.result) };
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
        status: displayedAmbiguityType === "message" ? "ambiguous_message" : "ambiguous_identity",
        action: pending.action,
        candidates: selection.candidates.map((c, i) => publicCandidate(c, i)),
        prompt: candidatePrompt(null, selection.candidates, {
          ambiguityType: selection.ambiguityType,
          identityDisplayName: selection.identityDisplayName,
          identityEmail: selection.identityEmail,
        }),
      };
    }
    if (selection.status !== "resolved") {
      return {
        status: "clarification",
        action: pending.action,
        candidates: candidates.map((c, i) => publicCandidate(c, i)),
        prompt: candidatePrompt(null, sourceCandidates, { ambiguityType }),
      };
    }
    const trustedMessageId = selection.identity.id;
    const execution = await actionExecutor({ user, provider: "google", action: pending.action,
      payload: { messageId: trustedMessageId, body: pending.body }, target: { type: "gmail_message", id: trustedMessageId }, approval });
    if (execution.status !== "success") return { status: execution.status, action: pending.action };
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
        status: displayedAmbiguityType === "message" ? "ambiguous_message" : "ambiguous_identity",
        action: pending.action,
        candidates: selection.candidates.map((c, i) => publicCandidate(c, i)),
        prompt: candidatePrompt(null, selection.candidates, {
          ambiguityType: selection.ambiguityType,
          identityDisplayName: selection.identityDisplayName,
          identityEmail: selection.identityEmail,
        }),
      };
    }
    if (selection.status !== "resolved") {
      return {
        status: "clarification",
        action: pending.action,
        candidates: candidates.map((c, i) => publicCandidate(c, i)),
        prompt: candidatePrompt(null, sourceCandidates, { ambiguityType }),
      };
    }
    await contextService.update({ userId: user._id, conversationId, pendingAmbiguity: null });
    const trustedMessageId = selection.identity.id;
    if (REPLY_ACTIONS.has(pending.action)) {
      const target = { type: "gmail_message", id: trustedMessageId };
      const payload = { messageId: trustedMessageId, body: pending.body };
      const execution = await actionExecutor({ user, provider: "google", action: pending.action, payload, target, approval });
      if (execution.status !== "success") return { status: execution.status, action: pending.action };
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
    };
    await contextService.update({ userId: user._id, conversationId, trustedDraft: draftData }).catch(() => {});
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
      payload = { messageId: draft.messageId, body: draft.body || "" };
      target = { type: "gmail_message", id: draft.messageId };
    } else if (originalAction === "gmail.draft") {
      sendAction = "gmail.send";
      if (!draft.recipient) return null;
      payload = {
        recipient: draft.recipient,
        subject: draft.subject || generateSubjectFromBody(draft.body),
        body: draft.body || "",
      };
      target = { type: "gmail", id: null, label: null };
    } else if (SEND_ACTIONS.has(originalAction)) {
      // Already a send action; this shouldn't normally happen but handle it.
      return null;
    } else {
      return null;
    }
    const execution = await actionExecutor({ user, provider: "google", action: sendAction, payload, target, approval });
    if (execution.status === "success") {
      // Clear the draft context since we've sent it.
      await contextService.update({ userId: user._id, conversationId, trustedDraft: null }).catch(() => {});
    }
    return { status: execution.status, action: sendAction, result: execution.status === "success" ? safeResult(execution.result) : undefined };
  };

  // Executes the compound "search then reply" flow:
  //   1. Runs gmail.search under the search permission.
  //   2. Stores trusted candidates in the user's conversation context.
  //   3. Resolves identity + message deterministically.
  //   4. Continues to gmail.draft.reply / gmail.send.reply under the reply permission.
  // No permission is ever conflated: search needs its own grant, reply needs its own grant.
  const executeSearchThenReply = async ({ user, conversationId, message, intent, activeConversation, approval }) => {
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
      ? candidates.filter((candidate) => String(candidate.email || "").toLowerCase().startsWith(`${targetQuery.toLowerCase()}@`)
        || String(candidate.displayName || "").toLowerCase().split(/\s+/).includes(targetQuery.toLowerCase()))
      : candidates;
    const identities = identityGroupsToCandidates(groupCandidatesByIdentity(matching.length ? matching : candidates));
    if (identities.length > 1) {
      await contextService.update({ userId: user._id, conversationId,
        pendingInteraction: { stage: "identity_selection", action: replyAction, body: intent.parameters.body, selectedIdentity: null, identityCandidates: identities },
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
        status: displayedAmbiguityType === "message" ? "ambiguous_message" : "ambiguous_identity",
        action: intent.action,
        candidates: displayedCandidates.map((c, i) => publicCandidate(c, i)),
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
    const replyPayload = { messageId: trustedMessageId, body: intent.parameters.body };
    await persistTrustedTarget({ user, conversationId, candidate: resolution.identity });
    const replyExecution = await actionExecutor({ user, provider: "google", action: replyAction, payload: replyPayload, target: replyTarget, approval });
    if (replyExecution.status !== "success") {
      return { status: replyExecution.status, action: replyAction };
    }
    await persistDraftContext({ user, conversationId, action: replyAction, result: replyExecution.result, payload: replyPayload, candidate: resolution.identity });
    return { status: "success", action: replyAction, result: safeResult(replyExecution.result) };
  };

  const execute = async ({ user, conversationId, message, proposal, conversation, approval }) => {
    let activeConversation = conversation || await contextService.getActive({ userId: user._id, conversationId });
    if (!activeConversation) activeConversation = await contextService.create({ userId: user._id, conversationId });

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

    // ── Compound search-then-reply flow ──────────────────────────────────────
    if (SEARCH_THEN_REPLY_ACTIONS.has(intent.action)) {
      return executeSearchThenReply({ user, conversationId, message, intent, activeConversation, approval });
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
          status: displayedAmbiguityType === "message" ? "ambiguous_message" : "ambiguous_identity",
          candidates: displayedCandidates.map((c, i) => publicCandidate(c, i)),
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
      if (isSelfRecipient({ recipient: intent.parameters.recipient })) {
        const userEmail = typeof user?.email === "string" && EMAIL.test(user.email.trim()) ? user.email.trim().toLowerCase() : null;
        if (!userEmail) return { status: "rejected", reason: "untrusted_recipient_email" };
        intent.parameters.recipient = userEmail;
      } else if (!EMAIL.test(intent.parameters.recipient || "") || !message.toLowerCase().includes(intent.parameters.recipient.toLowerCase())) {
        return { status: "rejected", reason: "untrusted_recipient_email" };
      }
    }
    const target = MESSAGE_ACTIONS.has(intent.action)
      ? { type: "gmail_message", id: intent.parameters.messageId }
      : { type: "gmail", id: null, label: null };
    const executionPayload = payloadFor(intent);
    const execution = await actionExecutor({ user, provider: "google", action: intent.action, payload: executionPayload, target, approval });
    if (execution.status !== "success") return { status: execution.status, action: intent.action };

    const candidates = intent.action === "gmail.search" ? normalizedCandidates(execution.result) : [];
    if (candidates.length) {
      const retrievedContext = candidates.map(({ id, ...candidate }) => ({ source: "gmail", content: JSON.stringify(candidate) }));
      await contextService.update({ userId: user._id, conversationId, gmailMessageIds: candidates.map(({ id }) => id), gmailCandidates: candidates, retrievedContext });
    } else if (intent.action === "gmail.read" && execution.result?.message) {
      const msg = execution.result.message;
      const emailMatch = typeof msg.sender === "string" ? msg.sender.match(/<([^<>]+)>/)?.[1] || (EMAIL.test(msg.sender) ? msg.sender : null) : null;
      const nameClean = typeof msg.sender === "string" ? msg.sender.replace(/<[^>]+>/, "").trim() : null;
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

    return { status: "success", action: intent.action, result: intent.action === "gmail.search"
      ? { messages: candidates.map((c, i) => publicCandidate(c, i)), count: candidates.length }
      : safeResult(execution.result) };
  };
  return { execute, resolveAmbiguity, identityKey, groupCandidatesByIdentity };
};

module.exports = { createActionOrchestrator, normalizedCandidates, safeResult, replyIdentityQuery, isSelfRecipient, replyActionFor, SEARCH_THEN_REPLY_ACTIONS, displaySubject, identityKey, groupCandidatesByIdentity };
