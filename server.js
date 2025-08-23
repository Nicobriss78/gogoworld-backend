// server.js — GoGo.World (Fase 1 infrastruttura) — 2025-08-23
// Completa il server: CORS, JSON, mount routes, error handling, listen.
// Non modifica la logica dei controller: monta solo ciò che esiste.

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const app = express();

// Log opzionale (non bloccante)
let morgan = null;
try { morgan = require("morgan"); } catch { /* opzionale */ }

// DB
const connectDB = require("./db");
connectDB();

// Trust proxy (Render / reverse proxies)
app.set("trust proxy", 1);

// CORS
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(s => s.trim()).filter(Boolean)
  : ["*"];

const corsOpts = {
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin)) {
      return cb(null, true);
    }
    return cb(new Error("CORS_NOT_ALLOWED"));
  },
  credentials: true,
  methods: ["GET","POST","PUT","DELETE","PATCH","OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};
app.use(cors(corsOpts));

// Body parsers
app.use(express.json({ limit: process.env.JSON_LIMIT || "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Logger
if (morgan) app.use(morgan("dev"));

// Routes
const userRoutes = require("./routes/userRoutes");
const eventRoutes = require("./routes/eventRoutes");
app.use("/api/users", userRoutes);
app.use("/api/events", eventRoutes);

// Health / root
app.get("/", (_req, res) => res.json({ ok: true, name: "GoGo.World API", version: "v1" }));
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// 404
app.use((req, res, _next) => {
  res.status(404).json({ ok: false, error: "NOT_FOUND", path: req.originalUrl });
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const payload = {
    ok: false,
    error: err.code || err.name || "SERVER_ERROR",
    message: err.message || "Unexpected error",
  };
  if (process.env.NODE_ENV !== "production" && err.stack) {
    payload.stack = err.stack;
  }
  res.status(status).json(payload);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 GoGo.World API listening on port ${PORT}`);
});

module.exports = app;





























