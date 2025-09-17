// services/awards.js — calcolo status, award punti e contatori
const mongoose = require("mongoose");
const User = require("../models/userModel");

// Soglie status per score
function statusFromScore(score = 0) {
  if (score >= 40) return "ambassador";
  if (score >= 15) return "veterano";
  if (score >= 5) return "esploratore";
  return "novizio";
}

// Ricalcola e salva status in base allo score corrente
async function recalcStatus(user) {
  const newStatus = statusFromScore(user.score || 0);
  if (user.status !== newStatus) {
    user.status = newStatus;
  }
  user.stats = user.stats || {};
  user.stats.lastScoreUpdateAt = new Date();
  await user.save({ validateModifiedOnly: true });
  return user.status;
}

// Award per recensione APPROVATA
// di default: +2 punti e +1 reviewsApproved
async function awardForApprovedReview(userId, { points = 2 } = {}) {
  const user = await User.findById(userId);
  if (!user) return null;

  user.score = (user.score || 0) + points;
  user.stats = user.stats || {};
  user.stats.reviewsApproved = (user.stats.reviewsApproved || 0) + 1;

  await user.save({ validateModifiedOnly: true });
  await recalcStatus(user);
  return user;
}

// Award per partecipazione a evento CHIUSO
// points default: +1, incrementa attended
async function awardForAttendance(userIds = [], { points = 1 } = {}) {
  if (!Array.isArray(userIds) || userIds.length === 0) return 0;

  const users = await User.find({ _id: { $in: userIds.map(id => new mongoose.Types.ObjectId(id)) } });
  let updates = 0;

  for (const user of users) {
    user.score = (user.score || 0) + points;
    user.stats = user.stats || {};
    user.stats.attended = (user.stats.attended || 0) + 1;
    user.stats.lastScoreUpdateAt = new Date();
    await user.save({ validateModifiedOnly: true });
    await recalcStatus(user);
    updates++;
  }

  return updates;
}

module.exports = {
  statusFromScore,
  recalcStatus,
  awardForApprovedReview,
  awardForAttendance
};
