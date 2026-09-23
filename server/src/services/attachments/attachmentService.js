const crypto = require("node:crypto");
const { validateAttachment, validateAttachmentSet, MAX_TOTAL_SIZE } = require("./attachmentValidator");

// In-memory staging store for attachments pending send/draft.
// Map<attachmentId, { id, userId, filename, mimeType, size, buffer, createdAt }>
const stagingStore = new Map();
const ATTACHMENT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const purgeExpired = () => {
  const now = Date.now();
  for (const [id, item] of stagingStore.entries()) {
    if (now - item.createdAt > ATTACHMENT_TTL_MS) {
      stagingStore.delete(id);
    }
  }
};

const storeAttachment = async ({ user, filename, mimeType, data }) => {
  purgeExpired();
  if (!user || !user._id) {
    const error = new Error("User authentication required for attachment storage");
    error.code = "unauthenticated_attachment_upload";
    throw error;
  }

  const validation = validateAttachment({ filename, mimeType, data });
  if (!validation.valid) {
    const error = new Error(validation.message);
    error.code = validation.code;
    throw error;
  }

  const id = crypto.randomUUID();
  const userIdStr = user._id.toString();

  const record = {
    id,
    userId: userIdStr,
    filename: validation.filename,
    mimeType: validation.mimeType,
    size: validation.size,
    buffer: validation.buffer,
    createdAt: Date.now(),
  };

  stagingStore.set(id, record);

  // Return safe metadata only — never log or return the raw buffer
  return {
    id,
    filename: validation.filename,
    mimeType: validation.mimeType,
    size: validation.size,
  };
};

const getAttachment = async ({ user, attachmentId }) => {
  purgeExpired();
  if (!user || !user._id) return null;
  const userIdStr = user._id.toString();
  const item = stagingStore.get(attachmentId);
  if (!item || item.userId !== userIdStr) return null;

  return {
    id: item.id,
    filename: item.filename,
    mimeType: item.mimeType,
    size: item.size,
    buffer: item.buffer,
  };
};

const getAttachmentsForUser = async ({ user, attachmentIds = [] }) => {
  purgeExpired();
  if (!user || !user._id) {
    const error = new Error("User authentication required");
    error.code = "unauthenticated_attachment_access";
    throw error;
  }

  if (!Array.isArray(attachmentIds) || !attachmentIds.length) return [];

  const userIdStr = user._id.toString();
  const attachments = [];
  let totalSize = 0;

  for (const id of attachmentIds) {
    const item = stagingStore.get(id);
    if (!item || item.userId !== userIdStr) {
      const error = new Error(`Attachment ${id} not found or not owned by user`);
      error.code = "attachment_not_found";
      throw error;
    }

    totalSize += item.size;
    if (totalSize > MAX_TOTAL_SIZE) {
      const error = new Error("Total attachment size exceeds maximum allowed");
      error.code = "total_attachment_size_exceeded";
      throw error;
    }

    attachments.push({
      id: item.id,
      filename: item.filename,
      mimeType: item.mimeType,
      size: item.size,
      data: item.buffer,
    });
  }

  return attachments;
};

const removeAttachments = async ({ user, attachmentIds = [] }) => {
  if (!user || !user._id || !Array.isArray(attachmentIds)) return;
  const userIdStr = user._id.toString();
  for (const id of attachmentIds) {
    const item = stagingStore.get(id);
    if (item && item.userId === userIdStr) {
      stagingStore.delete(id);
    }
  }
};

const clearAllForTesting = () => {
  stagingStore.clear();
};

module.exports = {
  storeAttachment,
  getAttachment,
  getAttachmentsForUser,
  removeAttachments,
  clearAllForTesting,
};
