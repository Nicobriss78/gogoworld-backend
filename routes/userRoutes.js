// routes/userRoutes.js — coerente con i controller attuali
const express = require("express");
const router = express.Router();

const { authRequired } = require("../middleware/auth");
const userCtrl = require("../controllers/userController");

// Registrazione & Login
router.post("/register", userCtrl.register);
router.post("/login", userCtrl.login);

// Info utente corrente
router.get("/me", authRequired, userCtrl.me);

// Switch ruolo (usa l'utente autenticato; l'ID in path è legacy e non viene usato dal controller)
router.put("/:id/role", authRequired, userCtrl.switchRole);

// Partecipazione eventi
router.post("/:id/partecipa", authRequired, userCtrl.join);
router.post("/:id/annulla", authRequired, userCtrl.leave);

module.exports = router;

