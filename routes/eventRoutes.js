// routes/eventRoutes.js — gestione eventi e alias join/leave lato evento
//
// Endpoints principali
// - GET / (lista con filtri via query)
// - GET /mine/list (protetto: eventi dell'organizzatore corrente)
// - GET /:id (dettaglio)
// - POST / (protetto: crea)
// - PUT /:id (protetto: aggiorna — proprietario)
// - DELETE /:id (protetto: elimina — proprietario)
// - POST /:id/join (protetto: alias lato evento)
// - POST /:id/leave (protetto: alias lato evento)
//
// Le funzioni richiamate sono in controllers/eventController.js

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");

const {
  listEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  listMyEvents,
  joinEvent, // alias lato evento
  leaveEvent, // alias lato evento
} = require("../controllers/eventController");

// Lista (con filtri)
router.get("/", listEvents);

// I miei eventi (organizzatore corrente)
router.get("/mine/list", protect, listMyEvents);

// Dettaglio
router.get("/:id", getEventById);

// CRUD (protette)
router.post("/", protect, createEvent);
router.put("/:id", protect, updateEvent);
router.delete("/:id", protect, deleteEvent);

// Alias join/leave (lato evento)
router.post("/:id/join", protect, joinEvent);
router.post("/:id/leave", protect, leaveEvent);

module.exports = router;

