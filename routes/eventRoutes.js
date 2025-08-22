// routes/eventRoutes.js — mappa endpoint eventi (completo)
const express = require("express");
const router = express.Router();

// Controller eventi (lista, CRUD, ecc.)
const ctrl = require("../controllers/eventController");
// Riutilizzo della logica join/leave già esposta dal controller utenti
const userCtrl = require("../controllers/userController");

const { authRequired, roleRequired } = require("../middleware/auth");

// ---------------------------------------------------------------------------
// Pubblici
// ---------------------------------------------------------------------------
router.get("/", ctrl.list);
router.get("/:id", ctrl.getById);

// ---------------------------------------------------------------------------
// Partecipazione eventi (standard unificato)
// - Manteniamo anche le vecchie rotte in userRoutes per retro-compatibilità.
// ---------------------------------------------------------------------------
// Solo utenti in sessione "participant" possono aderire/disdire
router.post("/:id/join", authRequired, roleRequired("participant"), userCtrl.join);
router.delete("/:id/leave", authRequired, roleRequired("participant"), userCtrl.leave);

// ---------------------------------------------------------------------------
// Protetti (organizer) — CRUD eventi "miei"
// ---------------------------------------------------------------------------
router.get("/mine/list", authRequired, roleRequired("organizer"), ctrl.listMine);
router.post("/", authRequired, roleRequired("organizer"), ctrl.create);
router.put("/:id", authRequired, roleRequired("organizer"), ctrl.update);
router.delete("/:id", authRequired, roleRequired("organizer"), ctrl.remove);

module.exports = router;






