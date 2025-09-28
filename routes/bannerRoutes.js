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

// ------------------------------------------------------------------
// Pubbliche
// ------------------------------------------------------------------

// Ritorna UN banner attivo alla volta (rotazione round-robin per placement/area)
router.get(
  "/active",
  bannerFetchLimiter,
  bannerController.getActiveBanners
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
// Admin CRUD & Moderazione
// ------------------------------------------------------------------

router.get(
  "/",
  adminLimiter,
  protect,
  authorize("admin"),
  bannerController.listBannersAdmin
);

router.post(
  "/",
  adminLimiter,
  protect,
  authorize("admin"),
  bannerController.createBanner
);

router.put(
  "/:id",
  adminLimiter,
  protect,
  authorize("admin"),
  bannerController.updateBanner
);

router.delete(
  "/:id",
  adminLimiter,
  protect,
  authorize("admin"),
  bannerController.deleteBanner
);

router.post(
  "/:id/approve",
  adminLimiter,
  protect,
  authorize("admin"),
  bannerController.approveBanner
);

router.post(
  "/:id/reject",
  adminLimiter,
  protect,
  authorize("admin"),
  bannerController.rejectBanner
);

router.post(
  "/:id/pause",
  adminLimiter,
  protect,
  authorize("admin"),
  bannerController.pauseBanner
);

router.post(
  "/:id/resume",
  adminLimiter,
  protect,
  authorize("admin"),
  bannerController.resumeBanner
);
// Organizer submit banner
router.post(
  "/submit",
  adminLimiter,
  protect,
  authorize("organizer","admin"),
  bannerController.submitBannerRequest
);

module.exports = router;
