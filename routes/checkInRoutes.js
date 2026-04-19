const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const { checkInLimiter } = require("../middleware/rateLimit");

const {
  createCheckIn,
  getCheckInStatus,
  getCheckInPrecheck,
  getEventCheckInSummary,
  listEventCheckIns,
} = require("../controllers/checkInController");

router.post("/", protect, checkInLimiter, createCheckIn);

router.get("/events/:id/status", protect, getCheckInStatus);
router.post("/events/:id/precheck", protect, getCheckInPrecheck);
router.get("/events/:id/summary", protect, getEventCheckInSummary);
router.get("/events/:id/list", protect, listEventCheckIns);

module.exports = router;
