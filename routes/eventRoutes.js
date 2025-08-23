// routes/eventRoutes.js — mappatura eventi (Fase 1) — 2025-08-23
// Monta gli endpoint eventi senza toccare la logica dei controller.

const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/eventController");
const userCtrl = require("../controllers/userController");
const { authRequired, roleRequired } = require("../middleware/auth");

// Utility di protezione: se il controller non espone il metodo richiesto -> 501
function handlerOr501(controller, names) {
  for (const n of names) {
    if (n && typeof controller[n] === "function") return controller[n];
  }
  return (_req, res) => {
    res.status(501).json({
      ok: false,
      error: "HANDLER_NOT_IMPLEMENTED",
      message: `Nessuna delle funzioni [${names.join(", ")}] è presente nel controller richiesto.`,
    });
  };
}

// Pubblici
router.get("/", handlerOr501(ctrl, ["list"]));
router.get("/:id", handlerOr501(ctrl, ["getById"]));

// Partecipazione eventi anche lato /events (standard unificato)
// Manteniamo POST join e DELETE leave come REST canonico; aggiungiamo alias POST per leave per retro-compatibilità.
router.post("/:id/join", authRequired, roleRequired("participant"), handlerOr501(userCtrl, ["join","joinEvent"]));
router.delete("/:id/leave", authRequired, roleRequired("participant"), handlerOr501(userCtrl, ["leave","leaveEvent"]));
router.post("/:id/leave", authRequired, roleRequired("participant"), handlerOr501(userCtrl, ["leave","leaveEvent"])); // alias

// Protetti (organizer) — CRUD eventi "miei"
router.get("/mine/list", authRequired, roleRequired("organizer"), handlerOr501(ctrl, ["listMine"]));
router.post("/", authRequired, roleRequired("organizer"), handlerOr501(ctrl, ["create"]));
router.put("/:id", authRequired, roleRequired("organizer"), handlerOr501(ctrl, ["update"]));
router.delete("/:id", authRequired, roleRequired("organizer"), handlerOr501(ctrl, ["remove","delete","destroy"]));

module.exports = router;







