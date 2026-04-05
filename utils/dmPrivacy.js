function evaluateDmPermission(senderId, recipientUser) {
  const sender = String(senderId || "").trim();
  if (!sender) {
    return { allowed: false, reason: "UNAUTHORIZED" };
  }

  if (!recipientUser) {
    return { allowed: false, reason: "USER_NOT_FOUND" };
  }

  const recipientId = String(recipientUser._id || "").trim();
  if (!recipientId) {
    return { allowed: false, reason: "USER_NOT_FOUND" };
  }

  if (sender === recipientId) {
    return { allowed: false, reason: "CANNOT_MESSAGE_SELF" };
  }

  if (recipientUser.isBanned) {
    return { allowed: false, reason: "RECIPIENT_UNAVAILABLE" };
  }

  const profile = recipientUser.profile || {};
  const privacy = profile.privacy || {};

  if (!privacy.optInDM) {
    return { allowed: false, reason: "DM_NOT_ALLOWED" };
  }

  if (privacy.dmsFrom === "nobody") {
    return { allowed: false, reason: "DM_NOT_ALLOWED" };
  }

  if (privacy.dmsFrom === "followers") {
    const followers = Array.isArray(recipientUser.followers)
      ? recipientUser.followers.map(String)
      : [];
    const following = Array.isArray(recipientUser.following)
      ? recipientUser.following.map(String)
      : [];

    const allowedByRelationship =
      followers.includes(sender) || following.includes(sender);

    if (!allowedByRelationship) {
      return { allowed: false, reason: "DM_NOT_ALLOWED" };
    }
  }

  const blockedUsers = Array.isArray(recipientUser.blockedUsers)
    ? recipientUser.blockedUsers.map(String)
    : [];

  if (blockedUsers.includes(sender)) {
    return { allowed: false, reason: "BLOCKED_BY_USER" };
  }

  return { allowed: true, reason: null };
}

module.exports = {
  evaluateDmPermission,
};
