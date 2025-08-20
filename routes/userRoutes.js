// routes/userRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/userController");
const { authRequired, roleRequired } = require("../middleware/auth");

// Public
router.post("/register", ctrl.register);
router.post("/login", ctrl.login);

// Auth
router.get("/me", authRequired, ctrl.me);
router.put("/session-role", authRequired, ctrl.setSessionRole);

// Partecipazione eventi (solo se loggato come participant in sessione)
router.post("/:id/partecipa", authRequired, roleRequired("participant"), ctrl.join);
router.post("/:id/annulla", authRequired, roleRequired("participant"), ctrl.leave);

module.exports = router;


