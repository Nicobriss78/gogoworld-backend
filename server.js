// backend/gogoworld-backend-main/server.js
// GoGoWorld API – server Express per Render

const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

/* ======================= CORS =======================
   Su Render imposta ad es.:
   CORS_ORIGIN_FRONTEND = https://<tuo-netlify>.netlify.app,http://localhost:3000
*/
const FRONTEND_ORIGINS = (process.env.CORS_ORIGIN_FRONTEND || '')
  .split(',')
  .map(s => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true; // richieste senza Origin
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
   Monta /internal via feature flag con path ASSOLUTI (niente require relativi fragili).
   Struttura attesa:
   - questo file: backend/gogoworld-backend-main/server.js
   - flags: backend/src/config/featureFlags.json (+ flags.js)
   - router: backend/src/internal/index.js
*/
(() => {
  try {
    const flagsPath = path.resolve(__dirname, '..', 'src', 'config', 'flags.js');
    const internalRouterPath = path.resolve(__dirname, '..', 'src', 'internal');

    const { isEnabled } = require(flagsPath);
    const internalEnabled = isEnabled('internal.enabled');

    console.log(`[/internal] flagsPath=${flagsPath}`);
    console.log(`[/internal] routerPath=${internalRouterPath}`);
    console.log(`[/internal] featureFlags.internal.enabled=${internalEnabled}`);

    if (internalEnabled) {
      app.use('/internal', require(internalRouterPath));
      console.log('[/internal] namespace MONTATO');
    } else {
      console.log('[/internal] namespace NON montato (feature flag false)');
    }
  } catch (e) {
    console.warn('[/internal] NON montato (errore nel caricamento di flags/router):', e.message);
    console.warn('Suggerimenti: verificare che backend/src/* sia stato committato e deployato su Render.');
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

















