// src/internal/middleware/internalAuth.js
// Semplice autenticazione tramite header 'x-internal-key'
function internalAuth(req, res, next) {
  const key = req.header('x-internal-key');
  if (!key || key !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  // opzionale: req.internalUser = 'onira';
  next();
}

module.exports = { internalAuth };
