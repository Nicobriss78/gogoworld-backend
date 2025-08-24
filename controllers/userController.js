// controllers/userController.js — gestione utenti (versione allineata)
//
// Correzioni:
// - joinEvent/leaveEvent: confronto id robusto per evitare duplicati
// - resto invariato

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const Event = require("../models/eventModel");

// Helper: genera token
function generateToken(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

// @desc Registrazione
// @route POST /api/users/register
async function register(req, res) {
  try {
    const { name, email, password, role } = req.body;
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
    }
    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(400).json({ ok: false, error: "USER_EXISTS" });
    }
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: name || null,
      email,
      password: hashed,
      role: role || "participant", // statistico
    });
    return res.status(201).json({
      ok: true,
      user: { id: user._id, email: user.email },
      token: generateToken(user._id),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: "REGISTER_FAILED", message: err.message });
  }
}

// @desc Login
// @route POST /api/users/login
async function login(req, res) {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS" });

    res.json({
      ok: true,
      user: { id: user._id, email: user.email },
      token: generateToken(user._id),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: "LOGIN_FAILED", message: err.message });
  }
}

// @desc Get utente corrente
// @route GET /api/users/me
async function getMe(req, res) {
  try {
    if (!req.user) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const user = await User.findById(req.user.id).select("-password");
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ ok: false, error: "ME_FAILED", message: err.message });
  }
}

// @desc Ruolo di sessione (eco al FE)
// @route POST /api/users/session-role
function setSessionRole(req, res) {
  const { role } = req.body;
  res.json({ ok: true, role: role || null });
}

// @desc Join evento (alias lato utente)
// @route POST /api/users/join/:eventId
async function joinEvent(req, res) {
  try {
    const eventId = req.params.eventId;
    const ev = await Event.findById(eventId);
    if (!ev) return res.status(404).json({ ok: false, error: "EVENT_NOT_FOUND" });

    const myId = String(req.user.id);
    const already = ev.participants.some((pid) => String(pid) === myId);
    if (!already) {
      ev.participants.push(req.user.id);
      await ev.save();
    }
    res.json({ ok: true, joined: true, eventId });
  } catch (err) {
    res.status(500).json({ ok: false, error: "JOIN_FAILED", message: err.message });
  }
}

// @desc Leave evento (alias lato utente)
// @route POST /api/users/leave/:eventId
async function leaveEvent(req, res) {
  try {
    const eventId = req.params.eventId;
    const ev = await Event.findById(eventId);
    if (!ev) return res.status(404).json({ ok: false, error: "EVENT_NOT_FOUND" });

    const myId = String(req.user.id);
    ev.participants = ev.participants.filter((pid) => String(pid) !== myId);
    await ev.save();

    res.json({ ok: true, joined: false, eventId });
  } catch (err) {
    res.status(500).json({ ok: false, error: "LEAVE_FAILED", message: err.message });
  }
}

module.exports = {
  register,
  login,
  getMe,
  setSessionRole,
  joinEvent,
  leaveEvent,
};

