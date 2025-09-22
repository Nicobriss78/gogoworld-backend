// backend/routes/reviewRoutes.js

const express = require("express");
const router = express.Router();
const {
  listReviews,
  createReview,
  updateMyReview,
  adminApprove,
  adminReject,
  adminListPending, // <-- aggiunto
} = require("../controllers/reviewController");

const { protect, authorize } = require("../middleware/auth");
const { adminLimiter, writeLimiter } = require("../middleware/rateLimit"); // #RL

// -----------------------------------------------------------
// Public / protected endpoints
// -----------------------------------------------------------

// Lista recensioni (per evento o per organizzatore)
// - Pubblico: solo approved
// - Admin: può chiedere qualsiasi status
router.get("/", listReviews);
router.get("/pending", adminLimiter, protect, authorize("admin"), adminListPending);

// Crea nuova recensione (solo utente autenticato)
router.post("/", writeLimiter, protect, createReview);

// Aggiorna propria recensione (entro 24h, solo se pending)
router.patch("/:id", writeLimiter, protect, updateMyReview);

// -----------------------------------------------------------
// Admin endpoints
// -----------------------------------------------------------
router.patch("/:id/approve", adminLimiter, protect, authorize("admin"), adminApprove);
router.patch("/:id/reject", adminLimiter, protect, authorize("admin"), adminReject);

module.exports = router;
