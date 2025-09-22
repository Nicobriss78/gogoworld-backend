// server.js — GoGo.World API (CORS hardening prod + ordine middleware)

const express = require("express");
const dotenv = require("dotenv");
dotenv.config();
const { config } = require("./config");
const { logger } = require("./core/logger"); // #CORE-LOGGER B1
const app = express();

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

// ---- Routes ----
const userRoutes = require("./routes/userRoutes");
const eventRoutes = require("./routes/eventRoutes");
const adminRoutes = require("./routes/adminRoutes");
const reviewRoutes = require("./routes/reviewRoutes"); // PATCH: recensioni
const healthRoutes = require("./routes/health"); // #HEALTHZ

app.use("/api/users", userRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/reviews", reviewRoutes); // PATCH: recensioni
app.use("/healthz", healthRoutes); // #HEALTHZ
// Root & Health
app.get("/", (_req, res) => res.json({ ok: true, name: "GoGo.World API", version: "v1" }));

// 404
app.use((req, res, _next) => {
  res.status(404).json({ ok: false, error: "NOT_FOUND", path: req.originalUrl });
});

// Error handler centralizzato
const { errorHandler } = require("./middleware/error");
app.use(errorHandler);

// Avvio
const PORT = config.PORT || 3000;
app.listen(PORT, () => {
logger.info(`🚀 GoGo.World API in ascolto sulla porta ${PORT}`);
});










