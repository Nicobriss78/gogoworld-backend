const express = require("express");
const router = express.Router();

const { protect, authorize } = require("../middleware/auth");
const { writeLimiter } = require("../middleware/rateLimit");
const { securityRateLimit } = require("../middleware/securityRateLimit");
const { searchGeocode } = require("../controllers/geocodeController");

const geocodeLimiter = securityRateLimit({
  scope: "geocode_search",
  windowMs: 60_000,
  max: 10,
});

router.post(
  "/search",
  writeLimiter,
  protect,
  geocodeLimiter,
  authorize("organizer"),
  searchGeocode
);

module.exports = router;
