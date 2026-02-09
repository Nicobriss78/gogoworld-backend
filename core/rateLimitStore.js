// gogoworld-backend/core/rateLimitStore.js
// Redis-compatible client per rate-limit condiviso (SECURITY baseline).
// Nota: la dipendenza "redis" (node-redis) NON è attualmente nel package.json.
// Questo modulo usa require opzionale (pattern già usato in server.js per moduli opzionali).

const { logger } = require("./logger");

let redis = null;
try {
  // Richiede: npm i redis
  // (lo aggiungeremo quando passeremo a implementare il middleware 0.2 / Step 1.4 sulle route)
  redis = require("redis");
} catch {
  redis = null;
}

let client = null;
let clientPromise = null;

function envBool(v) {
  return String(v || "").toLowerCase() === "1" || String(v || "").toLowerCase() === "true";
}

/**
 * Ritorna un client Redis singleton pronto all'uso.
 * Connessione lazy (solo al primo utilizzo).
 *
 * Env:
 * - RATE_LIMIT_REDIS_URL (obbligatoria quando attivi il rate-limit condiviso)
 * - RATE_LIMIT_REDIS_TLS (opzionale: "1"/"true")
 */
async function getRateLimitClient() {
  const url = process.env.RATE_LIMIT_REDIS_URL || "";
  const useTls = envBool(process.env.RATE_LIMIT_REDIS_TLS);

  if (!url) {
    throw new Error("RATE_LIMIT_REDIS_URL mancante: impossibile inizializzare rate-limit store.");
  }

  if (!redis || typeof redis.createClient !== "function") {
    throw new Error(
      'Dipendenza Redis mancante: installa "redis" (npm i redis) per attivare il rate-limit condiviso.'
    );
  }

  // singleton già pronto
  if (client) return client;

  // singleton in corso di creazione
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const c = redis.createClient({
      url,
      // Alcuni provider Redis-managed richiedono TLS: abilitiamo via env.
      socket: useTls ? { tls: true } : undefined,
    });

    c.on("error", (err) => {
      // Non logghiamo segreti; solo messaggio.
      logger.warn("⚠️ Redis rate-limit client error:", err?.message || err);
    });

    await c.connect();

    logger.info("✅ Redis rate-limit client connected");
    client = c;
    return client;
  })();

  return clientPromise;
}

/**
 * Chiusura pulita (utile per test/shutdown).
 */
async function closeRateLimitClient() {
  try {
    if (client) await client.quit();
  } catch (e) {
    logger.warn("⚠️ Redis rate-limit client quit failed:", e?.message || e);
  } finally {
    client = null;
    clientPromise = null;
  }
}

module.exports = {
  getRateLimitClient,
  closeRateLimitClient,
};

