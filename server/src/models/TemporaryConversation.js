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
  placeholderMappings: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

temporaryConversationSchema.index({ user: 1, conversationId: 1 }, { unique: true });

module.exports = mongoose.model("TemporaryConversation", temporaryConversationSchema);
