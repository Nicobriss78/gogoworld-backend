// routes/userRoutes.js — aggiunta rotta sessionRole
const express = require("express");
const router = express.Router();

const { authRequired, roleRequired } = require("../middleware/auth");
const userCtrl = require("../controllers/userController");

// Registrazione & Login
router.post("/register", userCtrl.register);
router.post("/login", userCtrl.login);

// Info utente
router.get("/me", authRequired, userCtrl.me);

// Switch di RUOLO DI SESSIONE (non persistente): ritorna NUOVO token
router.put("/session-role", authRequired, userCtrl.setSessionRole);

// Partecipazione eventi (richiedono sessionRole = participant)
router.post("/:id/partecipa", authRequired, roleRequired("participant"), userCtrl.join);
router.post("/:id/annulla", authRequired, roleRequired("participant"), userCtrl.leave);

module.exports = router;

