// routes/dm.js — C2 DM (MVP testo)
const express = require("express");
const router = express.Router();
const {
  sendMessage,
  listThreads,
  listMessages,
  markRead,
  getUnreadCount,
} = require("../controllers/dmController");

// Auth middleware del progetto
let { protect } = { protect: null };
try {
  ({ protect } = require("../middleware/auth"));
} catch {
  protect = (req, _res, next) => { if (!req.user) req.user = {}; next(); };
}

// --- Rate-limit leggero (in-memory) per evitare 503 ---
// Limita a ~20 messaggi/min per (userId+IP). Robusto, nessuna dipendenza esterna.
const bucket = new Map(); // key -> { count, resetAt }
function dmLimiter(req, res, next) {
  try {
    const meId = (req.user && req.user.id) || "anon";
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "ip");
    const key = `${meId}|${ip}`;
    const now = Date.now();
    const minute = 60 * 1000;
    let entry = bucket.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + minute };
      bucket.set(key, entry);
    }
    entry.count++;
    if (entry.count > 20) {
      const retry = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retry));
      return res.status(429).json({ ok: false, error: "TOO_MANY_REQUESTS" });
    }
    return next();
  } catch (e) {
    // In caso di errore, non bloccare (mai 503 dal limiter)
    return next();
  }
}

// --- Routes ---
router.get("/threads", protect, listThreads);
router.get("/threads/:userId/messages", protect, listMessages);
router.post("/threads/:userId/read", protect, markRead);
router.get("/unread-count", protect, getUnreadCount);

router.post("/messages", protect, dmLimiter, sendMessage);

module.exports = router;
