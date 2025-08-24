// server.js — GoGo.World API (ricostruito e allineato a Dinamiche 22-08-2025)
//
// - CORS legge ALLOWED_ORIGINS (CSV) e/o CORS_ORIGIN_FRONTEND (singola o CSV).
// - Health endpoints: /healthz e /api/health.
// - Mount delle routes: /api/users, /api/events, /welcome (facoltativa).
// - Error handling centralizzato (middleware/error.js).
// - Connessione a Mongo avviata PRIMA del mount delle routes.
// - Trust proxy abilitato (Render).
//
// ENV considerate: MONGODB_URI, JWT_SECRET, CORS_ORIGIN_FRONTEND, ALLOWED_ORIGINS,
// AUDIT_FILE, INTERNAL_API_KEY, IDEMP_TTL_MS (queste ultime usate da moduli interni, non qui).

const express = require("express");
const dotenv = require("dotenv");
dotenv.config();

const app = express();

// Log opzionale (non bloccante)
let morgan = null;
try { morgan = require("morgan"); } catch { /* opzionale su Render */ }
if (morgan) app.use(morgan("dev"));

// DB
const connectDB = require("./db");
connectDB().catch((err) => {
  console.error("❌ DB init failed:", err?.message || err);
  process.exit(1);
});

// Proxy (Render / reverse proxies)
app.set("trust proxy", 1);

// ---- CORS ----
const cors = require("cors");

function parseOrigins() {
  const list = []
    .concat((process.env.ALLOWED_ORIGINS || "").split(","))
    .concat((process.env.CORS_ORIGIN_FRONTEND || "").split(","))
    .map(s => String(s || "").trim())
    .filter(Boolean);
  return Array.from(new Set(list));
}
const ORIGINS = parseOrigins();

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // SSR/cURL
    if (ORIGINS.length === 0) return cb(null, true); // permissivo in dev
    const clean = origin.replace(/\/$/, "");
    if (ORIGINS.includes(origin) || ORIGINS.includes(clean)) return cb(null, true);
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

// ---- Routes ----
const userRoutes = require("./routes/userRoutes");
const eventRoutes = require("./routes/eventRoutes");
const welcomeRoutes = require("./routes/welcome"); // opzionale

app.use("/api/users", userRoutes);
app.use("/api/events", eventRoutes);
app.use("/welcome", welcomeRoutes);

// Root & Health
app.get("/", (_req, res) => res.json({ ok: true, name: "GoGo.World API", version: "v1" }));
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// 404
app.use((req, res, _next) => {
  res.status(404).json({ ok: false, error: "NOT_FOUND", path: req.originalUrl });
});

// Error handler centralizzato
const { errorHandler } = require("./middleware/error");
app.use(errorHandler);

// Avvio
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 GoGo.World API in ascolto sulla porta ${PORT}`);
});
