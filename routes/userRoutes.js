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
  enableOrganizer,
  verifyEmail,
  forgotPassword,
  resetPassword,
} = require("../controllers/userController");


const { protect } = require("../middleware/auth");
const { loginLimiter, writeLimiter } = require("../middleware/rateLimit");

// PATCH: rate limiting (login)
const { loginLimiter } = require("../middleware/rateLimit");

// Public
router.post("/", registerUser);
router.post("/login", loginLimiter, authUser); // ⬅️ PATCH: applica limiter al login

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
// Public: email verify / forgot / reset
router.get("/verify", verifyEmail);
router.post("/forgot", loginLimiter, forgotPassword);
router.post("/reset", writeLimiter, resetPassword);

module.exports = router;



