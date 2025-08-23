// routes/userRoutes.js — completo + guardia per /session-role
const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/userController");
const { authRequired } = require("../middleware/auth");

// Utility: verifica che una funzione esista nel controller
function pick(fnNames = []) {
  for (const name of fnNames) {
    if (name && typeof ctrl[name] === "function") return ctrl[name];
  }
  return null;
}

// ---------------------------
// Auth base
// ---------------------------
router.post("/register", ctrl.register);
router.post("/login", ctrl.login);

// Profilo
router.get("/me", authRequired, ctrl.me);

// Upgrade a organizer (ruolo registrato)
router.put("/upgrade", authRequired, ctrl.upgrade);

// ---------------------------
// Switch ruolo di SESSIONE
// Accetta sia body vuoto che { sessionRole } / { role }
// Non facciamo crashare il server se il metodo nel controller
// ha un nome diverso: proviamo più alias comuni.
// ---------------------------
const sessionRoleHandler =
  pick(["setSessionRole", "sessionRole", "switchSessionRole", "switchRole", "changeSessionRole"]);

router.put("/session-role", authRequired, (req, res, next) => {
  // Normalizziamo l'input per massima compatibilità lato controller
  if (req && req.body && !req.body.sessionRole && req.body.role) {
    req.body.sessionRole = req.body.role;
  }

  if (sessionRoleHandler) {
    // Deleghiamo al controller esistente
    return sessionRoleHandler(req, res, next);
  }

  // Fallback sicuro: non crasha e rende visibile il problema
  return res.status(501).json({
    error: "SESSION_ROLE_HANDLER_MISSING",
    message:
      "Nel controller userController non è presente alcun handler fra: setSessionRole, sessionRole, switchSessionRole, switchRole, changeSessionRole.",
  });
});

module.exports = router;






