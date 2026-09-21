/*
 * One-time, non-destructive index migration for deployments created before
 * TemporaryConversation was scoped by user. Run only after taking the normal
 * database backup: `node scripts/migrateTemporaryConversationIndex.js`.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const connectDatabase = require("../src/config/database");

const run = async () => {
  await connectDatabase();
  const collection = mongoose.connection.collection("temporaryconversations");
  const duplicates = await collection.aggregate([
    { $group: { _id: { user: "$user", conversationId: "$conversationId" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 },
  ]).toArray();
  if (duplicates.length) throw new Error("Cannot create the user-scoped conversation index while duplicate user/conversation records exist.");
  await collection.createIndex({ user: 1, conversationId: 1 }, { unique: true, name: "user_1_conversationId_1" });
  const indexes = await collection.indexes();
  if (indexes.some((index) => index.name === "conversationId_1")) await collection.dropIndex("conversationId_1");
  console.log("TemporaryConversation index migration completed.");
};

run().then(() => mongoose.disconnect()).catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
