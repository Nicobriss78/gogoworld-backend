// backend/controllers/notificationController.js
// Controller notifiche in-app GoGoWorld.life (A9)

const asyncHandler = require("express-async-handler");
const Notification = require("../models/notificationModel");

// @desc Restituisce le notifiche dell'utente loggato
// @route GET /api/notifications/mine
// @access Private
const listMyNotifications = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    res.status(401);
    throw new Error("Non autenticato");
  }

  const limit = Math.min(
    parseInt(req.query.limit, 10) || 30,
    100
  ); // massimo 100 per sicurezza

  const query = { user: userId };

  // filtro opzionale solo non lette: ?unreadOnly=1
  if (req.query.unreadOnly === "1" || req.query.unreadOnly === "true") {
    query.isRead = false;
  }

  const [notifications, unreadCount] = await Promise.all([
    Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("actor", "name profile.city profile.region")
      .populate("event", "title dateStart city region")
      .lean(),
    Notification.countDocuments({ user: userId, isRead: false }),
  ]);

  res.json({
    ok: true,
    notifications,
    unreadCount,
  });
});

// @desc Segna una singola notifica come letta
// @route PATCH /api/notifications/:id/read
// @access Private
const markNotificationRead = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    res.status(401);
    throw new Error("Non autenticato");
  }

  const id = req.params.id;

  const notification = await Notification.findOneAndUpdate(
    { _id: id, user: userId },
    { isRead: true },
    { new: true }
  )
    .populate("actor", "name profile.city profile.region")
    .populate("event", "title dateStart city region");

  if (!notification) {
    res.status(404);
    throw new Error("Notifica non trovata");
  }

  res.json({
    ok: true,
    notification,
  });
});

// @desc Segna tutte le notifiche dell'utente come lette
// @route PATCH /api/notifications/read-all
// @access Private
const markAllNotificationsRead = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    res.status(401);
    throw new Error("Non autenticato");
  }

  await Notification.updateMany(
    { user: userId, isRead: false },
    { isRead: true }
  );

  res.json({
    ok: true,
    message: "Tutte le notifiche sono state segnate come lette",
  });
});

// Helper interno per creare notifiche (da usare in altri controller)
// NON è esposto come route HTTP.
async function createNotification({ user, actor, event, type, title, message, data }) {
  if (!user || !type || !title) return null;

  const payload = {
    user,
    type,
    title,
    message: message || "",
    data: data || {},
  };

  if (actor) payload.actor = actor;
  if (event) payload.event = event;

  try {
    const notification = await Notification.create(payload);
    return notification;
  } catch (err) {
    // non bloccare mai il flusso principale per errore di notifica
    console.error("[notification] errore creazione notifica:", err.message);
    return null;
  }
}

module.exports = {
  listMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  createNotification, // helper da riusare in userController/eventController
};
