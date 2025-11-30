// backend/routes/notificationRoutes.js
// Rotte notifiche in-app GoGoWorld.life (A9)

const express = require("express");
const router = express.Router();

const {
  listMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../controllers/notificationController");

const { protect } = require("../middleware/authMiddleware");

// Lista notifiche dell’utente loggato
router.get("/mine", protect, listMyNotifications);

// Segna una singola notifica come letta
router.patch("/:id/read", protect, markNotificationRead);

// Segna tutte come lette
router.patch("/read-all", protect, markAllNotificationsRead);

module.exports = router;
