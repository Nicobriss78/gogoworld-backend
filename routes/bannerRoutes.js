// backend/routes/bannerRoutes.js
// Rotte Banner — B1/1: fetch attivi + click tracking

const express = require("express");
const router = express.Router();

const bannerController = require("../controllers/bannerController");
const {
  bannerFetchLimiter,
  bannerClickLimiter,
  adminLimiter,
} = require("../middleware/rateLimit");
const { protect, authorize } = require("../middleware/auth");
const { securityRateLimit } = require("../middleware/securityRateLimit");
// SECURITY (Redis shared) — Step 1.4 (Banner)
// Applicato solo a route protette (req.user presente)
const RL = {
  mine: securityRateLimit({ scope: "banner_mine", windowMs: 60_000, max: 60 }),
  adminList: securityRateLimit({ scope: "banner_admin_list", windowMs: 60_000, max: 60 }),
  adminWrite: securityRateLimit({ scope: "banner_admin_write", windowMs: 60_000, max: 30 }),
  adminModerate: securityRateLimit({ scope: "banner_admin_moderate", windowMs: 60_000, max: 60 }),
  submit: securityRateLimit({ scope: "banner_submit", windowMs: 60_000, max: 10 }),
};

// ------------------------------------------------------------------
// Pubbliche
// ------------------------------------------------------------------

// Ritorna UN banner attivo alla volta (rotazione round-robin per placement/area)
router.get(
  "/active",
  bannerFetchLimiter,
  bannerController.getActiveBanners
);
// Ritorna UNA LISTA di banner attivi (batch) per placement/area
// (Fallback: finché non esiste getActiveBannersBatch, usa getActiveBanners)
router.get(
  "/active-batch",
  bannerFetchLimiter,
  (req, res, next) => {
    if (typeof bannerController.getActiveBannersBatch === "function") {
      return bannerController.getActiveBannersBatch(req, res, next);
    }
    return bannerController.getActiveBanners(req, res, next);
  }
);

// Registra click su un banner
router.post(
  "/:id/click",
  bannerClickLimiter,
  bannerController.clickBanner
);
// Supporta anche GET per i link diretti
router.get(
  "/:id/click",
  bannerClickLimiter,
  bannerController.clickBanner
);
// ------------------------------------------------------------------
// Organizer: lista dei MIEI banner
// ------------------------------------------------------------------
router.get(
  "/mine",
  protect,
  authorize("organizer", "admin"),
  RL.mine,
  bannerController.listBannersMine
);


// ------------------------------------------------------------------
// Admin CRUD & Moderazione
// ------------------------------------------------------------------

router.get(
  "/",
  adminLimiter,
  protect,
  RL.adminList,
  authorize("admin"),
  bannerController.listBannersAdmin
);


router.post(
  "/",
  adminLimiter,
  protect,
  RL.adminWrite,
  authorize("admin"),
  bannerController.createBanner
);


router.put(
  "/:id",
  adminLimiter,
  protect,
  RL.adminWrite,
  authorize("admin"),
  bannerController.updateBanner
);


router.delete(
  "/:id",
  adminLimiter,
  protect,
  RL.adminWrite,
  authorize("admin"),
  bannerController.deleteBanner
);

router.post(
  "/:id/approve",
  adminLimiter,
  protect,
  RL.adminModerate,
  authorize("admin"),
  bannerController.approveBanner
);

router.post(
  "/:id/reject",
  adminLimiter,
  protect,
  RL.adminModerate,
  authorize("admin"),
  bannerController.rejectBanner
);

router.post(
  "/:id/pause",
  adminLimiter,
  protect,
  RL.adminModerate,
  authorize("admin"),
  bannerController.pauseBanner
);

router.post(
  "/:id/resume",
  adminLimiter,
  protect,
  RL.adminModerate,
  authorize("admin"),
  bannerController.resumeBanner
);
// Organizer submit banner
router.post(
  "/submit",
  adminLimiter,
  protect,
  RL.submit,
  authorize("organizer","admin"),
  bannerController.submitBannerRequest
);

module.exports = router;
