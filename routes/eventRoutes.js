// routes/eventRoutes.js — GoGoWorld.life
// NOTE: Opzione A — rotta import CSV (visibile a tutti lato UI, autorizzata solo lato BE)

const express = require("express");
const router = express.Router();

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
} = require("../controllers/eventController");

const { protect, authorize } = require("../middleware/auth");

// === Import per import CSV (già previsti) ===
const { importCsv } = require("../controllers/importController");
const { uploadCsv } = require("../middleware/upload");

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

// --------------------------------------------------------
// Partecipazione eventi
// --------------------------------------------------------
router.post("/:id/join", protect, joinEvent);
router.post("/:id/leave", protect, leaveEvent);

// --------------------------------------------------------
// Import massivo da CSV (organizer + whitelist via ADMIN_EMAILS)
// Opzione A: il bottone è visibile a tutti nel FE, ma la protezione è qui.
// --------------------------------------------------------
router.post(
  "/import-csv",
  protect,
  authorize("organizer"),
  uploadCsv.single("file"), // campo file nel form-data
  importCsv
);

module.exports = router;



