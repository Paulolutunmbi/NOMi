const mongoose = require("mongoose");

const connectDatabase = async () => {
  const { MONGODB_URI } = process.env;

  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is required to connect to MongoDB");
  }

  await mongoose.connect(MONGODB_URI);
  console.log("MongoDB connected successfully");
};

module.exports = connectDatabase;
