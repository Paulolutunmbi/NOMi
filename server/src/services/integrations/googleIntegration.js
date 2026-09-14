// Google OAuth and Google APIs intentionally arrive in a later phase.
const googleIntegration = {
  provider: "google",
  capabilities: ["gmail.read", "gmail.draft", "gmail.send", "calendar.read", "calendar.create", "calendar.update", "calendar.delete", "meet.create"],
  async execute() {
    throw new Error("Google integration is not connected yet");
  },
};

module.exports = googleIntegration;
