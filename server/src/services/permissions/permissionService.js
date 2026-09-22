const Permission = require("../../models/Permission");

const checkPermission = async ({ userId, provider, action }) => {
  const permission = await Permission.findOne({ user: userId, provider, action }).lean();

  if (!permission) {
    return { allowed: false, requiresApproval: true, decision: null };
  }

  return {
    allowed: permission.decision === "always_allow",
    requiresApproval: false,
    decision: permission.decision,
  };
};

const savePersistentDecision = async ({ userId, provider, action, decision }) => {
  if (!["always_allow", "deny"].includes(decision)) {
    throw new Error("Persistent permission decisions must be always_allow or deny");
  }

  return Permission.findOneAndUpdate(
    { user: userId, provider, action },
    { $set: { decision } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

const listPersistentPermissions = async ({ userId }) => Permission.find({ user: userId, decision: "always_allow" })
  .select("provider action decision createdAt updatedAt")
  .sort({ provider: 1, action: 1 })
  .lean();

// This deliberately removes only the exact user/provider/action record. It
// does not touch a connected account or any neighbouring capabilities.
const revokePersistentPermission = async ({ userId, provider, action }) => Permission.deleteOne({
  user: userId,
  provider,
  action,
  decision: "always_allow",
});

module.exports = { checkPermission, savePersistentDecision, listPersistentPermissions, revokePersistentPermission };
