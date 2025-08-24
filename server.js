// server.js — GoGo.World API (ricostruito, coerente con Dinamiche 22-08-2025)
// - CORS basato su ALLOWED_ORIGINS e/o CORS_ORIGIN_FRONTEND
// - Health endpoints (/healthz e /api/health)
// - Mount routes utenti ed eventi
// - Error handling centralizzato

const express = require("express");
const dotenv = require("dotenv");
dotenv.config();

const app = express();

// DB
const connectDB = require("./db");
connectDB().catch((err) => {
  console.error("❌ DB init failed:", err?.message || err);
  process.exit(1);
});

// Trust proxy (Render)
app.set("trust proxy", 1);

// ---- CORS ----
const cors = require("cors");
function parseOrigins() {
  const list = []
    .concat((process.env.ALLOWED_ORIGINS || "").split(","))
    .concat((process.env.CORS_ORIGIN_FRONTEND || "").split(","))
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  // de-dup
  return Array.from(new Set(list));
}
const ORIGINS = parseOrigins();
const corsOptions = {
  origin: function (origin, cb) {
    if (!origin) return cb(null, true); // SSR/curl
    if (ORIGINS.length === 0) return cb(null, true); // default allow in dev
    if (ORIGINS.includes(origin)) return cb(null, true);
    // consenti anche origin con slash finale rimosso
    const clean = origin.replace(/\/$/, "");
    if (ORIGINS.includes(clean)) return cb(null, true);
    return cb(new Error("CORS_NOT_ALLOWED"));
  },
  methods: ["GET","POST","PUT","DELETE","PATCH","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
  maxAge: 86400,
};
app.use(cors(corsOptions));

// Body parsers
app.use(express.json({ limit: process.env.JSON_LIMIT || "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Logger opzionale
try { app.use(require("morgan")("dev")); } catch { /* opzionale su Render */ }

// ---- Routes ----
const userRoutes = require("./routes/userRoutes");
const eventRoutes = require("./routes/eventRoutes");

app.use("/api/users", userRoutes);
app.use("/api/events", eventRoutes);

// Root & Health
app.get("/", (_req, res) => res.json({ ok: true, name: "GoGo.World API", version: "v1" }));
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// 404
app.use((req, res, _next) => {
  res.status(404).json({ ok: false, error: "NOT_FOUND", path: req.originalUrl });
});

// Error handler centralizzato
const errorHandler = require("./middleware/error");
app.use(errorHandler);

// Avvio (Render usa process.env.PORT)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 GoGo.World API in ascolto sulla porta ${PORT}`);
});
