// routes/eventRoutes.js — GoGoWorld.life
// NOTE: Opzione A — rotta import CSV (visibile a tutti lato UI, autorizzata solo lato BE)

const express = require("express");
const router = express.Router();
const { closeEventAndAward } = require("../controllers/eventController");

const {
  // ⬇️ allineati ai nomi REALI presenti nel tuo eventController.js
  listEvents,
  createEvent,
  getEventById,
  accessPrivateEventByCode, // ← NEW
  updateEvent,
  deleteEvent,
  joinEvent,
  leaveEvent,
  listMyEvents,
  getParticipation, // PATCH S6: aggiunto export
} = require("../controllers/eventController");

const { protect, authorize } = require("../middleware/auth");
const { writeLimiter, participationLimiter, adminLimiter } = require("../middleware/rateLimit"); // #RL

// --------------------------------------------------------
// Eventi pubblici / query
// --------------------------------------------------------
router.get("/", listEvents);

// --------------------------------------------------------
// Creazione / gestione eventi (organizer only)
// --------------------------------------------------------
router.post("/", writeLimiter, protect, authorize("organizer"), createEvent);

router.get("/mine/list", protect, authorize("organizer"), listMyEvents);

router.get("/:id", getEventById);

router.put("/:id", writeLimiter, protect, authorize("organizer"), updateEvent);

router.delete("/:id", writeLimiter, protect, authorize("organizer"), deleteEvent);

// Chiusura evento + award (admin)
router.put("/:id/close", adminLimiter, protect, authorize("admin"), closeEventAndAward);

// --------------------------------------------------------
// Eventi privati (accesso tramite codice invito)
// --------------------------------------------------------
router.post("/access-code", protect, accessPrivateEventByCode);

// --------------------------------------------------------
// Partecipazione eventi
// --------------------------------------------------------
router.post("/:id/join", participationLimiter, protect, joinEvent);
router.post("/:id/leave", participationLimiter, protect, leaveEvent);

// 🔎 PATCH S6: nuova rotta diagnostica partecipazione
router.get("/:id/participation", protect, getParticipation);

module.exports = router;










