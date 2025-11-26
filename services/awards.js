// services/awards.js — calcolo status, award punti e contatori
const mongoose = require("mongoose");
const User = require("../models/userModel");
const Event = require("../models/eventModel");
const Activity = require("../models/activityModel"); // A2.3 – Activity log
const { logger } = require("../core/logger");
const cache = require("../adapters/cache");

// A2.3 – helper per creare Activity senza bloccare i flussi principali
async function safeCreateActivity(payload) {
  try {
    await Activity.create(payload);
  } catch (err) {
    try {
      logger.warn("[Activity] create failed", { error: err && err.message });
    } catch {
      // fallback minimale se il logger non è disponibile
      console.warn("[Activity] create failed", err);
    }
  }
}

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
  const oldStatus = user.status;

  const changed = oldStatus !== newStatus;
  if (changed) {
    user.status = newStatus;
  }

  user.stats = user.stats || {};
  user.stats.lastScoreUpdateAt = new Date();
  await user.save({ validateModifiedOnly: true });

  // A2.3 – log Activity: level up effettivo
  if (changed) {
    safeCreateActivity({
      user: user._id,
      type: "level_up",
      event: null,
      payload: {
        from: oldStatus || null,
        to: newStatus
      }
    });
  }

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
/**
* Chiude eventi scaduti non ancora premiati e assegna 1 punto ai partecipanti.
* - Idempotente: se awardedClosed === true, salta.
* - Invalidazione cache: delByPrefix('events:list:')
* - Audit via logger (no FS)
*/
async function closeAndAwardExpiredEvents({ traceId } = {}) {
const now = new Date();
// Eventi "terminati" e non ancora premiati
const candidates = await Event.find({
awardedClosed: { $ne: true },
$or: [
{ dateEnd: { $lte: now } },
{ dateEnd: { $exists: false }, dateStart: { $lte: now } }
]
}).select("_id participants awardedClosed dateStart dateEnd");

let processed = 0;
let awardedTotal = 0;

for (const ev of candidates) {
try {
// Idempotenza per sicurezza
if (ev.awardedClosed === true) continue;

const participants = Array.isArray(ev.participants) ? ev.participants : [];
let count = 0;
if (participants.length) {
try {
count = await awardForAttendance(participants);
} catch (e) {
logger.error("[awards] awardForAttendance failed", { traceId, eventId: ev._id, error: e && e.message });
}
}
ev.awardedClosed = true;
ev.awardedClosedAt = new Date();
await ev.save({ validateModifiedOnly: true });

processed += 1;
awardedTotal += (count || 0);
} catch (e) {
logger.error("[awards] closeAndAwardExpiredEvents: event error", { traceId, eventId: ev && ev._id, error: e && e.message });
}
}
 
// Invalidazione cache delle liste
try { cache.delByPrefix("events:list:"); } catch {}

logger.info("[awards] closeAndAwardExpiredEvents done", { traceId, processed, awardedTotal });
return { processed, awardedTotal };
}

module.exports = {
statusFromScore,
recalcStatus,
awardForApprovedReview,
awardForAttendance,
closeAndAwardExpiredEvents
};

