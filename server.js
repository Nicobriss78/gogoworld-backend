// backend/server.js
// ——————————————————————————————————————————
// GoGoWorld API — server Express per Render
// ——————————————————————————————————————————

const express = require('express');
const path = require('path');
const cors = require('cors');
const connectDB = require('./db');

const app = express();
const PORT = process.env.PORT || 10000; // default consigliato per Render

// Hardening leggero
app.disable('x-powered-by');


const corsMiddleware = require('./middleware/cors');
app.use(corsMiddleware);
app.options('*', corsMiddleware); // preflight

// Body parser
app.use(express.json());

// Root di servizio (utile per verifiche veloci)
app.get('/', (_req, res) => {
  res.json({ ok: true, name: 'GoGoWorld API', env: process.env.NODE_ENV || 'production' });
});

// Healthcheck
app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

// Info versione
app.get('/version', (_req, res) => {
  res.json({ version: '1.0.0', ts: new Date().toISOString() });
});

// Static (se ti serve servire /public dal backend)
app.use(express.static(path.join(__dirname, 'public')));

// Rotte applicative
const userRoutes = require('./routes/userRoutes');
app.use('/api/users', userRoutes);

const eventRoutes = require('./routes/eventRoutes');
app.use('/api/events', eventRoutes);

// Avvio AFTER DB
(async () => {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`🚀 Server listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Startup aborted:', err?.message || err);
    process.exit(1);
  }
})();









