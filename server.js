// backend/server.js
const express = require('express');
const path = require('path');
const cors = require('cors');
const connectDB = require('./db');

const app = express();
const PORT = process.env.PORT || 10000; // default 10000 per Render
const app = express();
const PORT = process.env.PORT || 10000; // default per Render

// === CORS per consentire il tuo frontend Netlify ===
const cors = require('cors');

const FRONTEND_ORIGIN = process.env.CORS_ORIGIN_FRONTEND || '';
const allowedOrigins = FRONTEND_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'), false);
  },
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  maxAge: 86400
}));

app.options('*', cors()); // preflight
// ================================================


// CORS: consenti il tuo frontend Netlify
app.use(cors({
  origin: process.env.CORS_ORIGIN_FRONTEND || '*',
  credentials: false
}));

// Body parser
app.use(express.json());

// Ping root
app.get('/', (_req, res) => {
  res.json({ ok: true, name: 'GoGoWorld API', env: process.env.NODE_ENV || 'dev' });
});

// Healthcheck
app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

// Info versione
app.get('/version', (_req, res) => {
  res.json({ version: '1.0.0', ts: new Date().toISOString() });
});

// Static (se ti serve servire /public)
app.use(express.static(path.join(__dirname, 'public')));

// Rotte
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
    console.error('❌ Startup aborted:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();





