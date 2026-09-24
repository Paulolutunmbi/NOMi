const mongoose = require("mongoose");

const temporaryConversationSchema = new mongoose.Schema({
  conversationId: { type: String, required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  messages: { type: [mongoose.Schema.Types.Mixed], default: [] },
  retrievedContext: { type: [mongoose.Schema.Types.Mixed], default: [] },
  // This list is populated only by later server-side Gmail orchestration. It is
  // deliberately separate from retrieved content and client input.
  gmailMessageIds: { type: [String], default: [] },
  // Provider-derived only. Kept in the same user-bound TTL record as IDs so
  // the server can resolve a later natural-language reply without accepting a
  // client-supplied Gmail ID.
  gmailCandidates: { type: [mongoose.Schema.Types.Mixed], default: [] },
  // Present only while a compound search-then-reply is awaiting a user choice.
  // IDs remain server-only and are selected strictly from gmailCandidates.
  pendingGmailReply: { type: mongoose.Schema.Types.Mixed, default: null },
  // Server-trusted target for reply actions (messageId, threadId, email, subject, etc.)
  // Never sourced from the client or model.
  trustedTarget: { type: mongoose.Schema.Types.Mixed, default: null },
  // Set only by a server-resolved clickable identity selection.
  trustedGmailPerson: { type: mongoose.Schema.Types.Mixed, default: null },
  // Server-trusted draft context for "send it" style follow-ups.
  // draftId, threadId, messageId, recipient, subject, action are persisted here.
  // Never sourced from the client or model.
  trustedDraft: { type: mongoose.Schema.Types.Mixed, default: null },
  // Present when the user needs to resolve an identity or message ambiguity
  // (not just compound search-then-reply). Stores the intended action/body so
  // the next user message can resume against stored candidates without a fresh search.
  pendingAmbiguity: { type: mongoose.Schema.Types.Mixed, default: null },
  // The reply-disambiguation state machine. This is server-owned: public
  // selection IDs resolve only against the candidates stored here.
  pendingInteraction: { type: mongoose.Schema.Types.Mixed, default: null },
  // Same trust pattern as gmailMessageIds/gmailCandidates, for Calendar:
  // populated only by server-side calendar.search/read results, and required
  // before calendar.read/update/delete may reference an eventId.
  calendarEventIds: { type: [String], default: [] },
  calendarCandidates: { type: [mongoose.Schema.Types.Mixed], default: [] },
  trustedCalendarEvent: { type: mongoose.Schema.Types.Mixed, default: null },
  placeholderMappings: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

temporaryConversationSchema.index({ user: 1, conversationId: 1 }, { unique: true });

module.exports = mongoose.model("TemporaryConversation", temporaryConversationSchema);
