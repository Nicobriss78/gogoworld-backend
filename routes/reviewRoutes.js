// backend/routes/reviewRoutes.js

const express = require("express");
const router = express.Router();
const {
  listReviews,
  createReview,
  updateMyReview,
  adminApprove,
  adminReject,
} = require("../controllers/reviewController");

const { protect, authorize } = require("../middleware/auth");

// -----------------------------------------------------------
// Public / protected endpoints
// -----------------------------------------------------------

// Lista recensioni (per evento o per organizzatore)
// - Pubblico: solo approved
// - Admin: può chiedere qualsiasi status
router.get("/", listReviews);

// Crea nuova recensione (solo utente autenticato)
router.post("/", protect, createReview);

// Aggiorna propria recensione (entro 24h, solo se pending)
router.patch("/:id", protect, updateMyReview);

// -----------------------------------------------------------
// Admin endpoints
// -----------------------------------------------------------
router.patch("/:id/approve", protect, authorize("admin"), adminApprove);
router.patch("/:id/reject", protect, authorize("admin"), adminReject);

module.exports = router;
