// backend/src/internal/middleware/internalAuth.js
// Autenticazione tramite header 'x-internal-key'
const { config } = require("../../config");
function internalAuth(req, res, next) {
  const key = req.header('x-internal-key');
if (!key || key !== config.INTERNAL_API_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

module.exports = { internalAuth };
