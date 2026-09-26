const User = require("../../models/User");

const findOrCreateFromFirebaseClaims = async (claims) =>
  User.findOneAndUpdate(
    { firebaseUid: claims.uid },
    {
      $set: {
        email: claims.email || null,
        displayName: claims.name || null,
        photoUrl: claims.picture || null,
        lastAuthenticatedAt: new Date(),
      },
      $setOnInsert: { firebaseUid: claims.uid },
    },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
  );

module.exports = { findOrCreateFromFirebaseClaims };
