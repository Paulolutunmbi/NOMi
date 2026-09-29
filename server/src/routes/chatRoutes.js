const express = require("express");
const mongoose = require("mongoose");
const ChatSession = require("../models/ChatSession");
const ChatMessage = require("../models/ChatMessage");
const TemporaryConversation = require("../models/TemporaryConversation");
const { findOrCreateFromFirebaseClaims } = require("../services/users/userService");

const createChatRouter = ({ authMiddleware, getUser = findOrCreateFromFirebaseClaims, chatSessionModel = ChatSession, chatMessageModel = ChatMessage, temporaryConversationModel = TemporaryConversation } = {}) => {
  const router = express.Router();
  router.use(express.json({ limit: "1mb" }));
  const requireAuth = authMiddleware || require("../middleware/auth");
  router.use(requireAuth);
  const ownerChat = async (id, userId) => mongoose.isValidObjectId(id) ? chatSessionModel.findOne({ _id: id, user: userId }) : null;

  router.get("/", async (req, res, next) => {
    try {
      const user = await getUser(req.user);
      const filter = { user: user._id };
      if (["gmail", "calendar", "home"].includes(req.query.type)) filter.type = req.query.type;
      const chats = await chatSessionModel.find(filter).sort({ lastMessageAt: -1 }).lean();
      res.json({ success: true, chats: chats.map(({ _id, type, title, summary, lastMessageAt }) => ({ id: String(_id), type, title, summary, lastMessageAt })) });
    } catch (error) { next(error); }
  });

  router.post("/", async (req, res, next) => {
    try {
      const user = await getUser(req.user);
      const type = req.body?.type;
      if (!["gmail", "calendar", "home"].includes(type)) return res.status(400).json({ success: false, error: { code: "CHAT_TYPE_INVALID", message: "Choose a valid workspace." } });
      const chat = await chatSessionModel.create({ user: user._id, type });
      res.status(201).json({ success: true, chat: { id: String(chat._id), type: chat.type, title: chat.title, summary: chat.summary, lastMessageAt: chat.lastMessageAt } });
    } catch (error) { next(error); }
  });

  router.get("/:chatId", async (req, res, next) => {
    try {
      const user = await getUser(req.user);
      const chat = await ownerChat(req.params.chatId, user._id);
      if (!chat) return res.status(404).json({ success: false, error: { code: "CHAT_NOT_FOUND", message: "Chat not found." } });
      res.json({ success: true, chat: { id: String(chat._id), type: chat.type, title: chat.title, summary: chat.summary, lastMessageAt: chat.lastMessageAt } });
    } catch (error) { next(error); }
  });

  router.get("/:chatId/messages", async (req, res, next) => {
    try {
      const user = await getUser(req.user);
      const chat = await ownerChat(req.params.chatId, user._id);
      if (!chat) return res.status(404).json({ success: false, error: { code: "CHAT_NOT_FOUND", message: "Chat not found." } });
      const messages = await chatMessageModel.find({ chat: chat._id, user: user._id }).sort({ createdAt: 1 }).limit(500).lean();
      res.json({ success: true, chat: { id: String(chat._id), type: chat.type, summary: chat.summary }, messages: messages.map(({ _id, role, content, metadata, createdAt }) => ({ id: String(_id), role, content, metadata, createdAt })) });
    } catch (error) { next(error); }
  });

  // Deleting a chat removes its own messages and its server-trusted Gmail/
  // Calendar context (the TemporaryConversation record keyed by this chat's
  // id) along with it — nothing usable is left behind for that conversation.
  router.delete("/:chatId", async (req, res, next) => {
    try {
      const user = await getUser(req.user);
      const chat = await ownerChat(req.params.chatId, user._id);
      if (!chat) return res.status(404).json({ success: false, error: { code: "CHAT_NOT_FOUND", message: "Chat not found." } });
      await chatMessageModel.deleteMany({ chat: chat._id, user: user._id });
      await chatSessionModel.deleteOne({ _id: chat._id, user: user._id });
      await temporaryConversationModel.deleteOne({ conversationId: String(chat._id), user: user._id }).catch(() => {});
      res.json({ success: true, id: String(chat._id) });
    } catch (error) { next(error); }
  });

  router.post("/:chatId/messages", async (req, res, next) => {
    try {
      const user = await getUser(req.user);
      const chat = await ownerChat(req.params.chatId, user._id);
      if (!chat) return res.status(404).json({ success: false, error: { code: "CHAT_NOT_FOUND", message: "Chat not found." } });
      const { role, content, metadata = {} } = req.body || {};
      if (!["user", "assistant"].includes(role) || typeof content !== "string" || !content.trim() || content.length > 4000) return res.status(400).json({ success: false, error: { code: "CHAT_MESSAGE_INVALID", message: "A valid chat message is required." } });
      const safeMetadata = sanitizeChatMetadata(role, metadata);
      const message = await chatMessageModel.create({ chat: chat._id, user: user._id, role, content: content.trim(), metadata: safeMetadata });
      const recent = await chatMessageModel.find({ chat: chat._id, user: user._id }).sort({ createdAt: -1 }).limit(20).lean();
      await chatSessionModel.updateOne({ _id: chat._id, user: user._id }, { $set: { lastMessageAt: message.createdAt, ...(chat.title ? {} : role === "user" ? { title: content.trim().slice(0, 80) } : {}) } });
      // Bounded extractive rolling summary; it preserves prior user preferences without unbounded model history.
      const priorUserMessages = recent.filter((item) => item.role === "user").reverse().map((item) => item.content.slice(0, 240));
      if (priorUserMessages.length) await chatSessionModel.updateOne({ _id: chat._id, user: user._id }, { $set: { summary: priorUserMessages.slice(-12).join("\n").slice(-5000) } });
      res.status(201).json({ success: true, message: { id: String(message._id), role: message.role, content: message.content, metadata: message.metadata, createdAt: message.createdAt } });
    } catch (error) { next(error); }
  });

  return router;
};

const stripUnsafeMetadata = (value, depth = 0) => {
  if (depth > 5 || value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 4000);
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => stripUnsafeMetadata(item, depth + 1));
  if (typeof value !== "object") return undefined;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/^(?:buffer|data|bytes|raw|authorization|accessToken|refreshToken|secret)$/i.test(key))
    .slice(0, 40)
    .map(([key, item]) => [key, stripUnsafeMetadata(item, depth + 1)])
    .filter(([, item]) => item !== undefined));
};
const sanitizeChatMetadata = (role, value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  if (role === "user") return { attachments: (Array.isArray(value.attachments) ? value.attachments : []).slice(0, 10).map((item) => ({
    filename: typeof item?.filename === "string" ? item.filename.slice(0, 255) : "attachment",
    mimeType: typeof item?.mimeType === "string" ? item.mimeType.slice(0, 100) : "application/octet-stream",
    size: Number.isInteger(item?.size) ? item.size : undefined,
  })) };
  const permitted = {};
  for (const key of ["kind", "action", "result", "candidates", "selectedIdentity", "selectedConversation", "message", "options", "summary"]) {
    if (key in value) permitted[key] = stripUnsafeMetadata(value[key]);
  }
  const encoded = JSON.stringify(permitted);
  return encoded.length <= 16000 ? permitted : {};
};

module.exports = { createChatRouter, sanitizeChatMetadata };
