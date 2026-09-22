const express = require("express");
const { findOrCreateFromFirebaseClaims } = require("../services/users/userService");
const { listPersistentPermissions, revokePersistentPermission } = require("../services/permissions/permissionService");

const validPart = (value) => typeof value === "string" && /^[a-z][a-z0-9_.-]{0,127}$/i.test(value);

const createPermissionRouter = ({ authMiddleware, getUser = findOrCreateFromFirebaseClaims, list = listPersistentPermissions, revoke = revokePersistentPermission } = {}) => {
  const router = express.Router();
  const requireAuth = authMiddleware || require("../middleware/auth");
  router.get("/", requireAuth, async (req, res, next) => {
    try {
      const user = await getUser(req.user);
      const permissions = await list({ userId: user._id });
      return res.json({ success: true, permissions: permissions.map(({ provider, action, decision }) => ({ provider, action, decision })) });
    } catch (error) { return next(error); }
  });
  router.delete("/:provider/:action", requireAuth, async (req, res, next) => {
    const { provider, action } = req.params;
    if (!validPart(provider) || !validPart(action)) return res.status(400).json({ success: false, error: { code: "PERMISSION_REQUEST_INVALID", message: "A valid permission is required." } });
    try {
      const user = await getUser(req.user);
      const result = await revoke({ userId: user._id, provider, action });
      return res.json({ success: true, revoked: result.deletedCount === 1 });
    } catch (error) { return next(error); }
  });
  return router;
};

module.exports = { createPermissionRouter };
