// backend/routes/adminRoutes.js
// Rotte Admin Dashboard — protette da protect + authorize("admin")

const express = require("express");
const router = express.Router();

const {
  // Eventi
  listModerationEvents,
  approveEvent,
  rejectEvent,
  blockEvent,
  unblockEvent,
  forceDeleteEvent,
  adminImportEvents,
  // Utenti
  listUsers,
  banUser,
  unbanUser,
  setUserRole,
  toggleCanOrganize,
} = require("../controllers/adminController");

const { protect, authorize } = require("../middleware/auth");

// -----------------------------
// Eventi
// -----------------------------
router.get("/events", protect, authorize("admin"), listModerationEvents);
router.post("/events/:id/approve", protect, authorize("admin"), approveEvent);
router.post("/events/:id/reject", protect, authorize("admin"), rejectEvent);
router.post("/events/:id/block", protect, authorize("admin"), blockEvent);
router.post("/events/:id/unblock", protect, authorize("admin"), unblockEvent);
router.delete("/events/:id/force", protect, authorize("admin"), forceDeleteEvent);
// Import massivo (CSV) — solo admin
router.post("/import/events", protect, authorize("admin"), adminImportEvents);

// -----------------------------
// Utenti
// -----------------------------
router.get("/users", protect, authorize("admin"), listUsers);
router.post("/users/:id/ban", protect, authorize("admin"), banUser);
router.post("/users/:id/unban", protect, authorize("admin"), unbanUser);
router.post("/users/:id/role", protect, authorize("admin"), setUserRole);
router.post("/users/:id/can-organize", protect, authorize("admin"), toggleCanOrganize);

module.exports = router;
