// backend/server.js
// ——————————————————————————————————————————
// GoGoWorld API — server Express per Render
// ——————————————————————————————————————————

const express = require('express');
const path = require('path');
const cors = require('cors');
const connectDB = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// ================== CORS ====================
// Legge gli origin permessi da env CORS_ORIGIN_FRONTEND
// (uno o più URL separati da virgola)
const FRONTEND_ORIGIN = process.env.CORS_ORIGIN_FRONTEND || '';
const allowedOrigins = FRONTEND_ORIGIN
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // richieste interne
    if (allowedOrigins.length === 0) return callback(null, true); // dev: tutti ammessi
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  maxAge: 86400
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
// ===========================================

// Body parser
app.use(express.json());

// Root di servizio
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

// Static files (es. /public)
app.use(express.static(path.join(__dirname, 'public')));

// Rotte applicative — le carichiamo DOPO la connessione al DB
const userRoutes = require('./routes/userRoutes');
const eventRoutes = require('./routes/eventRoutes');

// Avvio AFTER DB
(async () => {
  try {
    await connectDB();
    console.log('✅ Connessione a MongoDB stabilita');
    
    app.use('/api/users', userRoutes);
    app.use('/api/events', eventRoutes);

    app.listen(PORT, () => {
      console.log(`🚀 Server listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Errore di connessione al database:', err?.message || err);
    process.exit(1);
  }
})();











