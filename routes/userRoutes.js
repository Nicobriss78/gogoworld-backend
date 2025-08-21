// routes/userRoutes.js — mappa endpoint utenti (completo)
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/userController");
const { authRequired, roleRequired } = require("../middleware/auth");

// Pubbliche
router.post("/register", ctrl.register);
router.post("/login", ctrl.login);

// Autenticate
router.get("/me", authRequired, ctrl.me);
router.put("/session-role", authRequired, ctrl.setSessionRole);

// Partecipazione eventi (solo sessionRole=participant)
router.post("/:id/partecipa", authRequired, roleRequired("participant"), ctrl.join);
router.post("/:id/annulla", authRequired, roleRequired("participant"), ctrl.leave);

module.exports = router;



