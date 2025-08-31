// routes/userRoutes.js — GoGoWorld.life
// NOTE: Modifica CHIRURGICA per Opzione B
// - Protetto POST /session-role (require auth) e collegato al controller persistente
// - Nessun’altra rotta alterata

const express = require("express");
const router = express.Router();

const {
  registerUser,
  authUser,
  getUserProfile,
  setSessionRole,
} = require("../controllers/userController");

const { protect } = require("../middleware/auth");

// Public
router.post("/", registerUser);
router.post("/login", authUser);

// Private
router.get("/me", protect, getUserProfile);

// Private: switch role (persistente)
router.post("/session-role", protect, setSessionRole);

module.exports = router;
