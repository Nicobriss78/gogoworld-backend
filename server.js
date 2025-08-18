// backend/server.js
// GoGoWorld API – server Express

const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

/* ======================= CORS ======================= */
const FRONTEND_ORIGINS = (process.env.CORS_ORIGIN_FRONTEND || '')
  .split(',')
  .map(s => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  const o = origin.replace(/\/$/, '');
  if (FRONTEND_ORIGINS.length === 0) return true;
  if (FRONTEND_ORIGINS.includes(o)) return true;
  if (FRONTEND_ORIGINS.some(a => a.endsWith('.netlify.app')) && o.endsWith('.netlify.app')) return true;
  return false;
}

const corsOptions = {
  origin(origin, cb) {
    if (isAllowedOrigin(origin)) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/* =================== Parsers & Logs ================= */
app.use(express.json());

/* ================== Internal Namespace =================
   Struttura certa:
   - questo file: backend/server.js
   - flags: backend/src/config/flags.js
   - router /internal: backend/src/internal/index.js

   Override via ENV:
   - INTERNAL_ENABLED="true" -> forza ON
   - INTERNAL_ENABLED="false" -> forza OFF
   - unset/null -> usa featureFlags.json
*/
(() => {
  try {
    const flagsPath = path.resolve(__dirname, 'src', 'config', 'flags.js');
    const routerPath = path.resolve(__dirname, 'src', 'internal');

    const { isEnabled } = require(flagsPath);

    const envOverride = process.env.INTERNAL_ENABLED;
    let enabled;
    if (envOverride === 'true') {
      enabled = true;
      console.log('[/internal] override ENV: INTERNAL_ENABLED=true -> FORZATO ON');
    } else if (envOverride === 'false') {
      enabled = false;
      console.log('[/internal] override ENV: INTERNAL_ENABLED=false -> FORZATO OFF');
    } else {
      enabled = isEnabled('internal.enabled');
      console.log('[/internal] featureFlags.internal.enabled =', enabled);
    }

    if (enabled) {
      app.use('/internal', require(routerPath));
      console.log('[/internal] namespace MONTATO');
    } else {
      console.log('[/internal] namespace NON montato');
    }
  } catch (e) {
    console.warn('[/internal] NON montato:', e.message);
    console.warn('Verifica che backend/src/config/* e backend/src/internal/* esistano nel deploy.');
  }
})();

/* ======================= Routes ===================== */
app.get('/', (_req, res) => {
  res.json({ ok: true, name: 'GoGoWorld API', env: process.env.NODE_ENV || 'dev' });
});

app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));

app.get('/version', (_req, res) => {
  res.json({ version: '1.0.0', ts: new Date().toISOString() });
});

// API
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/events', require('./routes/eventRoutes'));
app.use('/welcome', require('./routes/welcome'));

/* ==================== Avvio server ================== */
connectDB()
  .then(() => {
    console.log('MongoDB connected');
    app.listen(PORT, () => {
      console.log(`🚀 Server listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Errore connessione MongoDB:', err);
    process.exit(1);
  });

module.exports = app;




















