const crypto = require("node:crypto");
const mongoose = require("mongoose");
const AttachmentReference = require("../../models/AttachmentReference");
const { validateAttachment, MAX_TOTAL_SIZE } = require("./attachmentValidator");

// The in-memory path exists only for isolated legacy unit tests. A connected
// application always uploads to Cloudinary and persists metadata in Mongo.
const stagingStore = new Map();
const ATTACHMENT_TTL_MS = 2 * 60 * 60 * 1000;
const cloudinaryConfig = () => {
  const raw = process.env.CLOUDINARY_URL;
  if (!raw) return null;
  let parsed;
  try { parsed = new URL(raw); } catch { return null; }
  return parsed.protocol === "cloudinary:" && parsed.hostname && parsed.username && parsed.password
    ? { cloudName: parsed.hostname, apiKey: decodeURIComponent(parsed.username), apiSecret: decodeURIComponent(parsed.password) }
    : null;
};
const RESOURCE_TYPES = new Set(["image", "video", "raw"]);
const cloudinaryUpload = async ({ id, filename, mimeType, buffer, resourceType = "image" }) => {
  const kind = RESOURCE_TYPES.has(resourceType) ? resourceType : "raw";
  const config = cloudinaryConfig();
  if (!config) { const error = new Error("Cloudinary server configuration is missing"); error.code = "attachment_storage_not_configured"; throw error; }
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = "nomi-attachments";
  const signature = crypto.createHash("sha1").update(`folder=${folder}&public_id=${id}&timestamp=${timestamp}${config.apiSecret}`).digest("hex");
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), filename);
  form.append("api_key", config.apiKey);
  form.append("timestamp", String(timestamp));
  form.append("folder", folder);
  form.append("public_id", id);
  form.append("signature", signature);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/${kind}/upload`, { method: "POST", body: form });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.public_id || !result.secure_url) {
    const error = new Error("Cloudinary could not store this attachment"); error.code = "attachment_cloudinary_upload_failed"; throw error;
  }
  return result;
};
const cloudinaryDestroy = async (publicId, resourceType = "image") => {
  const kind = RESOURCE_TYPES.has(resourceType) ? resourceType : "raw";
  const config = cloudinaryConfig();
  if (!config) return;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHash("sha1").update(`public_id=${publicId}&timestamp=${timestamp}${config.apiSecret}`).digest("hex");
  const form = new FormData();
  form.append("public_id", publicId); form.append("api_key", config.apiKey);
  form.append("timestamp", String(timestamp)); form.append("signature", signature);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/${kind}/destroy`, { method: "POST", body: form });
  if (!response.ok) { const error = new Error("Cloudinary could not remove this attachment"); error.code = "attachment_cloudinary_delete_failed"; throw error; }
  return response.json().catch(() => ({}));
};
const purgeExpired = () => {
  const now = Date.now();
  for (const [id, item] of stagingStore) if (now - item.createdAt > ATTACHMENT_TTL_MS) stagingStore.delete(id);
};
const publicMetadata = (item) => ({ id: item.id, filename: item.filename, mimeType: item.mimeType, size: item.size });

const storeAttachment = async ({ user, chatId = null, filename, mimeType, data }) => {
  purgeExpired();
  if (!user?._id) { const error = new Error("User authentication required for attachment storage"); error.code = "unauthenticated_attachment_upload"; throw error; }
  const validation = validateAttachment({ filename, mimeType, data });
  if (!validation.valid) { const error = new Error(validation.message); error.code = validation.code; throw error; }
  const id = crypto.randomUUID();
  if (mongoose.connection.readyState === 1) {
    const uploaded = await cloudinaryUpload({ id, filename: validation.filename, mimeType: validation.mimeType, buffer: validation.buffer, resourceType: validation.kind });
    try {
      const record = await AttachmentReference.create({ id, user: user._id, chat: chatId && mongoose.isValidObjectId(chatId) ? chatId : null,
        publicId: uploaded.public_id, secureUrl: uploaded.secure_url, filename: validation.filename,
        mimeType: validation.mimeType, resourceType: uploaded.resource_type || validation.kind || "image", size: validation.size,
        expiresAt: new Date(Date.now() + ATTACHMENT_TTL_MS) });
      return publicMetadata(record);
    } catch (error) {
      await cloudinaryDestroy(uploaded.public_id, uploaded.resource_type || validation.kind).catch(() => {});
      throw error;
    }
  }
  const record = { id, userId: String(user._id), filename: validation.filename, mimeType: validation.mimeType,
    size: validation.size, buffer: validation.buffer, createdAt: Date.now() };
  stagingStore.set(id, record);
  return publicMetadata(record);
};

const getAttachment = async ({ user, attachmentId, includeBuffer = true }) => {
  purgeExpired();
  if (!user?._id) return null;
  if (mongoose.connection.readyState === 1) {
    const item = await AttachmentReference.findOne({ id: attachmentId, user: user._id, expiresAt: { $gt: new Date() } }).lean();
    if (!item) return null;
    return { ...publicMetadata(item), ...(includeBuffer ? { buffer: Buffer.from(await (await fetch(item.secureUrl)).arrayBuffer()) } : {}) };
  }
  const item = stagingStore.get(attachmentId);
  return !item || item.userId !== String(user._id) ? null : { ...publicMetadata(item), buffer: item.buffer };
};

const getAttachmentsForUser = async ({ user, attachmentIds = [] }) => {
  purgeExpired();
  if (!user?._id) { const error = new Error("User authentication required"); error.code = "unauthenticated_attachment_access"; throw error; }
  if (!Array.isArray(attachmentIds) || !attachmentIds.length) return [];
  if (attachmentIds.length > 10) { const error = new Error("Maximum 10 attachments permitted"); error.code = "too_many_attachments"; throw error; }
  const refs = mongoose.connection.readyState === 1
    ? await AttachmentReference.find({ id: { $in: attachmentIds }, user: user._id, expiresAt: { $gt: new Date() } }).lean()
    : attachmentIds.map((id) => stagingStore.get(id)).filter((item) => item?.userId === String(user._id));
  const byId = new Map(refs.map((item) => [item.id, item]));
  const result = []; let totalSize = 0;
  for (const id of attachmentIds) {
    const item = byId.get(id);
    if (!item) { const error = new Error("Attachment not found or not owned by user"); error.code = "attachment_not_found"; throw error; }
    totalSize += item.size;
    if (totalSize > MAX_TOTAL_SIZE) { const error = new Error("Total attachment size exceeds maximum allowed"); error.code = "total_attachment_size_exceeded"; throw error; }
    let data = item.buffer;
    if (mongoose.connection.readyState === 1) {
      const response = await fetch(item.secureUrl);
      if (!response.ok) { const error = new Error("Stored attachment has expired or is unavailable"); error.code = "attachment_expired"; throw error; }
      data = Buffer.from(await response.arrayBuffer());
    }
    const verified = validateAttachment({ filename: item.filename, mimeType: item.mimeType, data });
    if (!verified.valid || verified.size !== item.size) { const error = new Error("Stored attachment failed validation"); error.code = "attachment_validation_failed"; throw error; }
    data = verified.buffer;
    result.push({ id: item.id, filename: item.filename, mimeType: item.mimeType, size: item.size, data });
  }
  return result;
};

const removeAttachments = async ({ user, attachmentIds = [] }) => {
  if (!user?._id || !Array.isArray(attachmentIds)) return;
  if (mongoose.connection.readyState === 1) {
    const records = await AttachmentReference.find({ id: { $in: attachmentIds }, user: user._id }).lean();
    for (const item of records) await cloudinaryDestroy(item.publicId, item.resourceType);
    await AttachmentReference.deleteMany({ id: { $in: records.map((item) => item.id) }, user: user._id });
    return;
  }
  for (const id of attachmentIds) {
    const item = stagingStore.get(id);
    if (item?.userId === String(user._id)) stagingStore.delete(id);
  }
};
const cleanupExpiredAttachments = async () => {
  if (mongoose.connection.readyState !== 1) return { deletedCount: 0 };
  const expired = await AttachmentReference.find({ expiresAt: { $lte: new Date() } }).lean();
  const deletedIds = [];
  for (const item of expired) {
    try { await cloudinaryDestroy(item.publicId, item.resourceType); deletedIds.push(item.id); } catch { /* retry on the next cleanup pass */ }
  }
  return deletedIds.length ? AttachmentReference.deleteMany({ id: { $in: deletedIds } }) : { deletedCount: 0 };
};
const clearAllForTesting = () => stagingStore.clear();

module.exports = { storeAttachment, getAttachment, getAttachmentsForUser, removeAttachments, cleanupExpiredAttachments, clearAllForTesting, cloudinaryConfig, cloudinaryUpload, cloudinaryDestroy };
