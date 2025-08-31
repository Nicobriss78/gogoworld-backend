// routes/eventRoutes.js — GoGoWorld.life
// NOTE: Opzione A — aggiunta rotta import CSV (visibile a tutti lato UI, autorizzata solo lato BE)

const express = require("express");
const router = express.Router();

const {
  getEvents,
  createEvent,
  getEventById,
  updateEvent,
  deleteEvent,
  joinEvent,
  leaveEvent,
  getMyEventsList,
} = require("../controllers/eventController");

const { protect, authorize } = require("../middleware/auth");

// === Nuovi import per import CSV (AGGIUNTA CHIRURGICA) ===
const { importCsv } = require("../controllers/importController");
const { uploadCsv } = require("../middleware/upload");

// --------------------------------------------------------
// Eventi pubblici / query
// --------------------------------------------------------
router.get("/", getEvents);

// --------------------------------------------------------
// Creazione / gestione eventi (organizer only)
// --------------------------------------------------------
router.post("/", protect, authorize("organizer"), createEvent);

router.get("/mine/list", protect, authorize("organizer"), getMyEventsList);

router.get("/:id", getEventById);

router.put("/:id", protect, authorize("organizer"), updateEvent);

router.delete("/:id", protect, authorize("organizer"), deleteEvent);

// --------------------------------------------------------
// Partecipazione eventi
// --------------------------------------------------------
router.post("/:id/join", protect, joinEvent);
router.post("/:id/leave", protect, leaveEvent);

// --------------------------------------------------------
// Import massivo da CSV (organizer + whitelist via ADMIN_EMAILS)
// Opzione A: il bottone è visibile a tutti nel FE, ma la vera protezione è qui.
// --------------------------------------------------------
router.post(
  "/import-csv",
  protect,
  authorize("organizer"),
  uploadCsv.single("file"), // campo file nel form-data
  importCsv
);

module.exports = router;



