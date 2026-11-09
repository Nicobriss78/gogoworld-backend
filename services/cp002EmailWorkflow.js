'use strict';

// CP002-B: orchestrazione email per verifica e recupero.
// Disabled-by-default finche' il FE e il cutover sono esplicitamente pronti.
// Nessuna chiamata al provider viene effettuata al solo require() del modulo.
const crypto = require('crypto');
const { deliveryReadiness, sendTransactionalEmail } = require('./cp002TransactionalEmail');
const {
  boundedIssuanceEnabled, issueBoundedToken, revokeBoundedToken,
} = require('./cp002TokenStore');

const TASKS = Object.freeze({
  verify: Object.freeze({ path: '/pages/verify.html', subject: 'GoGoWorld - Verifica email' }),
  reset: Object.freeze({ path: '/reset.html', subject: 'GoGoWorld - Recupero password' }),
});

function frontendOrigin() {
  const value = process.env.CP002_PUBLIC_FRONTEND_BASE ||
    process.env.FRONTEND_URL || process.env.BASE_URL || '';
  try {
    const parsed = new URL(value);
    if (!parsed.username && !parsed.password && !parsed.search && !parsed.hash &&
        (parsed.protocol === 'https:' ||
          (process.env.NODE_ENV === 'test' &&
           parsed.protocol === 'http:' &&
           ['localhost', '127.0.0.1'].includes(parsed.hostname)))) {
      return parsed.origin;
    }
  } catch (_) {
    // L'URL pubblico deve essere verificato, mai derivato dagli header HTTP.
  }
  return null;
}

function workflowReadiness() {
  if (process.env.CP002_FRONTEND_FLOW_READY !== '1') {
    return { ready: false, reason: 'frontend_not_authorized' };
  }
  if (!boundedIssuanceEnabled()) {
    return { ready: false, reason: 'token_cutover_not_authorized' };
  }
  const delivery = deliveryReadiness();
  if (!delivery.ready) return { ready: false, reason: 'delivery_not_available' };
  if (!frontendOrigin()) return { ready: false, reason: 'invalid_frontend_origin' };
  return { ready: true };
}

function unavailable(res) {
  res.set('Cache-Control', 'no-store');
  res.set('Retry-After', '60');
  return res.status(503).json({
    ok: false,
    code: 'TEMPORARILY_UNAVAILABLE',
    error: 'temporarily_unavailable',
  });
}

// Il consumer reset atomico con barriera R-A persistente NON esiste ancora.
// Non emettere link reset inutilizzabili, anche se qualcuno abilita i flag
// del provider o del frontend prima del gate R-A.
function purposeIssuanceReadiness(purpose) {
  if (!TASKS[purpose]) return { ready: false, reason: 'unknown_purpose' };
  if (purpose === 'reset') {
    return { ready: false, reason: 'atomic_reset_consumer_not_ready' };
  }
  return workflowReadiness();
}

function requireIssueReadiness(req, res, purpose = 'verify') {
  if (req.cp002EmissionAuthorized !== true ||
      !purposeIssuanceReadiness(purpose).ready) {
    unavailable(res);
    return false;
  }
  return true;
}

function publicLink(purpose, raw) {
  const task = TASKS[purpose];
  const origin = frontendOrigin();
  if (!task || !origin || !/^[a-f0-9]{64}$/.test(raw)) return null;
  // Il fragment non e' inviato al web server nelle normali richieste HTTP.
  // Il FE dovra' estrarlo, ripulire l'URL e chiamare un endpoint POST.
  return origin + task.path + '#token=' + encodeURIComponent(raw);
}

/**
 * Il provider puo' accettare senza recapitare. Non promettere mai delivery.
 * Nessuna ripetizione automatica in caso di timeout/esito incerto.
 * Rifiuto certo: revoca solo il token emesso da questa richiesta.
 */
async function sendPurposeLink({ user, purpose, guardAuthorized }) {
  if (!user || !TASKS[purpose] || guardAuthorized !== true ||
      !purposeIssuanceReadiness(purpose).ready) {
    return { state: 'not_ready' };
  }
  let issue = null;
  try {
    issue = await issueBoundedToken({
      userId: user._id,
      purpose,
      guardAuthorized: true,
    });
    if (!issue.ok) return { state: 'not_issued' };

    const link = publicLink(purpose, issue.raw);
    if (!link) return { state: 'not_issued' };

    const text = purpose === 'verify'
      ? 'Per verificare il tuo indirizzo email apri questo link: ' + link
      : 'Per recuperare la password apri questo link: ' + link;
    const result = await sendTransactionalEmail({
      to: user.email,
      subject: TASKS[purpose].subject,
      text,
      // Usa una chiave univoca per la stessa emissione, senza PII.
      idempotencyKey: crypto.createHash('sha256')
        .update('CP002:' + purpose + ':' + issue.hash).digest('hex'),
    });

    if (result.state === 'rejected') {
      try {
        await revokeBoundedToken(user._id, purpose, issue.hash);
      } catch (_) {
        // La possibile revoca incompleta non implica che la mail sia stata inviata.
      }
    }

    return { state: result.state === 'accepted' ? 'accepted' : 'pending' };
  } catch (_) {
    // Nessun indirizzo, link, token o stack nell'esito.
    // Se la scrittura e' riuscita, una consegna potrebbe ancora essere pendente.
    return { state: 'pending' };
  }
}

module.exports = {
  workflowReadiness,
  requireIssueReadiness,
  sendPurposeLink,
};
