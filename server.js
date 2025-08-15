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

// ==================== CORS (prima di QUALSIASI rotta) ====================
const cors = require('cors');

const FRONTEND_ORIGIN =
  process.env.CORS_ORIGIN_FRONTEND || 'http://localhost:5173';

const allowedOrigins = [FRONTEND_ORIGIN, 'http://localhost:3000', 'http://localhost:5173'];

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // consenti richieste senza Origin (Postman, healthz, ecc.)
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  maxAge: 86400
}));

// Risposta esplicita ai preflight (alcuni proxy la richiedono)
app.options('*', cors({
  origin: FRONTEND_ORIGIN,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
}));
// ========================================================================
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












