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
  updateEvent,
  deleteEvent,
  joinEvent,
  leaveEvent,
  listMyEvents,
  getParticipation, // PATCH S6: aggiunto export
} = require("../controllers/eventController");

const { protect, authorize } = require("../middleware/auth");

// --------------------------------------------------------
// Eventi pubblici / query
// --------------------------------------------------------
router.get("/", listEvents);

// --------------------------------------------------------
// Creazione / gestione eventi (organizer only)
// --------------------------------------------------------
router.post("/", protect, authorize("organizer"), createEvent);

router.get("/mine/list", protect, authorize("organizer"), listMyEvents);

router.get("/:id", getEventById);

router.put("/:id", protect, authorize("organizer"), updateEvent);

router.delete("/:id", protect, authorize("organizer"), deleteEvent);
// Chiusura evento + award (admin)
router.post("/:id/join", participationLimiter, protect, joinEvent);
// --------------------------------------------------------
// Partecipazione eventi
// --------------------------------------------------------
router.post("/:id/join", participationLimiter, protect, joinEvent);
router.post("/:id/leave", participationLimiter, protect, leaveEvent);

// 🔎 PATCH S6: nuova rotta diagnostica partecipazione
router.get("/:id/participation", protect, getParticipation);

module.exports = router;








