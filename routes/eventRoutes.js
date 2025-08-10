const express = require("express");
const router = express.Router();
const eventController = require("../controllers/eventController");

// REST endpoints
router.get("/", eventController.list); // lista eventi
router.get("/:id", eventController.get); // singolo evento
router.post("/", eventController.create); // crea evento
router.put("/:id", eventController.update); // aggiorna evento
router.delete("/:id", eventController.remove); // elimina evento

module.exports = router;