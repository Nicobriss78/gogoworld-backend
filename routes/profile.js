// routes/profile.js — C1 Profilo
const express = require("express");
const router = express.Router();
const { getMyProfile, updateMyProfile, getPublicProfile } = require("../controllers/profileController");

// Middleware auth già in progetto (usato nelle altre rotte)
let { protect } = { protect: null };
try {
  ({ protect } = require("../middleware/auth"));
} catch {
  // In caso di sviluppo senza middleware, fallback minimale per evitare crash:
  protect = (req, _res, next) => { if (!req.user) req.user = {}; next(); };
}

// Current user
// GET /api/profile/me
router.get("/me", protect, getMyProfile);

// PUT /api/profile/me
router.put("/me", protect, updateMyProfile);

// Public profile
// GET /api/profile/:userId
router.get("/:userId", getPublicProfile);

module.exports = router;
