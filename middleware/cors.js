// backend/middleware/cors.js

// Legge gli origin permessi da env CORS_ORIGIN_FRONTEND / ALLOWED_ORIGINS
// Esempio: https://playful-blini-646b72.netlify.app, https://www.tuodominio.it
const { config } = require("../config");
const cors = require("cors");

// Normalizza valori ENV a array di stringhe (gestisce array o stringa comma-separated)
function toArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    return val
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

const mergedOrigins = [
  ...toArray(config.CORS_ORIGIN_FRONTEND),
  ...toArray(config.ALLOWED_ORIGINS),
];

let allowedOrigins = mergedOrigins.map((s) => s.trim()).filter(Boolean);

// Include automaticamente l'origin di BASE_URL (se presente)
try {
  if (config.BASE_URL) {
    const baseOrigin = new URL(config.BASE_URL).origin;
    if (baseOrigin) allowedOrigins.push(baseOrigin);
  }
} catch {}

// dedup
allowedOrigins = Array.from(new Set(allowedOrigins));

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // richieste server-to-server o curl
    if (allowedOrigins.length === 0) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    const e = new Error("Not allowed by CORS");
    e.status = 403;
    e.code = "CORS_NOT_ALLOWED";
    return callback(e);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  // PATCH: header completi (aggiunto anche X-Internal-Api-Key)
  allowedHeaders: [
    "Authorization",
    "Content-Type",
    "X-Requested-With",
    "Accept",
    "Origin",
    "X-Internal-Key",
    "X-Internal-Api-Key",
  ],
  credentials: false,
  maxAge: 86400,
  // PATCH: risposta corretta alle OPTIONS
  optionsSuccessStatus: 204,
};

module.exports = cors(corsOptions);
