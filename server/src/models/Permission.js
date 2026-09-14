const mongoose = require("mongoose");

const permissionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    provider: { type: String, required: true, trim: true, lowercase: true },
    action: { type: String, required: true, trim: true },
    decision: { type: String, enum: ["always_allow", "deny"], required: true },
  },
  { timestamps: true }
);

permissionSchema.index({ user: 1, provider: 1, action: 1 }, { unique: true });

module.exports = mongoose.model("Permission", permissionSchema);
