// backend/routes/userRoutes.js
const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const { authRequired, roleRequired } = require("../middleware/auth");

// Lista utenti (debug/utility) — solo ORGANIZZATORE
router.get("/", authRequired, roleRequired("organizer"), userController.list);

// Dati utente — accesso autenticato (ognuno vede il proprio o chi l'org. autorizza)
router.get("/:id", authRequired, userController.getById);

// Registrazione & Login — pubblici
router.post("/register", userController.register);
router.post("/login", userController.login);

// Partecipazioni — solo PARTECIPANTE
router.post("/:id/partecipa", authRequired, roleRequired("participant"), userController.partecipa);
router.post("/:id/annulla", authRequired, roleRequired("participant"), userController.annulla);

// Cambio ruolo attivo (switch flessibile) — solo autenticati
router.put("/:id/role", authRequired, userController.switchRole);

module.exports = router;

