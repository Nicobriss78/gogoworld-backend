// routes/eventRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/eventController");
const { authRequired, roleRequired } = require("../middleware/auth");

// Listing pubblico (filtri: status, visibility, city, region, country, category, isFree, dateFrom, dateTo)
router.get("/", ctrl.list);
router.get("/:id", ctrl.get);

// Organizer area
router.get("/mine/list", authRequired, roleRequired("organizer"), ctrl.listMine);
router.post("/", authRequired, roleRequired("organizer"), ctrl.create);
router.put("/:id", authRequired, roleRequired("organizer"), ctrl.update);
router.delete("/:id", authRequired, roleRequired("organizer"), ctrl.remove);

module.exports = router;




