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
  exportUsersCsv,
} = require("../controllers/adminController");

// PATCH: upload CSV coerente con middleware/upload.js (memoryStorage + controlli CSV)
const { uploadCsvSafe } = require("../middleware/upload");

// PATCH (5): rate limiting per azioni admin
const { adminLimiter } = require("../middleware/rateLimit");

// ---------------------------------------------------------------------------
// DEBUG TEMP: chi sono io lato BE? (rimuovere a test finiti)
// ---------------------------------------------------------------------------
router.get("/whoami", protect, (req, res) => {
  return res.json({ ok: true, user: req.user });
});

// ---------------------------------------------------------------------------
// PATCH (1): guard globale (tutte le /admin/* richiedono admin)
// - Lasciamo anche le guard per-route già presenti: ridondanti ma innocue
// ---------------------------------------------------------------------------
router.use(protect, authorize("admin"));

// ---------------------------------------------------------------------------
// Eventi (moderazione)
// ---------------------------------------------------------------------------
router.get("/events", protect, authorize("admin"), listModerationEvents);
router.post("/events/:id/approve", adminLimiter, protect, authorize("admin"), approveEvent);
router.post("/events/:id/reject", adminLimiter, protect, authorize("admin"), rejectEvent);
router.post("/events/:id/block", adminLimiter, protect, authorize("admin"), blockEvent);
router.post("/events/:id/unblock", adminLimiter, protect, authorize("admin"), unblockEvent);
router.delete("/events/:id/force", adminLimiter, protect, authorize("admin"), forceDeleteEvent);

// ---------------------------------------------------------------------------
// Utenti (moderazione ruoli/ban)
// ---------------------------------------------------------------------------
router.get("/users", protect, authorize("admin"), listUsers);
router.get("/users/export.csv", protect, authorize("admin"), exportUsersCsv);
router.post("/users/:id/ban", adminLimiter, protect, authorize("admin"), banUser);
router.post("/users/:id/unban", adminLimiter, protect, authorize("admin"), unbanUser);
router.post("/users/:id/role", adminLimiter, protect, authorize("admin"), setUserRole);
router.post("/users/:id/can-organize", adminLimiter, protect, authorize("admin"), setUserCanOrganize);

// ---------------------------------------------------------------------------
// Import massivo (CSV) – solo Admin
// ---------------------------------------------------------------------------
// PATCH: usa uploadCsvSafe (multer memory + MIME/size CSV) + adminLimiter
router.post(
  "/import/events",
  adminLimiter,
  protect,
  authorize("admin"),
  uploadCsvSafe,
  importEventsCsv
);

module.exports = router;
