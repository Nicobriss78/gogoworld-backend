// backend/routes/userRoutes.js
const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");

// Lista utenti (debug/utility)
router.get("/", userController.list);

// Dati utente
router.get("/:id", userController.getById);

// Registrazione & Login
router.post("/register", userController.register);
router.post("/login", userController.login);

// Partecipazioni
router.post("/:id/partecipa", userController.partecipa);
router.post("/:id/annulla", userController.annulla);

// Cambio ruolo attivo (switch flessibile)
router.put("/:id/role", userController.switchRole);

module.exports = router;
