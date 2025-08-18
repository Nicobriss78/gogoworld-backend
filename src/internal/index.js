// src/internal/index.js
// Router principale /internal
const express = require('express');
const router = express.Router();

const { internalAuth } = require('./middleware/internalAuth');
const { withIdempotency } = require('./middleware/idempotency');
const { auditLog } = require('./middleware/auditLog');

// Healthcheck
router.get('/health', (req, res) => {
  res.status(200).json({ ok: true, service: 'internal', time: new Date().toISOString() });
});

// Events internal endpoints
router.use('/events', internalAuth, withIdempotency, auditLog, require('./routes/events.internal'));

// TODO: in futuro: moderation, sync, ecc.

module.exports = router;
