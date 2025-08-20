// server.js — GoGo.World (vNext) — 2025-08-20
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const app = express();

// Log (opzionale)
let morgan = null;
try { morgan = require("morgan"); } catch { /* opzionale */ }

// DB
const connectDB = require("./db");
connectDB();

// Middleware base
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
if (morgan) app.use(morgan("dev"));

// CORS
const CORS_ORIGIN = process.env.CORS_ORIGIN_FRONTEND || "*";
app.use(cors({ origin: CORS_ORIGIN }));

// Healthcheck (usato per Render cold start)
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "gogoworld-api", ts: Date.now() });
});

// Routes
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/events", require("./routes/eventRoutes"));

// Error handler
const { errorHandler } = require("./middleware/error");
app.use(errorHandler);

// Avvio
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`GoGo.World API listening on ${PORT}`);
});



























