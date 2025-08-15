// backend/controllers/userController.js
// Controller utenti – versione MongoDB + JWT
// Mantiene le stesse rotte attuali e la UX di cambio ruolo senza riloggare.

const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const Event = require('../models/eventModel');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-change-me';

// firma un JWT con id e ruolo corrente
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

// ========== LISTA UTENTI (DEBUG/UTILITY) ==========
// GET /api/users (protetta nelle routes: organizer)
exports.list = async (_req, res) => {
  try {
    const users = await User.find().select('name email role currentRole createdAt updatedAt');
    return res.json(users);
  } catch (err) {
    console.error('users.list error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ========== DETTAGLIO UTENTE ==========
// GET /api/users/:id (protetta nelle routes: auth)
exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    const u = await User.findById(id).select('-password');
    if (!u) return res.status(404).json({ error: 'User not found' });
    return res.json(u);
  } catch (err) {
    console.error('users.getById error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ========== REGISTRAZIONE ==========
// POST /api/users/register (pubblica)
exports.register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ error: 'Email already registered' });

    const baseRole = role === 'organizer' ? 'organizer' : 'participant';
    const user = await User.create({
      name,
      email,
      password, // TODO: hash/bcrypt nella fase avanzata
      role: baseRole,
      currentRole: baseRole
    });

    // opzionalmente puoi emettere subito un token al register; ora rispondiamo semplice
    return res.status(201).json({
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.currentRole
    });
  } catch (err) {
    console.error('users.register error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ========== LOGIN ==========
// POST /api/users/login (pubblica)
exports.login = async (req, res) => {
  try {
    const { email, password } = (req.body || {});
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    // NB: in questa fase confrontiamo in chiaro (come nei tuoi JSON originali)
    const u = await User.findOne({ email, password });
    if (!u) return res.status(401).json({ error: 'Invalid credentials' });

    const role = u.currentRole || u.role || 'participant';
    const token = signToken({ id: u._id.toString(), role });

    return res.json({
      id: u._id,
      name: u.name,
      email: u.email,
      role,
      token
    });
  } catch (err) {
    console.error('users.login error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ========== CAMBIO RUOLO ATTIVO (senza riloggare) ==========
// PUT /api/users/:id/role (protetta nelle routes: auth)
exports.switchRole = async (req, res) => {
  try {
    const { id } = req.params;
    let { role } = req.body || {};

    // accettiamo sia newRole che role (compat con codice esistente)
    role = role || req.body?.newRole;

    const allowed = ['organizer', 'participant'];
    if (!allowed.includes(role)) {
      return res.status(400).json({ error: 'Ruolo non valido' });
    }

    // sicurezza: l’utente può cambiare SOLO il proprio ruolo
    if (String(req.user.id) !== String(id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const u = await User.findByIdAndUpdate(
      id,
      { currentRole: role },
      { new: true }
    );

    if (!u) return res.status(404).json({ error: 'User not found' });

    // emetti nuovo token con ruolo aggiornato
    const token = signToken({ id: u._id.toString(), role: u.currentRole });

    return res.json({
      token,
      role: u.currentRole
    });
  } catch (err) {
    console.error('users.switchRole error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ========== PARTECIPAZIONE EVENTO ==========
// POST /api/users/:id/partecipa (protetta: auth + roleRequired('participant') nelle routes)
exports.partecipa = async (req, res) => {
  try {
    const { id } = req.params; // userId
    const { eventId } = req.body || {};

    if (!eventId) return res.status(400).json({ error: 'Missing eventId' });
    if (String(req.user.id) !== String(id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const ev = await Event.findByIdAndUpdate(
      eventId,
      { $addToSet: { participants: id } },
      { new: true }
    );
    if (!ev) return res.status(404).json({ error: 'Event not found' });

    return res.json({ ok: true });
  } catch (err) {
    console.error('users.partecipa error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ========== ANNULLA PARTECIPAZIONE ==========
// POST /api/users/:id/annulla (protetta: auth + roleRequired('participant') nelle routes)
exports.annulla = async (req, res) => {
  try {
    const { id } = req.params; // userId
    const { eventId } = req.body || {};

    if (!eventId) return res.status(400).json({ error: 'Missing eventId' });
    if (String(req.user.id) !== String(id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const ev = await Event.findByIdAndUpdate(
      eventId,
      { $pull: { participants: id } },
      { new: true }
    );
    if (!ev) return res.status(404).json({ error: 'Event not found' });

    return res.json({ ok: true });
  } catch (err) {
    console.error('users.annulla error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
