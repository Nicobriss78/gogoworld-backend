// routes/eventRoutes.js — GoGoWorld.life
// NOTE: Modifica CHIRURGICA per Opzione B
// - Aggiunto authorize("organizer") su POST/PUT/DELETE eventi
// - Nessuna modifica ad altre rotte

const express = require("express");
const router = express.Router();

const {
  listEvents,
  listMyEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  joinEvent,
  leaveEvent,
} = require("../controllers/eventController");

const { protect, authorize } = require("../middleware/auth");

// Pubblico: lista eventi (con filtri)
router.get("/", listEvents);

// Privato: eventi dell'organizzatore corrente
router.get("/mine/list", protect, listMyEvents);

// Pubblico: dettaglio evento
router.get("/:id", getEventById);

// Privato + Ruolo: crea evento (solo organizer)
router.post("/", protect, authorize("organizer"), createEvent);

// Privato + Ruolo + Ownership (verificata nel controller): aggiorna evento
router.put("/:id", protect, authorize("organizer"), updateEvent);

// Privato + Ruolo + Ownership (verificata nel controller): elimina evento
router.delete("/:id", protect, authorize("organizer"), deleteEvent);

// Privato: partecipa/annulla (aperto ai partecipanti)
router.post("/:id/join", protect, joinEvent);
router.post("/:id/leave", protect, leaveEvent);

module.exports = router;


