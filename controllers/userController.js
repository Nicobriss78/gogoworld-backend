// controllers/userController.js — GoGo.World — 2025-08-23
// Implementazioni essenziali e coerenti con le dinamiche concordate.
// - registeredRole: campo statistico dell'utente (persistente)
// - sessionRole: ruolo ATTIVO nella sessione (solo nel JWT), può essere cambiato in ogni momento
// - join/leave: gestiti su utente (lista joinedEvents) per ricostruire stato Partecipante

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/userModel");
const Event = require("../models/eventModel");

// --- Helpers

function signToken(user, sessionRole) {
  const payload = {
    sub: String(user._id),
    email: user.email,
    sessionRole: sessionRole || "participant",
  };
  const opts = { expiresIn: process.env.JWT_EXPIRES_IN || "7d" };
  return jwt.sign(payload, process.env.JWT_SECRET || "dev_secret", opts);
}

function safeUser(u) {
  if (!u) return null;
  return {
    _id: u._id,
    email: u.email,
    name: u.name || "",
    registeredRole: u.registeredRole || "participant",
    joinedEvents: Array.isArray(u.joinedEvents) ? u.joinedEvents : [],
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

function normalizeRole(val) {
  const v = String(val || "").toLowerCase();
  return v === "organizer" ? "organizer" : "participant";
}

// --- Controllers

// POST /api/users/register
exports.register = async (req, res) => {
  try {
    const { email, password, role } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "BAD_REQUEST", message: "Email e password sono obbligatorie." });
    }
    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(409).json({ ok: false, error: "EMAIL_EXISTS", message: "Email già registrata." });
    }
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({
      email,
      passwordHash: hash,
      registeredRole: normalizeRole(role), // statistico
      joinedEvents: [],
    });
    const token = signToken(user, "participant"); // default sessione
    return res.status(201).json({ ok: true, token, user: safeUser(user) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "REGISTER_FAILED", message: err.message });
  }
};

// POST /api/users/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "BAD_REQUEST", message: "Email e password sono obbligatorie." });
    }
    const user = await User.findOne({ email });
    if (!user || !user.passwordHash) {
      return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS", message: "Credenziali non valide." });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS", message: "Credenziali non valide." });
    }
    // Al login non imponiamo un sessionRole: verrà impostato dopo via /session-role
    const token = signToken(user, "participant");
    return res.json({ ok: true, token, user: safeUser(user) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "LOGIN_FAILED", message: err.message });
  }
};

// GET /api/users/me (authRequired)
exports.me = async (req, res) => {
  try {
    const uid = req.user?.sub || req.user?._id || req.user?.id;
    if (!uid) return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token non valido." });
    const user = await User.findById(uid).lean();
    if (!user) return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });

    // joinedEvents può essere una lista di ObjectId. Manteniamo come array di stringhe per semplicità FE.
    const joined = Array.isArray(user.joinedEvents) ? user.joinedEvents.map(String) : [];
    return res.json({ ok: true, ...safeUser(user), joinedEvents: joined });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "ME_FAILED", message: err.message });
  }
};

// POST /api/users/session-role (authRequired)
// Cambia SOLO il ruolo di sessione (nel JWT). Nessun vincolo sul registeredRole.
exports.setSessionRole = async (req, res) => {
  try {
    const uid = req.user?.sub || req.user?._id || req.user?.id;
    if (!uid) return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token non valido." });

    const { role } = req.body || {};
    const sessionRole = normalizeRole(role);

    const user = await User.findById(uid);
    if (!user) return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });

    const token = signToken(user, sessionRole);
    return res.json({ ok: true, token, sessionRole, user: safeUser(user) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "SESSION_ROLE_FAILED", message: err.message });
  }
};

// POST /api/users/join/:eventId (authRequired)
exports.join = async (req, res) => {
  try {
    const uid = req.user?.sub || req.user?._id || req.user?.id;
    if (!uid) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const eventId = req.params.eventId || req.params.id;
    if (!eventId) return res.status(400).json({ ok: false, error: "BAD_REQUEST", message: "eventId mancante" });

    const ev = await Event.findById(eventId).lean();
    if (!ev) return res.status(404).json({ ok: false, error: "EVENT_NOT_FOUND" });

    const user = await User.findById(uid);
    if (!user) return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });

    if (!Array.isArray(user.joinedEvents)) user.joinedEvents = [];
    const already = user.joinedEvents.map(String).includes(String(eventId));
    if (!already) user.joinedEvents.push(eventId);
    await user.save();

    return res.json({ ok: true, joinedEvents: user.joinedEvents.map(String) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "JOIN_FAILED", message: err.message });
  }
};

// POST /api/users/leave/:eventId (authRequired)
exports.leave = async (req, res) => {
  try {
    const uid = req.user?.sub || req.user?._id || req.user?.id;
    if (!uid) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const eventId = req.params.eventId || req.params.id;
    if (!eventId) return res.status(400).json({ ok: false, error: "BAD_REQUEST", message: "eventId mancante" });

    const user = await User.findById(uid);
    if (!user) return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });

    if (!Array.isArray(user.joinedEvents)) user.joinedEvents = [];
    user.joinedEvents = user.joinedEvents.filter(eid => String(eid) !== String(eventId));
    await user.save();

    return res.json({ ok: true, joinedEvents: user.joinedEvents.map(String) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "LEAVE_FAILED", message: err.message });
  }
};

// (Opzionale) POST /api/users/upgrade — conserva una rotta di “upgrade” registrato, senza toccare sessionRole
exports.upgrade = async (req, res) => {
  try {
    const uid = req.user?.sub || req.user?._id || req.user?.id;
    if (!uid) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const { registeredRole } = req.body || {};
    const newRole = normalizeRole(registeredRole);
    const user = await User.findByIdAndUpdate(uid, { registeredRole: newRole }, { new: true });
    if (!user) return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });
    return res.json({ ok: true, user: safeUser(user) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "UPGRADE_FAILED", message: err.message });
  }
};




