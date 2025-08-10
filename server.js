const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 5050;

// ✅ Middleware per gestire req.body (fondamentale per /register e /partecipa)
app.use(express.json());

// Healthcheck
app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

// ✅ Serve i file statici dal frontend
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Rotte utenti
const userRoutes = require('./routes/userRoutes');
app.use('/api/users', userRoutes);

// ✅ Rotte eventi (❗mancava questa parte)
const eventRoutes = require('./routes/eventRoutes');
app.use('/api/events', eventRoutes);

// ✅ Avvia il server
app.listen(PORT, () => {
  console.log(`✅ Server avviato su http://localhost:${PORT}`);
});

