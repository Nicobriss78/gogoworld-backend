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

// ================== CORS ====================
// Legge gli origin permessi da env CORS_ORIGIN_FRONTEND
// (può essere uno o più URL separati da virgola)
// Esempio: https://playful-blini-646b72.netlify.app, https://www.tuodominio.it
const FRONTEND_ORIGIN = process.env.CORS_ORIGIN_FRONTEND || '';
const allowedOrigins = FRONTEND_ORIGIN
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Se la whitelist è vuota, consenti tutti (utile in dev)
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // richieste server-to-server o curl
    if (allowedOrigins.length === 0) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  maxAge: 86400
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // preflight
// ===========================================

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







