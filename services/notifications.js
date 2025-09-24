// gogoworld-backend/services/notifications.js
// Adapter minimale per Notifiche (DEV -> logger; PROD -> stub provider via ENV)

const { logger } = require("../core/logger"); // #CORE-LOGGER N1
const { config } = require("../config"); // ENV: EMAIL_PROVIDER, EMAIL_FROM, BASE_URL, NODE_ENV

function isProdWithProvider() {
  return config.NODE_ENV === "production" && !!config.EMAIL_PROVIDER;
}

/**
 * notify(type, payload)
 * type: string (es. "event_created", "event_joined", "review_approved", ...)
 * payload: object (campi liberi coerenti con il type)
 *
 * Comportamento:
 * - DEV (o provider assente): log strutturato (non invia niente).
 * - PROD + provider presente: (stub) log che simula invio.
 * In futuro: instradare verso email/SMS/push in base a EMAIL_PROVIDER.
 */
async function notify(type, payload = {}) {
  try {
    if (!type || typeof type !== "string") return;

    const envelope = {
      type,
      payload,
      baseUrl: config.BASE_URL || "",
      from: config.EMAIL_FROM || "",
      env: config.NODE_ENV,
      ts: new Date().toISOString(),
    };

    if (!isProdWithProvider()) {
      // DEV o PROD senza provider -> solo log informativo
      logger.info("[notify:dev]", envelope);
      return;
    }

    // PROD con provider definito → per ora stub che logga (senza inviare)
    // Punto di estensione futuro:
    // switch (config.EMAIL_PROVIDER) { case 'resend': ... case 'sendgrid': ... default: ... }
    logger.info("[notify:prod-stub] would send via provider", {
      provider: config.EMAIL_PROVIDER,
      ...envelope,
    });
  } catch (err) {
    logger.warn("[notify:error]", err?.message || err);
  }
}

module.exports = { notify };
