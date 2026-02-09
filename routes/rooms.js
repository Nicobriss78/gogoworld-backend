// routes/rooms.js — C2.2
  // Gestione Room eventi.
  // In precedenza la finestra di invio era limitata a ±48 h attorno all’evento.
  // Ora la chat è attiva dal momento dell’approvazione dell’evento fino a 24 h dopo la sua fine.
  // Tutti i controlli di finestra sono gestiti nei controller.

const express = require("express");
const router = express.Router();
const {
  openOrJoinEvent,
  openOrJoinDM,
  getEventRoomMeta,
  listMessages,
  postMessage,
  markRead,
  getRoomsUnreadCount,
  getUnreadSummary, // <-- aggiungi questo
  listMine,
} = require("../controllers/roomsController");


// Auth middleware (R1: deny-by-default, fail-closed)
const { protect } = require("../middleware/auth");
const { securityRateLimit } = require("../middleware/securityRateLimit");
// SECURITY (Redis shared) — Step 1.4
// Applicato solo a route protette (req.user presente)
const RL = {
  eventOpenOrJoin: securityRateLimit({ scope: "room_event_open_or_join", windowMs: 60_000, max: 30 }),
  dmOpenOrJoin: securityRateLimit({ scope: "room_dm_open_or_join", windowMs: 60_000, max: 30 }),
  markRead: securityRateLimit({ scope: "room_mark_read", windowMs: 60_000, max: 120 }),
};


// Rate-limit semplice per invio messaggi room (robusto, in-memory)
const buckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.resetAt) buckets.delete(k);
}, 5 * 60 * 1000);

function roomLimiter(req, res, next) {
  try {
    const meId = (req.user && req.user.id) || "anon";
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "ip");
    const key = `${meId}|${ip}`;
    const now = Date.now();
    const minute = 60 * 1000;
    let b = buckets.get(key);
    if (!b || now > b.resetAt) { b = { n: 0, resetAt: now + minute }; buckets.set(key, b); }
    b.n++;
    if (b.n > 20) {
      const retry = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retry));
      return res.status(429).json({ ok: false, error: "TOO_MANY_REQUESTS" });
    }
    next();
  } catch { next(); }
}

// Routes (evento pubblico)
router.post("/event/:eventId/open-or-join", protect, RL.eventOpenOrJoin, openOrJoinEvent);
router.post("/event/:eventId/unlock", protect, (req, res) => {
  return res.status(404).json({ ok: false, error: "NOT_FOUND" });
});
router.get("/event/:eventId", protect, getEventRoomMeta);
router.get("/:roomId/messages", protect, listMessages);
router.post("/:roomId/messages", protect, roomLimiter, postMessage);
router.post("/:roomId/read", protect, RL.markRead, markRead);
// Routes (DM)
router.post("/dm/open-or-join", protect, RL.dmOpenOrJoin, openOrJoinDM);
// Le mie stanze (dove l'utente è membro o ha interagito)
router.get("/unread-count", protect, getRoomsUnreadCount);
router.get("/unread-summary", protect, getUnreadSummary);
router.get("/mine", protect, listMine);
module.exports = router;
