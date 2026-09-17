const mongoose = require("mongoose");

const temporaryConversationSchema = new mongoose.Schema({
  conversationId: { type: String, required: true, unique: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  messages: { type: [mongoose.Schema.Types.Mixed], default: [] },
  retrievedContext: { type: [mongoose.Schema.Types.Mixed], default: [] },
  placeholderMappings: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

module.exports = mongoose.model("TemporaryConversation", temporaryConversationSchema);
