// backend/routes/adminRoutes.js
const express = require("express");
const router = express.Router();

const { protect, authorize } = require("../middleware/auth");
const {
  listModerationEvents,
  approveEvent,
  rejectEvent,
  blockEvent,
  unblockEvent,
  forceDeleteEvent,
  listUsers,
  banUser,
  unbanUser,
  setUserRole,
  setUserCanOrganize,
  importEventsCsv,
} = require("../controllers/adminController");

// PATCH: multer per upload CSV
const multer = require("multer");
const upload = multer(); // usa memoria; ok per CSV piccoli

// ---------------------------------------------------------------------------
// DEBUG TEMP: chi sono io lato BE? (rimuovere a test finiti)
// ---------------------------------------------------------------------------
router.get("/whoami", protect, (req, res) => {
  return res.json({ ok: true, user: req.user });
});

// ---------------------------------------------------------------------------
// Eventi (moderazione)
// ---------------------------------------------------------------------------
router.get("/events", protect, authorize("admin"), listModerationEvents);
router.post("/events/:id/approve", protect, authorize("admin"), approveEvent);
router.post("/events/:id/reject", protect, authorize("admin"), rejectEvent);
router.post("/events/:id/block", protect, authorize("admin"), blockEvent);
router.post("/events/:id/unblock", protect, authorize("admin"), unblockEvent);
router.delete("/events/:id/force", protect, authorize("admin"), forceDeleteEvent);

// ---------------------------------------------------------------------------
// Utenti (moderazione ruoli/ban)
// ---------------------------------------------------------------------------
router.get("/users", protect, authorize("admin"), listUsers);
router.post("/users/:id/ban", protect, authorize("admin"), banUser);
router.post("/users/:id/unban", protect, authorize("admin"), unbanUser);
router.post("/users/:id/role", protect, authorize("admin"), setUserRole);
router.post("/users/:id/can-organize", protect, authorize("admin"), setUserCanOrganize);

// ---------------------------------------------------------------------------
// Import massivo (CSV) – solo Admin
// ---------------------------------------------------------------------------
// PATCH: abilita upload del campo 'file' (multipart/form-data)
router.post(
  "/import/events",
  protect,
  authorize("admin"),
  upload.single("file"),
  importEventsCsv
);

module.exports = router;
