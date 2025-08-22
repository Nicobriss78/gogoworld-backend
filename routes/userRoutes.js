// routes/userRoutes.js — completo con gestione ruolo coerente
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/userController");
const { authRequired } = require("../middleware/auth");

// Registrazione / login
router.post("/register", ctrl.register);
router.post("/login", ctrl.login);

// Profilo
router.get("/me", authRequired, ctrl.me);

// Aggiorna ruolo registrato a organizer
router.put("/upgrade", authRequired, ctrl.upgrade);

// Cambia ruolo di sessione (participant <-> organizer)
router.put("/session-role", authRequired, ctrl.setSessionRole);

module.exports = router;





