// routes/rooms.js — C2.2
const express = require("express");
const router = express.Router();
const {
  openOrJoinEvent,
  getEventRoomMeta,
  listMessages,
  postMessage,
  markRead,
  getRoomsUnreadCount,
} = require("../controllers/roomsController");

// Auth middleware
let { protect } = { protect: null };
try {
  ({ protect } = require("../middleware/auth"));
} catch {
  protect = (req, _res, next) => { if (!req.user) req.user = {}; next(); };
}

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
router.post("/event/:eventId/open-or-join", protect, openOrJoinEvent);
router.get("/event/:eventId", protect, getEventRoomMeta);

router.get("/:roomId/messages", protect, listMessages);
router.post("/:roomId/messages", protect, roomLimiter, postMessage);
router.post("/:roomId/read", protect, markRead);

router.get("/unread-count", protect, getRoomsUnreadCount);

module.exports = router;
