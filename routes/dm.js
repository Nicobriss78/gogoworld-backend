// routes/dm.js — C2 DM (MVP testo)
const express = require("express");
const router = express.Router();
const {
  sendMessage,
  listThreads,
  listMessages,
  markRead,
  getUnreadCount,
} = require("../controllers/dmControllers");
const { dmMessageLimiter } = require("../middleware/rateLimit");

// Auth middleware del progetto
const { protect } = require("../middleware/auth");



// --- Routes ---
router.get("/threads", protect, listThreads);
router.get("/threads/:userId/messages", protect, listMessages);
router.post("/threads/:userId/read", protect, markRead);
router.get("/unread-count", protect, getUnreadCount);

router.post("/messages", protect, dmMessageLimiter, sendMessage);

module.exports = router;
