// controllers/userController.js — completo
// Coerenza con le dinamiche attese:
// - Login/Register → ritorna { token, userId, registeredRole, sessionRole }
// - Upgrade → passa registeredRole=organizer e sessionRole=organizer, ritorna nuovo token
// - setSessionRole → accetta body vuoto o { sessionRole } / { role } e ritorna sempre { registeredRole, sessionRole, token }
// - join/leave → gestisce partecipazione evento (usato anche da /api/events/:id/join|leave)

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Event = require("../models/Event");

const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_SECRET";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

// -------------------------------------
// helpers
// -------------------------------------
function pickSafeUser(u) {
  return {
    id: String(u._id),
    email: u.email,
    name: u.name || "",
    registeredRole: u.registeredRole || "participant",
  };
}

function signToken(userDoc, sessionRole) {
  const payload = {
    uid: String(userDoc._id),
    registeredRole: userDoc.registeredRole || "participant",
    sessionRole: sessionRole || userDoc.registeredRole || "participant",
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function getSessionRoleFromReq(req) {
  // authRequired dovrebbe aver popolato req.user dal JWT
  // fallback: participant
  return (req.user && req.user.sessionRole) || (req.user && req.user.registeredRole) || "participant";
}

// Normalizza eventuali alias dal body
function normalizeSessionRoleBody(body = {}) {
  if (!body) return {};
  const out = { ...body };
  if (!out.sessionRole && out.role) out.sessionRole = out.role;
  if (out.sessionRole !== "organizer" && out.sessionRole !== "participant") {
    delete out.sessionRole;
  }
  return out;
}

// -------------------------------------
// Auth
// -------------------------------------
exports.register = async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "EMAIL_PASSWORD_REQUIRED" });

    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(409).json({ error: "EMAIL_ALREADY_REGISTERED" });

    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({
      email: email.toLowerCase(),
      passwordHash: hash,
      name: name || "",
      // Ruolo registrato: di default participant (il ruolo scelto in registrazione è solo statistico)
      registeredRole: "participant",
    });

    const sessionRole = "participant";
    const token = signToken(user, sessionRole);
    return res.status(201).json({
      token,
      userId: String(user._id),
      registeredRole: user.registeredRole,
      sessionRole,
      user: pickSafeUser(user),
    });
  } catch (err) {
    return res.status(500).json({ error: "REGISTER_FAILED", message: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "EMAIL_PASSWORD_REQUIRED" });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ error: "INVALID_CREDENTIALS" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "INVALID_CREDENTIALS" });

    // sessionRole iniziale = registeredRole (dinamiche attese)
    const sessionRole = user.registeredRole || "participant";
    const token = signToken(user, sessionRole);

    return res.json({
      token,
      userId: String(user._id),
      registeredRole: user.registeredRole || "participant",
      sessionRole,
      user: pickSafeUser(user),
    });
  } catch (err) {
    return res.status(500).json({ error: "LOGIN_FAILED", message: err.message });
  }
};

exports.me = async (req, res) => {
  try {
    const user = await User.findById(req.user.uid || req.user._id);
    if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });
    return res.json({
      user: pickSafeUser(user),
      sessionRole: getSessionRoleFromReq(req),
      registeredRole: user.registeredRole || "participant",
    });
  } catch (err) {
    return res.status(500).json({ error: "ME_FAILED", message: err.message });
  }
};

// -------------------------------------
// Upgrade: registeredRole → organizer
// (e sessionRole allineato ad organizer)
// -------------------------------------
exports.upgrade = async (req, res) => {
  try {
    const uid = req.user.uid || req.user._id;
    const user = await User.findById(uid);
    if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });

    if (user.registeredRole !== "organizer") {
      user.registeredRole = "organizer";
      await user.save();
    }

    const sessionRole = "organizer";
    const token = signToken(user, sessionRole);

    return res.json({
      token,
      userId: String(user._id),
      registeredRole: user.registeredRole,
      sessionRole,
      user: pickSafeUser(user),
    });
  } catch (err) {
    return res.status(500).json({ error: "UPGRADE_FAILED", message: err.message });
  }
};

// -------------------------------------
// setSessionRole: participant ↔ organizer
// Accetta body vuoto o { sessionRole } / { role }
// Se assente, fa toggle dall’attuale ruolo di sessione
// -------------------------------------
exports.setSessionRole = async (req, res) => {
  try {
    const uid = req.user.uid || req.user._id;
    const user = await User.findById(uid);
    if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });

    const body = normalizeSessionRoleBody(req.body || {});
    const currentSession = getSessionRoleFromReq(req);
    let next = body.sessionRole;

    if (!next) {
      // toggle
      next = currentSession === "organizer" ? "participant" : "organizer";
    }

    // Non permettere sessionRole organizer se registeredRole non è organizer
    const registeredRole = user.registeredRole || "participant";
    if (next === "organizer" && registeredRole !== "organizer") {
      // se non è ancora organizer “registrato”, rimane participant
      next = "participant";
    }

    const token = signToken(user, next);

    return res.json({
      token,
      userId: String(user._id),
      registeredRole,
      sessionRole: next,
      user: pickSafeUser(user),
    });
  } catch (err) {
    return res.status(500).json({ error: "SESSION_ROLE_FAILED", message: err.message });
  }
};

// -------------------------------------
// Partecipazione eventi (riusata da eventRoutes /:id/join|leave)
// Richiede authRequired e (idealmente) roleRequired('participant')
// -------------------------------------
exports.join = async (req, res) => {
  try {
    const eventId = req.params.id;
    const uid = req.user.uid || req.user._id;

    const ev = await Event.findById(eventId);
    if (!ev) return res.status(404).json({ error: "EVENT_NOT_FOUND" });

    const already = (ev.participants || []).some(p => String(p) === String(uid));
    if (!already) {
      ev.participants = Array.isArray(ev.participants) ? ev.participants : [];
      ev.participants.push(uid);
      await ev.save();
    }

    return res.json(ev);
  } catch (err) {
    return res.status(500).json({ error: "JOIN_FAILED", message: err.message });
  }
};

exports.leave = async (req, res) => {
  try {
    const eventId = req.params.id;
    const uid = req.user.uid || req.user._id;

    const ev = await Event.findById(eventId);
    if (!ev) return res.status(404).json({ error: "EVENT_NOT_FOUND" });

    ev.participants = (ev.participants || []).filter(p => String(p) !== String(uid));
    await ev.save();

    return res.json(ev);
  } catch (err) {
    return res.status(500).json({ error: "LEAVE_FAILED", message: err.message });
  }
};
