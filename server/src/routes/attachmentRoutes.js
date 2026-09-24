const express = require("express");
const { findOrCreateFromFirebaseClaims } = require("../services/users/userService");
const { storeAttachment, getAttachment, removeAttachments } = require("../services/attachments/attachmentService");
const ChatSession = require("../models/ChatSession");

const createAttachmentRouter = ({ authMiddleware, getUser = findOrCreateFromFirebaseClaims } = {}) => {
  const router = express.Router();
  const requireAuth = authMiddleware || require("../middleware/auth");

  // Accept up to 15MB JSON for base64 image uploads
  router.use(express.json({ limit: "15mb" }));

  router.post("/upload", requireAuth, async (req, res, next) => {
    try {
      const user = await getUser(req.user);
      const { filename, mimeType, data, chatId = null } = req.body || {};

      if (!data) {
        return res.status(400).json({
          success: false,
          error: { code: "ATTACHMENT_DATA_REQUIRED", message: "Attachment data is required" },
        });
      }

      if (chatId && !await ChatSession.exists({ _id: chatId, user: user._id })) {
        return res.status(404).json({ success: false, error: { code: "CHAT_NOT_FOUND", message: "This chat could not be found." } });
      }
      const attachment = await storeAttachment({ user, chatId, filename, mimeType, data });
      return res.status(201).json({
        success: true,
        attachment,
      });
    } catch (error) {
      if (error.code && error.code.startsWith("attachment_")) {
        return res.status(422).json({
          success: false,
          error: { code: error.code.toUpperCase(), message: error.message },
        });
      }
      next(error);
    }
  });

  router.get("/:id", requireAuth, async (req, res, next) => {
    try {
      const user = await getUser(req.user);
      const attachment = await getAttachment({ user, attachmentId: req.params.id, includeBuffer: false });
      if (!attachment) {
        return res.status(404).json({
          success: false,
          error: { code: "ATTACHMENT_NOT_FOUND", message: "Attachment not found" },
        });
      }

      // Return metadata only for security and privacy
      return res.status(200).json({
        success: true,
        attachment: {
          id: attachment.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id", requireAuth, async (req, res, next) => {
    try {
      const user = await getUser(req.user);
      await removeAttachments({ user, attachmentIds: [req.params.id] });
      return res.status(200).json({ success: true, message: "Attachment removed" });
    } catch (error) {
      next(error);
    }
  });

  return router;
};

module.exports = { createAttachmentRouter };
