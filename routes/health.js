// routes/health.js
const express = require("express");
const router = express.Router();
const { config } = require("../config");

router.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "GoGo.World API",
    version: "v1",
    uptime_s: Math.floor(process.uptime()),
    env: config.NODE_ENV,
  });
});

module.exports = router;
