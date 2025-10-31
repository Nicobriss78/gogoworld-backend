// server.js — GoGo.World API (CORS hardening prod + ordine middleware)

const express = require("express");
const dotenv = require("dotenv");
dotenv.config();
const path = require("path");
const { config } = require("./config");
const { logger } = require("./core/logger"); // #CORE-LOGGER B1
// Sentry (server-only). DSN/ENV/RELEASE da variabili d'ambiente.
// Nessun effetto se @sentry/node non è installato o DSN assente.
let Sentry = null;
try { Sentry = require("@sentry/node"); } catch { /* opzionale */ }
if (Sentry && process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENV || (config.NODE_ENV || "production"),
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: 0, // "light": niente tracing
  });
  global.Sentry = Sentry;
}

const app = express();

// Hardening: rimuove header X-Powered-By
app.disable("x-powered-by");

// security middlewares imports
const helmet = require("helmet");
const hpp = require("hpp");

// Log opzionale (non bloccante)
let morgan = null;
try { morgan = require("morgan"); } catch { /* opzionale */ }
if (morgan) app.use(morgan("dev"));

// DB prima delle routes
const connectDB = require("./db");
const dbReady = connectDB().catch((err) => {
  logger.error("❌ DB init failed:", err?.message || err);
  process.exit(1);
});

// Proxy (Render / reverse proxies)
app.set("trust proxy", 1);

// ---- CORS ----
const corsMiddleware = require("./middleware/cors"); // usa middleware dedicato

app.use(corsMiddleware);

// 👉 Preflight CORS per tutte le rotte (AGGIUNTA CHIRURGICA)
app.options("*", corsMiddleware);
// Assicura l'indice unico reviews (event+participant) anche in produzione
dbReady.then(async () => {
  try {
    const Review = require("./models/reviewModel");
    await Review.syncIndexes();
    logger.info("✅ Review indexes synced");
  } catch (e) {
    logger.warn("⚠️ Review index sync failed:", e?.message || e);
  }
});

// Parser
app.use(express.json({ limit: process.env.JSON_LIMIT || "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ---- Security Middlewares ----
app.use(helmet({
  crossOriginEmbedderPolicy: false, // compatibilità con frontend Netlify
}));
// CSP minimale: consente solo risorse dal self (Netlify domain) + inline styles sicuri
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"], // solo script locali
      styleSrc: ["'self'", "'unsafe-inline'"], // inline style ok (es. bootstrap, admin UI)
      imgSrc: ["'self'", "data:"], // immagini locali o inline
 // costruisci connectSrc filtrando valori vuoti
 connectSrc: (["'self'", config.BASE_URL].filter(Boolean)),
 frameAncestors: ["'none'"], // nessun embedding in iframe
    },
  })
);

app.use(hpp());
// Sentry request handler (se inizializzato)
if (global.Sentry) app.use(global.Sentry.Handlers.requestHandler());
// Static per file caricati (avatar, ecc.)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
// Static anche dietro al proxy /api/* (Netlify → Render)
app.use("/api/uploads", express.static(path.join(__dirname, "uploads")));

// ---- Routes ----
const userRoutes = require("./routes/userRoutes");
const eventRoutes = require("./routes/eventRoutes");
const bannerRoutes = require("./routes/bannerRoutes");
const adminRoutes = require("./routes/adminRoutes");
const reviewRoutes = require("./routes/reviewRoutes"); // PATCH: recensioni
const healthRoutes = require("./routes/health"); // #HEALTHZ
const profileRoutes = require("./routes/profile"); // NEW: profilo utente (C1)
const dmRoutes = require("./routes/dm"); // NEW: messaggi 1:1 (C2)
const roomsRoutes = require("./routes/rooms"); // NEW: chat evento pubblica (C2.2)


app.use("/api/users", userRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/banners", bannerRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/reviews", reviewRoutes); // PATCH: recensioni
app.use("/api/profile", profileRoutes); // NEW: profilo utente (C1)
app.use("/api/dm", dmRoutes); // NEW: messaggi 1:1 (C2)
app.use("/api/rooms", roomsRoutes); // NEW: chat evento pubblica (C2.2)
app.use("/healthz", healthRoutes); // #HEALTHZ
// Root & Health
app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.get("/", (_req, res) => res.json({ ok: true, name: "GoGo.World API", version: "v1" }));

// 404
app.use((req, res, _next) => {
  res.status(404).json({ ok: false, error: "NOT_FOUND", path: req.originalUrl });
});
// Sentry error handler (se inizializzato) — deve stare prima del nostro handler
if (global.Sentry) app.use(global.Sentry.Handlers.errorHandler());
// Error handler centralizzato
const { errorHandler } = require("./middleware/error");
app.use(errorHandler);
// Global safety nets (log + Sentry se disponibile)
process.on("unhandledRejection", (reason) => {
  try {
    if (global.Sentry) global.Sentry.captureException(reason);
    logger.error("UnhandledRejection:", reason && reason.message ? reason.message : String(reason));
  } catch {}
});
process.on("uncaughtException", (err) => {
  try {
    if (global.Sentry) global.Sentry.captureException(err);
    logger.error("UncaughtException:", err && err.message ? err.message : String(err));
  } catch {}
});

// Avvio
const PORT = config.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`🚀 GoGo.World API in ascolto sulla porta ${PORT}`);
});













