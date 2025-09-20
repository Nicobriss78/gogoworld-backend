// server.js — GoGo.World API (CORS hardening prod + ordine middleware)

const express = require("express");
const dotenv = require("dotenv");
dotenv.config();

const app = express();

// Log opzionale (non bloccante)
let morgan = null;
try { morgan = require("morgan"); } catch { /* opzionale */ }
if (morgan) app.use(morgan("dev"));

// DB prima delle routes
const connectDB = require("./db");
const dbReady = connectDB().catch((err) => {
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
    // Richieste server-to-server (no Origin) sempre consentite
    if (!origin) return cb(null, true);

    // In produzione, se non configurato nessun origin, blocca esplicitamente
    if (ORIGINS.length === 0 && process.env.NODE_ENV === "production") {
      return cb(new Error("CORS_NOT_CONFIGURED"));
    }

    const clean = origin.replace(/\/$/, "");
    if (ORIGINS.length === 0) return cb(null, true); // dev permissivo
    if (ORIGINS.includes(origin) || ORIGINS.includes(clean)) return cb(null, true);

    return cb(new Error("CORS_NOT_ALLOWED"));
  },
  methods: ["GET","POST","PUT","DELETE","PATCH","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","X-Requested-With","Accept"], // PATCH: aggiunto Accept
  maxAge: 86400,
  optionsSuccessStatus: 204, // PATCH: risposta uniforme ai preflight
};
app.use(cors(corsOptions));

// 👉 Preflight CORS per tutte le rotte (AGGIUNTA CHIRURGICA)
app.options("*", cors(corsOptions));
// Assicura l'indice unico reviews (event+participant) anche in produzione
dbReady.then(async () => {
  try {
    const Review = require("./models/reviewModel");
    await Review.syncIndexes();
    console.log("✅ Review indexes synced");
  } catch (e) {
    console.error("⚠️ Review index sync failed:", e?.message || e);
  }
});

// Parser
app.use(express.json({ limit: process.env.JSON_LIMIT || "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ---- Routes ----
const userRoutes = require("./routes/userRoutes");
const eventRoutes = require("./routes/eventRoutes");
const adminRoutes = require("./routes/adminRoutes");
const reviewRoutes = require("./routes/reviewRoutes"); // PATCH: recensioni

app.use("/api/users", userRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/reviews", reviewRoutes); // PATCH: recensioni

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






