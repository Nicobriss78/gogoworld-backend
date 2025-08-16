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
// GET /api/users (protetta: organizer)
exports.list = async (_req, res) => {
  try {
    const users = await User.find({}, { password: 0 }).sort({ createdAt: -1 });
    return res.json(users);
  } catch (err) {
    console.error('users.list error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ========== GET BY ID ==========
// GET /api/users/:id (protetta: auth)
exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    if (String(req.user.id) !== String(id)) {
      // facoltativo: solo organizer può leggere altri
      // per ora, se non è lui, rifiuta
      return res.status(403).json({ error: 'Forbidden' });
    }
    const user = await User.findById(id, { password: 0 });
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json(user);
  } catch (err) {
    console.error('users.getById error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ========== REGISTRAZIONE ==========
// POST /api/users/register (pubblica)
exports.register = async (req, res) => {
  try {
    const { name, email, password, role } = (req.body || {});
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields (name, email, password)' });
    }
    const baseRole = role && ['participant', 'organizer'].includes(role) ? role : 'participant';

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const user = await User.create({
      name,
      email,
      password, // TODO: hash/bcrypt nella fase avanzata
      role: baseRole,
      currentRole: baseRole
    });

    // risposta semplice (senza token). Il FE deciderà se auto-login successivo.
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

    const token = signToken({ id: String(u._id), role: u.currentRole });
    return res.json({
      token,
      id: u._id,
      name: u.name,
      role: u.currentRole
    });
  } catch (err) {
    console.error('users.login error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ========== CAMBIO RUOLO ==========
// PUT /api/users/:id/role (protetta: auth)
exports.switchRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = (req.body || {});
    if (!role || !['participant', 'organizer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    if (String(req.user.id) !== String(id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const updated = await User.findByIdAndUpdate(
      id,
      { currentRole: role },
      { new: true, projection: { password: 0 } }
    );
    if (!updated) return res.status(404).json({ error: 'User not found' });

    // emettiamo un nuovo token con il ruolo aggiornato
    const token = signToken({ id: String(updated._id), role: updated.currentRole });

    return res.json({
      id: updated._id,
      name: updated.name,
      role: updated.currentRole,
      token
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

