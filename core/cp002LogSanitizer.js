'use strict';

// CP002-A: impedisce emissione accidentale di credenziali/token nei sink.
// Non sostituisce policy di retention o bonifica dei log storici.
function redactText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\bBearer\s+[a-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/([?&#](?:token|access_token|reset_token|password|code)=)[^&#\s]*/gi,
      '$1[REDACTED]')
    .replace(/\b[a-f0-9]{64}\b/gi, '[REDACTED]');
}

function sanitizedPath(value) {
  if (typeof value !== 'string' || !value.length) return '[REDACTED_URL]';
  try {
    const parsed = new URL(value, 'https://private.invalid');
    // Nessuna query/fragmento: i vecchi link GET contengono token.
    return parsed.pathname.replace(/\/[a-f0-9]{40,}(?=\/|$)/gi, '/[REDACTED]');
  } catch (_) {
    return '[REDACTED_URL]';
  }
}

function isSensitivePath(value) {
  const path = sanitizedPath(value);
  return /^\/api\/users\/?$/.test(path) ||
    /^\/api\/users\/(?:verify(?:\/resend)?|forgot|reset)(?:\/|$)/.test(path);
}

function sanitizeSentryEvent(event) {
  if (!event || typeof event !== 'object') return event;
  const original = event.request?.url;
  const sensitive = isSensitivePath(original);

  if (event.request && typeof event.request === 'object') {
    if (original) event.request.url = sanitizedPath(original);
    delete event.request.query_string;
    delete event.request.data;
    delete event.request.cookies;
    // Credenziali e dati corpo non devono comparire negli header catturati.
    delete event.request.headers;
  }

  if (typeof event.message === 'string') event.message = redactText(event.message);
  if (event.logentry?.message) {
    event.logentry.message = redactText(event.logentry.message);
  }
  if (Array.isArray(event.exception?.values)) {
    for (const item of event.exception.values) {
      if (typeof item?.value === 'string') item.value = redactText(item.value);
    }
  }

  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => ({
      ...breadcrumb,
      message: redactText(breadcrumb.message),
      // Breadcrumbs possono contenere req.originalUrl, body e credenziali.
      data: undefined,
    }));
  }
  if (sensitive) {
    delete event.extra;
    delete event.contexts;
  }
  return event;
}

module.exports = { redactText, sanitizedPath, isSensitivePath, sanitizeSentryEvent };
