// backend/server.js
// GoGoWorld API – server Express per Render

const express = require('express');
const cors = require('cors');
const connectDB = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

/* ======================= CORS =======================

   - Legge gli origin ammessi da CORS_ORIGIN_FRONTEND (separati da virgola)
   - Confronto “normalizzato” senza slash finale

   Su Render imposta ad es.:
   CORS_ORIGIN_FRONTEND = https://playful-blini-646b72.netlify.app,http://localhost:3000
*/
const FRONTEND_ORIGINS = (process.env.CORS_ORIGIN_FRONTEND || '')
  .split(',')
  .map(s => s.trim().replace(/\/$/, '')) // rimuove slash finale
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true; // richieste senza Origin
  const o = origin.replace(/\/$/, '');
  if (FRONTEND_ORIGINS.length === 0) return true; // fallback permissivo in dev
  if (FRONTEND_ORIGINS.includes(o)) return true;
  // opzionale: consenti tutti i sottodomini *.netlify.app se ne hai uno in lista
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
   Monta il namespace /internal solo se abilitato da feature flag.
   Nota: server.js è in gogoworld-backend-main/, mentre src/ è un livello sopra → usa path ../src/...
*/
try {
  const { isEnabled } = require('../src/config/flags');
  if (isEnabled('internal.enabled')) {
    app.use('/internal', require('../src/internal'));
    console.log('[/internal] namespace abilitato');
  } else {
    console.log('[/internal] namespace disabilitato via feature flag');
  }
} catch (e) {
  console.warn('[/internal] non montato (flags/config mancanti o path differente):', e.message);
}

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
















