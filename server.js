// backend/server.js
// GoGoWorld API – server Express per Render

const express = require('express');
const path = require('path');
const cors = require('cors');
const connectDB = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

/* ======================= CORS =======================

   - Legge gli origin ammessi da CORS_ORIGIN_FRONTEND (separati da virgola)
   - Confronto “normalizzato” senza slash finale
   - Consente anche le richieste senza header Origin (curl, server-to-server)
   - Espone metodi/headers che usiamo (incl. Authorization)

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

app.use(cors(corsOptions)); // CORS prima di QUALSIASI rotta
app.options('*', cors(corsOptions)); // preflight

/* ==================== Middlewares =================== */
app.use(express.json());

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

/* ==================== Avvio server ================== */
connectDB()
  .then(() => {
    console.log('MongoDB connected');
    console.log('Connessione a MongoDB stabilita');
    app.listen(PORT, () => {
      console.log(`🚀 Server listening on http://localhost:${PORT}`);
      console.log('✨ Your service is live');
    });
  })
  .catch((err) => {
    console.error('Errore connessione MongoDB:', err);
    process.exit(1);
  });

module.exports = app;














