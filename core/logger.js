// gogoworld-backend/core/logger.js
// Logger minimale, centralizzato (wrappa console). Estendibile in futuro.

const { config } = require("../config");

function base(level, ...args) {
  // In futuro: aggiungi timestamp, request-id, transport esterno ecc.
  // Qui manteniamo comportamento invariato (console.*).
  // NODE_ENV può modulare la verbosità.
  try {
    // eslint-disable-next-line no-console
    console[level](...args);
  } catch {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
}

const logger = {
  info: (...args) => base("info", ...args),
  warn: (...args) => base("warn", ...args),
  error: (...args) => base("error", ...args),
  debug: (...args) => {
    if (config.NODE_ENV !== "production") base("debug", ...args);
  },
};

module.exports = { logger };
