// controllers/userController.js — GoGo.World — 2025-08-24
// Registrazione con 'name', login con migrazione legacy (password -> passwordHash),
// session-role nel JWT, join/leave persistenti su joinedEvents.

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
    registeredRole: u.registeredRole || u.role || "participant",
    joinedEvents: Array.isArray(u.joinedEvents)
      ? u.joinedEvents.map(String)
      : [],
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
    const {
      name,
      email,
      password,
      role, // statistico (registeredRole)
    } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({
        ok: false,
        error: "BAD_REQUEST",
        message: "Nome, email e password sono obbligatori.",
      });
    }

    const exists = await User.findOne({ email: String(email).toLowerCase() });
    if (exists) {
      return res.status(409).json({
        ok: false,
        error: "EMAIL_EXISTS",
        message: "Email già registrata.",
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const user = await User.create({
      name: String(name).trim(),
      email: String(email).toLowerCase().trim(),
      passwordHash: hash,
      // per compat lasciamo 'password' vuota: lo standard è passwordHash
      password: "",
      registeredRole: normalizeRole(role),
      role: normalizeRole(role), // legacy alias
      joinedEvents: [],
    });

    const token = signToken(user, "participant"); // default sessione
    return res.status(201).json({ ok: true, token, user: safeUser(user) });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: "REGISTER_FAILED", message: err.message });
  }
};

// POST /api/users/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res
        .status(400)
        .json({ ok: false, error: "BAD_REQUEST", message: "Email e password sono obbligatorie." });
    }

    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user) {
      return res
        .status(401)
        .json({ ok: false, error: "INVALID_CREDENTIALS", message: "Credenziali non valide." });
    }

    // 1) Se esiste passwordHash -> bcrypt.compare
    if (user.passwordHash) {
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        return res
          .status(401)
          .json({ ok: false, error: "INVALID_CREDENTIALS", message: "Credenziali non valide." });
      }
      const token = signToken(user, "participant");
      return res.json({ ok: true, token, user: safeUser(user) });
    }

    // 2) Migrazione legacy: se esiste 'password' (plain) e coincide, migra a passwordHash
    if (user.password) {
      const plainMatches = password === user.password;
      if (!plainMatches) {
        return res
          .status(401)
          .json({ ok: false, error: "INVALID_CREDENTIALS", message: "Credenziali non valide." });
      }
      // migrazione
      user.passwordHash = await bcrypt.hash(password, 10);
      user.password = "";
      await user.save();

      const token = signToken(user, "participant");
      return res.json({ ok: true, token, user: safeUser(user) });
    }

    // 3) Nessun hash e nessuna password legacy → non possiamo validare
    return res
      .status(401)
      .json({ ok: false, error: "INVALID_CREDENTIALS", message: "Credenziali non valide." });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: "LOGIN_FAILED", message: err.message });
  }
};

// GET /api/users/me (authRequired)
exports.me = async (req, res) => {
  try {
    const uid = req.user?.sub || req.user?._id || req.user?.id;
    if (!uid)
      return res
        .status(401)
        .json({ ok: false, error: "UNAUTHORIZED", message: "Token non valido." });

    const user = await User.findById(uid).lean();
    if (!user) return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });

    const joined = Array.isArray(user.joinedEvents)
      ? user.joinedEvents.map(String)
      : [];
    return res.json({ ok: true, ...safeUser(user), joinedEvents: joined });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: "ME_FAILED", message: err.message });
  }
};

// POST /api/users/session-role (authRequired)
exports.setSessionRole = async (req, res) => {
  try {
    const uid = req.user?.sub || req.user?._id || req.user?.id;
    if (!uid)
      return res
        .status(401)
        .json({ ok: false, error: "UNAUTHORIZED", message: "Token non valido." });

    const { role } = req.body || {};
    const sessionRole = normalizeRole(role);

    const user = await User.findById(uid);
    if (!user) return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });

    const token = signToken(user, sessionRole);
    return res.json({ ok: true, token, sessionRole, user: safeUser(user) });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: "SESSION_ROLE_FAILED", message: err.message });
  }
};

// POST /api/users/join/:eventId (authRequired)
exports.join = async (req, res) => {
  try {
    const uid = req.user?.sub || req.user?._id || req.user?.id;
    if (!uid) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const eventId = req.params.eventId || req.params.id;
    if (!eventId)
      return res
        .status(400)
        .json({ ok: false, error: "BAD_REQUEST", message: "eventId mancante" });

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
    return res
      .status(500)
      .json({ ok: false, error: "JOIN_FAILED", message: err.message });
  }
};

// POST /api/users/leave/:eventId (authRequired)
exports.leave = async (req, res) => {
  try {
    const uid = req.user?.sub || req.user?._id || req.user?.id;
    if (!uid) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const eventId = req.params.eventId || req.params.id;
    if (!eventId)
      return res
        .status(400)
        .json({ ok: false, error: "BAD_REQUEST", message: "eventId mancante" });

    const user = await User.findById(uid);
    if (!user) return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });

    if (!Array.isArray(user.joinedEvents)) user.joinedEvents = [];
    user.joinedEvents = user.joinedEvents.filter((eid) => String(eid) !== String(eventId));
    await user.save();

    return res.json({ ok: true, joinedEvents: user.joinedEvents.map(String) });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: "LEAVE_FAILED", message: err.message });
  }
};

// (Opzionale) POST /api/users/upgrade — aggiorna ruolo registrato (statistico)
exports.upgrade = async (req, res) => {
  try {
    const uid = req.user?.sub || req.user?._id || req.user?.id;
    if (!uid) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const { registeredRole } = req.body || {};
    const newRole = normalizeRole(registeredRole);

    const user = await User.findByIdAndUpdate(
      uid,
      { registeredRole: newRole, role: newRole },
      { new: true }
    );
    if (!user) return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });

    return res.json({ ok: true, user: safeUser(user) });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: "UPGRADE_FAILED", message: err.message });
  }
};





