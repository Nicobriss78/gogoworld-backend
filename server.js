// server.js (versione aggiornata – morgan opzionale)
const express = require("express");
const app = express();
const cors = require("cors");

// morgan opzionale: se non installato, non blocca il runtime
function tryRequire(name) {
  try { return require(name); } catch { return null; }
}
const morgan = tryRequire("morgan");

const dotenv = require("dotenv");
dotenv.config();

const userRoutes = require("./routes/userRoutes");
const eventRoutes = require("./routes/eventRoutes");
const welcomeRoutes = require("./routes/welcome");
const { errorHandler } = require("./middleware/error"); // presente

// CORS (se in server unico si può rimuovere/lasciare vuoto)
const origins = (process.env.CORS_ORIGIN_FRONTEND || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors(origins.length ? { origin: origins } : {}));
app.use(express.json());

// Attiva morgan solo se disponibile
if (morgan) app.use(morgan("dev"));

// DB
require("./db");

// 🔹 Healthcheck/warm‑up molto leggero
app.get("/api/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Routes
app.use("/api/users", userRoutes);
app.use("/api/events", eventRoutes);
app.use("/welcome", welcomeRoutes);

// (montaggio condizionale /internal in base ai flag esistenti)
// ... il tuo codice attuale qui resta invariato ...

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), timestamp: Date.now() });
});


// Error handler — deve rimanere l’ULTIMO middleware
app.use(errorHandler);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`GoGo.World backend running on port ${PORT}`);
});

























