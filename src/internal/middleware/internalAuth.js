// backend/src/internal/middleware/internalAuth.js
// Autenticazione tramite header 'x-internal-key'
function internalAuth(req, res, next) {
  const key = req.header('x-internal-key');
  if (!key || key !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

module.exports = { internalAuth };
