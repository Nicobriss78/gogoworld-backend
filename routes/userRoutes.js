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
  searchUsers,
  blockUser,
  unblockUser,
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
  getPublicProfile,
  getUserActivityFeed, // A3.3
} = require("../controllers/userController");
const { protect } = require("../middleware/auth");
const { loginLimiter, registerLimiter, writeLimiter } = require("../middleware/rateLimit");

// PATCH: rate limiting (login)

// Public
router.post("/", registerLimiter, registerUser);
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
// Private: ricerca utenti
router.get("/search", protect, searchUsers);
// PROFILO PUBBLICO
router.get("/:userId/public", protect, getPublicProfile);
// BACHECA ATTIVITÀ
router.get("/:userId/activity", protect, getUserActivityFeed);
// Private: block / unblock utente (DM / abuso)
router.post("/:userId/block", protect, blockUser);
router.post("/:userId/unblock", protect, unblockUser);
// FOLLOW / UNFOLLOW
router.post("/:userId/follow", protect, followUser);
router.delete("/:userId/follow", protect, unfollowUser);

// LISTE FOLLOWERS / FOLLOWING
router.get("/:userId/followers", protect, getFollowers);
router.get("/:userId/following", protect, getFollowing);

// Public: email verify / forgot / reset
router.get("/verify", verifyEmail);
router.post("/forgot", loginLimiter, forgotPassword);
router.post("/reset", writeLimiter, resetPassword);


module.exports = router;















