// backend/routes/bannerRoutes.js
// Rotte Banner — B1/1: fetch attivi + click tracking

const express = require("express");
const router = express.Router();

const bannerController = require("../controllers/bannerController");
const {
  bannerFetchLimiter,
  bannerClickLimiter,
} = require("../middleware/rateLimit");

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

// ------------------------------------------------------------------
// Admin CRUD (stubs) — da completare in B1/2 con proxy Netlify
// ------------------------------------------------------------------
// const { adminLimiter } = require("../middleware/rateLimit");
// const { requireAdmin } = require("../middleware/auth");

// router.post("/", adminLimiter, requireAdmin, bannerController.createBanner);
// router.put("/:id", adminLimiter, requireAdmin, bannerController.updateBanner);
// router.delete("/:id", adminLimiter, requireAdmin, bannerController.deleteBanner);

module.exports = router;
