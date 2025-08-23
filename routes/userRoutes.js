// routes/userRoutes.js — mappatura utenti — 2025-08-23 (Fase 5)
// Aggiunge remap per alias /users/join|leave/:eventId -> req.params.id

const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/userController");
const { authRequired } = require("../middleware/auth");

// Utility: prende il primo handler presente
function handlerOr501(names) {
  for (const n of names) {
    if (n && typeof ctrl[n] === "function") return ctrl[n];
  }
  return (_req, res) => {
    res.status(501).json({
      ok: false,
      error: "HANDLER_NOT_IMPLEMENTED",
      message: `Nessuna delle funzioni [${names.join(", ")}] è presente in userController.`,
    });
  };
}

// Remap middleware per alias di compatibilità
function remapEventParam(req, _res, next) {
  if (!req.params) req.params = {};
  if (req.params.eventId && !req.params.id) {
    req.params.id = req.params.eventId;
  }
  next();
}

// Pubblici
router.post("/register", handlerOr501(["register", "signup"]));
router.post("/login", handlerOr501(["login", "signin"]));

// Profilo utente corrente
router.get("/me", authRequired, handlerOr501(["me", "getMe"]));

// Aggiornamento ruolo di sessione (switch senza nuovo login)
router.post(
  "/session-role",
  authRequired,
  handlerOr501([
    "setSessionRole",
    "handleSessionRole",
    "switchSessionRole",
    "switchRole",
    "changeSessionRole",
  ])
);

// Partecipazione eventi (mapping standard lato /users)
router.post("/join/:eventId", authRequired, remapEventParam, handlerOr501(["join", "joinEvent"]));
router.post("/leave/:eventId", authRequired, remapEventParam, handlerOr501(["leave", "leaveEvent"]));

// Alias legacy (se il FE usasse /users/:id/join|leave)
router.post("/:id/join", authRequired, handlerOr501(["join", "joinEvent"]));
router.post("/:id/leave", authRequired, handlerOr501(["leave", "leaveEvent"]));

// (Opzionale) upgrade statistico del ruolo registrato
router.post("/upgrade", authRequired, handlerOr501(["upgrade"]));

module.exports = router;








