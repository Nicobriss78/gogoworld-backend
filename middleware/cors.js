// backend/middleware/cors.js

// Legge gli origin permessi da env CORS_ORIGIN_FRONTEND
// Esempio: https://playful-blini-646b72.netlify.app, https://www.tuodominio.it
const FRONTEND_ORIGIN = process.env.CORS_ORIGIN_FRONTEND || '';
const allowedOrigins = FRONTEND_ORIGIN
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const cors = require('cors');

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // richieste server-to-server o curl
    if (allowedOrigins.length === 0) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  maxAge: 86400
};

module.exports = cors(corsOptions);
