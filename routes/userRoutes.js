// routes/userRoutes.js — gestione utente e alias join/leave lato utente
//
// Endpoints principali
// - POST /register
// - POST /login
// - GET /me (protetto)
// - POST /session-role (non protetto: ruolo solo di sessione lato FE)
// - POST /join/:eventId (protetto)
// - POST /leave/:eventId (protetto)
//
// Nota: join/leave sono alias "lato utente"; esistono anche alias lato evento in eventRoutes.
// Le funzioni richiamate sono definite in controllers/userController.js

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");

const {
  register,
  login,
  getMe,
  setSessionRole,
  joinEvent, // alias lato utente
  leaveEvent, // alias lato utente
} = require("../controllers/userController");

// Registrazione e login
router.post("/register", register);
router.post("/login", login);

// Dati utente corrente
router.get("/me", protect, getMe);

// Ruolo di sessione (solo eco per coerenza con FE; nessuna persistenza DB)
router.post("/session-role", setSessionRole);

// Alias join/leave (lato utente)
router.post("/join/:eventId", protect, joinEvent);
router.post("/leave/:eventId", protect, leaveEvent);

module.exports = router;
