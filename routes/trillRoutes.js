const express = require("express");
const router = express.Router();

const { protect, authorize } = require("../middleware/auth");
const { writeLimiter } = require("../middleware/rateLimit");
const { securityRateLimit } = require("../middleware/securityRateLimit");

const {
  createTrillDraftController,
  sendTrillController,
  listMyTrills,
  listEventTrills,
  listAdminTrills,
  blockTrillAdmin,
} = require("../controllers/trillController");

const RL = {
  createDraft: securityRateLimit({
    scope: "trill_create_draft",
    windowMs: 60_000,
    max: 10,
  }),
  send: securityRateLimit({
    scope: "trill_send",
    windowMs: 60_000,
    max: 5,
  }),
  read: securityRateLimit({
    scope: "trill_read",
    windowMs: 60_000,
    max: 60,
  }),
  admin: securityRateLimit({
    scope: "trill_admin",
    windowMs: 60_000,
    max: 60,
  }),
};

// T1-B: crea solo una bozza validata. Nessun invio, nessuna delivery, nessuna notifica.
router.post(
  "/",
  writeLimiter,
  protect,
  RL.createDraft,
  authorize("organizer"),
  createTrillDraftController
);

router.post(
  "/:id/send",
  writeLimiter,
  protect,
  RL.send,
  authorize("organizer"),
  sendTrillController
);
router.get(
  "/mine",
  protect,
  RL.read,
  authorize("organizer"),
  listMyTrills
);
router.get(
  "/event/:eventId",
  protect,
  RL.read,
  authorize("organizer"),
  listEventTrills
);

module.exports = router;
