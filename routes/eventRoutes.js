// backend/routes/eventRoutes.js
const express = require("express");
const router = express.Router();
const eventController = require("../controllers/eventController");
const { authRequired, roleRequired } = require("../middleware/auth");

// Pubbliche
router.get("/", eventController.list); // lista eventi
router.get("/:id", eventController.get); // singolo evento

// Solo ORGANIZZATORE
router.post(
  "/",
  authRequired,
  roleRequired("organizer"),
  eventController.create
);

router.put(
  "/:id",
  authRequired,
  roleRequired("organizer"),
  eventController.update
);

router.delete(
  "/:id",
  authRequired,
  roleRequired("organizer"),
  eventController.remove
);

module.exports = router;
