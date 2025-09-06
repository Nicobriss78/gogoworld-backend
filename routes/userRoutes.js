// routes/userRoutes.js — GoGoWorld.life
// NOTE: Modifica CHIRURGICA per Opzione B
// - Protetto POST /session-role (require auth) ma reso NO-OP (non modifica più il DB)
// - Aggiunto POST /me/enable-organizer per abilitare canOrganize
// - Nessun’altra rotta alterata

const express = require("express");
const router = express.Router();

const {
  registerUser,
  authUser,
  getUserProfile,
  // setSessionRole, // (RIMOSSO: non più usato)
  // PATCH: aggiunto
  enableOrganizer,
} = require("../controllers/userController");

const { protect } = require("../middleware/auth");

// Public
router.post("/", registerUser);
router.post("/login", authUser);

// Private
router.get("/me", protect, getUserProfile);

// Private: diagnostica ruoli/token (ritorna solo req.user)
router.get("/whoami", protect, (req, res) => {
  res.json({ ok: true, user: req.user });
});

// Private: switch role (ora NO-OP, non modifica più user.role nel DB)
router.post("/session-role", protect, (req, res) => {
  const desired = String(req.body.role || "");
  res.json({ ok: true, preferred: desired });
});

// Private: abilita modalità organizzatore (Opzione B)
router.post("/me/enable-organizer", protect, enableOrganizer);

module.exports = router;

