
// routes/eventRoutes.js — mappa endpoint eventi (completo)
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/eventController");
const { authRequired, roleRequired } = require("../middleware/auth");

// Pubblici
router.get("/", ctrl.list);
router.get("/:id", ctrl.getById);

// Protetti (solo organizzatore può creare/modificare/eliminare)
router.post("/", authRequired, roleRequired("organizer"), ctrl.create);
router.put("/:id", authRequired, roleRequired("organizer"), ctrl.update);
router.delete("/:id", authRequired, roleRequired("organizer"), ctrl.remove);

module.exports = router;




