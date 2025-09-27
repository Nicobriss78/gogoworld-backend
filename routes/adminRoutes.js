// backend/routes/adminRoutes.js
const express = require("express");
const router = express.Router();
const { config } = require("../config");
const { protect, authorize } = require("../middleware/auth");
const {
  listModerationEvents,
  approveEvent,
  unapproveEvent,
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
const { adminLimiter, monitorLimiter } = require("../middleware/rateLimit");
// Guard opzionale con chiave interna: se INTERNAL_API_KEY non è settata, non blocca
function requireInternalKey(req, res, next) {
  const needed = config.INTERNAL_API_KEY;
  if (!needed) return next(); // chiave non configurata → passa
  const provided = req.get("x-internal-key") || req.get("x-internal-api-key") || "";
  if (provided && provided === needed) return next();
  return res.status(403).json({ ok: false, error: "FORBIDDEN_INTERNAL" });
}

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
router.post("/events/:id/approve", adminLimiter, requireInternalKey, protect, authorize("admin"), approveEvent);
router.post("/events/:id/unapprove", adminLimiter, requireInternalKey, protect, authorize("admin"), unapproveEvent);
router.post("/events/:id/reject", adminLimiter, requireInternalKey, protect, authorize("admin"), rejectEvent);
router.post("/events/:id/block", adminLimiter, requireInternalKey, protect, authorize("admin"), blockEvent);
router.post("/events/:id/unblock", adminLimiter, requireInternalKey, protect, authorize("admin"), unblockEvent);
router.delete("/events/:id/force", adminLimiter, requireInternalKey, protect, authorize("admin"), forceDeleteEvent);

// ---------------------------------------------------------------------------
// Utenti (moderazione ruoli/ban)
// ---------------------------------------------------------------------------
router.get("/users", protect, authorize("admin"), listUsers);
router.get("/users/export.csv", protect, authorize("admin"), exportUsersCsv);
router.post("/users/:id/ban", adminLimiter, requireInternalKey, protect, authorize("admin"), banUser);
router.post("/users/:id/unban", adminLimiter, requireInternalKey, protect, authorize("admin"), unbanUser);
router.post("/users/:id/role", adminLimiter, requireInternalKey, protect, authorize("admin"), setUserRole);
router.post("/users/:id/can-organize", adminLimiter, requireInternalKey, protect, authorize("admin"), setUserCanOrganize);

// ---------------------------------------------------------------------------
// Import massivo (CSV) – solo Admin
// ---------------------------------------------------------------------------
// PATCH: usa uploadCsvSafe (multer memory + MIME/size CSV) + adminLimiter
router.post(
  "/import/events",
  adminLimiter,
  requireInternalKey,
  protect,
  authorize("admin"),
  uploadCsvSafe,
  importEventsCsv
);
// ---------------------------------------------------------------------------
// Monitoraggio errori client (Admin FE → Backend → Sentry)
// Protetta da: requireInternalKey + monitorLimiter
// ---------------------------------------------------------------------------
router.post(
  "/monitor/client-error",
  requireInternalKey,
  monitorLimiter,
  express.json({ limit: "10kb" }),
  async (req, res) => {
    try {
      const { message, stack, href, ua, ts } = req.body || {};
      if (!message || typeof message !== "string") {
        return res.status(400).json({ ok: false, error: "invalid_payload" });
      }

      // Inoltra a Sentry lato server (se inizializzato), altrimenti fallback su STDOUT
      if (global.Sentry && typeof global.Sentry.captureMessage === "function") {
        global.Sentry.captureMessage(message, {
          level: "error",
          extra: { stack, href, ua, ts, source: "client-admin" },
        });
      } else {
        console.error("ClientError:", { message, stack, href, ua, ts });
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error("Monitor route error:", err);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  }
);
// Error handler locale per payload troppo grande su /monitor/client-error
// Restituisce JSON coerente (413) invece del messaggio grezzo del body-parser
router.use("/monitor/client-error", (err, _req, res, next) => {
  if (!err) return next();
  // Body parser di Express usa 'type' o 'status' per segnalare payload eccessivo
  const tooLarge = err.type === "entity.too.large" || err.status === 413 || err.statusCode === 413;
  if (!tooLarge) return next(err);
  return res.status(413).json({
    ok: false,
    error: "payload_too_large",
    code: "MONITOR_PAYLOAD_413",
  });
});

module.exports = router;
