// gogoworld-backend/config/index.js
// Centralizzazione ENV + parsing sicuro (no behavior change).

const dotenv = require("dotenv");
dotenv.config();

function parseList(v) {
  return String(v || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

const config = {
  NODE_ENV: process.env.NODE_ENV || "production",
  PORT: Number(process.env.PORT || 3000),

  // Database
  DB_URI: process.env.MONGODB_URI || "",

  // Auth
  JWT_SECRET: process.env.JWT_SECRET || "",

  // CORS / Origins
  CORS_ORIGIN_FRONTEND: parseList(process.env.CORS_ORIGIN_FRONTEND),
  ALLOWED_ORIGINS: parseList(process.env.ALLOWED_ORIGINS),

  // Interni (Onira hooks, idempotenza, audit)
  INTERNAL_API_KEY: process.env.INTERNAL_API_KEY || "",
  IDEMP_TTL_MS: Number(process.env.IDEMP_TTL_MS || 300000),
  AUDIT_FILE: process.env.AUDIT_FILE || "./storage/audit.jsonl",

  // Policy/Event window
  IMMINENT_HOURS: Number(process.env.IMMINENT_HOURS || 72),
  SHOW_CONCLUDED_HOURS: Number(process.env.SHOW_CONCLUDED_HOURS || 12),

  // Campaign Memory Engine V1 — scheduler automatico snapshot promo concluse
  CAMPAIGN_MEMORY_SCHEDULER_ENABLED: process.env.CAMPAIGN_MEMORY_SCHEDULER_ENABLED || "false",
  CAMPAIGN_MEMORY_SCHEDULER_INTERVAL_MS: Number(process.env.CAMPAIGN_MEMORY_SCHEDULER_INTERVAL_MS || 86400000),
  CAMPAIGN_MEMORY_SCHEDULER_STARTUP_DELAY_MS: Number(process.env.CAMPAIGN_MEMORY_SCHEDULER_STARTUP_DELAY_MS || 60000),
  CAMPAIGN_MEMORY_SCHEDULER_LIMIT: Number(process.env.CAMPAIGN_MEMORY_SCHEDULER_LIMIT || 25),

  // Future placeholders (non usati ora, per compat con Starter)
  EMAIL_PROVIDER: process.env.EMAIL_PROVIDER || "",
  EMAIL_FROM: process.env.EMAIL_FROM || "",
  BASE_URL: process.env.BASE_URL || "",
};

module.exports = { config };
