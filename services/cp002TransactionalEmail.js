'use strict';

// CP002-B — adapter transazionale isolato. Nessun invio è attivo per default.
// Questo file NON modifica i controller, le route o le configurazioni.
// Esiti: accepted = preso in carico dal provider, NON consegnato.
const PROVIDER_URL = 'https://api.resend.com/emails';
const ALLOWED_MODES = new Set(['disabled', 'fake', 'resend']);

function deliveryReadiness() {
  const requestedMode = String(process.env.CP002_EMAIL_MODE || 'disabled').trim().toLowerCase();
  if (!ALLOWED_MODES.has(requestedMode)) {
    return { mode: 'disabled', ready: false, reason: 'invalid_mode' };
  }
  if (requestedMode === 'disabled') {
    return { mode: 'disabled', ready: false, reason: 'delivery_disabled' };
  }
  // Il fake non deve essere abilitabile implicitamente in ambienti reali.
  if (requestedMode === 'fake') {
    return process.env.NODE_ENV === 'test'
      ? { mode: 'fake', ready: true }
      : { mode: 'fake', ready: false, reason: 'fake_requires_test_environment' };
  }
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    return { mode: 'resend', ready: false, reason: 'provider_not_configured' };
  }
  if (typeof globalThis.fetch !== 'function') {
    return { mode: 'resend', ready: false, reason: 'fetch_unavailable' };
  }
  return { mode: 'resend', ready: true };
}

function reject(reason) {
  return { state: 'rejected', reason, delivered: false };
}

function uncertain(reason) {
  return { state: 'unknown', reason, delivered: false };
}

function accepted(transport, messageId) {
  return {
    state: 'accepted',
    transport,
    delivered: false,
    ...(messageId ? { messageId } : {}),
  };
}

function validMessage({ to, subject, html, text, idempotencyKey }) {
  return (
    typeof to === 'string' &&
    to.length > 3 &&
    to.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) &&
    typeof subject === 'string' &&
    subject.length > 0 &&
    subject.length <= 200 &&
    ((typeof html === 'string' && html.length > 0) ||
      (typeof text === 'string' && text.length > 0)) &&
    typeof idempotencyKey === 'string' &&
    /^[a-zA-Z0-9_-]{16,128}$/.test(idempotencyKey)
  );
}

/**
 * Un solo tentativo di consegna. NON riprovare dopo 'unknown' usando un
 * token o payload nuovo: l'accettazione del provider potrebbe essere avvenuta.
 * L'idempotencyKey deve restare uguale soltanto per il medesimo payload.
 * Non restituire né registrare destinatario, corpo, token o URL sensibili.
 */
async function sendTransactionalEmail(message) {
  if (!message || !validMessage(message)) return reject('invalid_message');

  const readiness = deliveryReadiness();
  if (!readiness.ready) return reject(readiness.reason);

  if (readiness.mode === 'fake') {
    // Solo NODE_ENV=test, nessuna email né prova di recapito.
    return accepted('fake');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const payload = {
      from: process.env.RESEND_FROM_EMAIL,
      to: [message.to],
      subject: message.subject,
      ...(typeof message.html === 'string' ? { html: message.html } : {}),
      ...(typeof message.text === 'string' ? { text: message.text } : {}),
    };
    const response = await fetch(PROVIDER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': message.idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (response.ok) {
      // Senza ID non fingere di conoscere l'esito della presa in carico.
      const providerResult = await response.json().catch(() => null);
      const messageId = providerResult && typeof providerResult.id === 'string'
        ? providerResult.id
        : null;
      return messageId ? accepted('resend', messageId) : uncertain('provider_response_uncertain');
    }

    // 5xx: il provider potrebbe aver accettato l'operazione.
    if (response.status >= 500) return uncertain('provider_server_error');
    // I 4xx sono rifiuti espliciti. Non inserire il payload del provider nei log.
    return reject('provider_rejected');
  } catch (_error) {
    // Timeout/connessione ambigui: non trasformare in 'rejected' né ritentare.
    return uncertain('transport_uncertain');
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  deliveryReadiness,
  sendTransactionalEmail,
};
