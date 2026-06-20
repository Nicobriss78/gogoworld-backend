const express = require("express");
const router = express.Router();

const { protect, authorize } = require("../middleware/auth");
const {
  getOrganizerEventsMapSummary,
} = require("../controllers/organizerMapController");

router.get(
  "/events/map-summary",
  protect,
  authorize("organizer"),
  getOrganizerEventsMapSummary
);

module.exports = router;
