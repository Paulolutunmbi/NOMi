const mongoose = require("mongoose");

const attachmentReferenceSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  chat: { type: mongoose.Schema.Types.ObjectId, ref: "ChatSession", default: null, index: true },
  publicId: { type: String, required: true },
  secureUrl: { type: String, required: true },
  filename: { type: String, required: true, maxlength: 255 },
  mimeType: { type: String, required: true, maxlength: 100 },
  resourceType: { type: String, required: true, enum: ["image"] },
  size: { type: Number, required: true },
  // Cleanup is performed by the service so the corresponding Cloudinary
  // asset is deleted before its Mongo metadata is removed.
  expiresAt: { type: Date, required: true, index: true },
}, { timestamps: true, minimize: false });

module.exports = mongoose.models.AttachmentReference || mongoose.model("AttachmentReference", attachmentReferenceSchema);
