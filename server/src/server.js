const express = require("express");
const cors = require("cors");
require("dotenv").config();

const connectDatabase = require("./config/database");

const { registerIntegration } = require("./services/integrations/integrationRegistry");
const googleIntegration = require("./services/integrations/googleIntegration");
const googleIntegrationRoutes = require("./routes/googleIntegrationRoutes");
const { createAIIntentRouter } = require("./routes/aiIntentRoutes");
const { createAIActionRouter } = require("./routes/aiActionRoutes");
const { createPermissionRouter } = require("./routes/permissionRoutes");
const { createAuthRouter } = require("./routes/authRoutes");
const { createAttachmentRouter } = require("./routes/attachmentRoutes");
const { createChatRouter } = require("./routes/chatRoutes");
const { createCalendarRouter } = require("./routes/calendarRoutes");
const { cleanupExpiredAttachments } = require("./services/attachments/attachmentService");
const ChatSession = require("./models/ChatSession");

const app = express();

app.use(cors());
// Attachment uploads are base64 JSON and can be several megabytes. Mount
// their route-local 15 MB parser before the general small JSON limit, or the
// global parser rejects the body before the attachment router can handle it.
app.use("/api/ai/attachments", createAttachmentRouter());
app.use("/api/attachments", createAttachmentRouter());
// Chat transcript metadata can include rendered Gmail/calendar results. Let
// the chat route parse a bounded larger body so its sanitizer can remove
// oversized or unsafe fields before persistence.
app.use("/api/chats", createChatRouter());
app.use(express.json({ limit: "16kb" }));
app.use("/api/auth", createAuthRouter());
app.use("/api/integrations/google", googleIntegrationRoutes);
app.use("/api/ai", createAIIntentRouter());
app.use("/api/ai", createAIActionRouter());
app.use("/api/calendar", createCalendarRouter());
app.use("/api/permissions", createPermissionRouter());

// Providers self-describe their capabilities so action orchestration stays provider-agnostic.
registerIntegration(googleIntegration);

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    service: "NOMI API",
    message: "NOMI backend is running",
  });
});

app.use((error, req, res, next) => {
  // The message alone (previous behavior) hides exactly where an error
  // came from, which made bugs like this one hard to track down from the
  // terminal. Logging the route and full stack costs nothing in production
  // and saves real debugging time; the response body to the client is
  // unchanged.
  console.error(`Unhandled API error on ${req.method} ${req.originalUrl}:`, error.stack || error.message);
  res.status(500).json({ success: false, message: "Internal server error" });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDatabase();
    // Older NOMI versions allowed only one chat per workspace. Remove that
    // exact obsolete unique index so multiple persistent sessions can be created.
    const indexes = await ChatSession.collection.indexes();
    const obsolete = indexes.find((index) => index.unique && index.key?.user === 1 && index.key?.type === 1 && Object.keys(index.key).length === 2);
    if (obsolete) await ChatSession.collection.dropIndex(obsolete.name);
    await ChatSession.collection.createIndex({ user: 1, type: 1, lastMessageAt: -1 });
    const attachmentCleanup = setInterval(() => cleanupExpiredAttachments().catch(() => {}), 10 * 60 * 1000);
    attachmentCleanup.unref();

    app.listen(PORT, () => {
      console.log(`NOMI API running on port ${PORT}`);
    });
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  }
};

if (require.main === module) startServer();

module.exports = { app, startServer };
