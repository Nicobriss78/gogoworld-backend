// controllers/userController.js — allineato ai tuoi modelli:
// - Usa ../models/userModel e ../models/eventModel
// - Campi User: name, email, password (plain), role ("participant"|"organizer"), currentRole (legacy)
// - "registeredRole" = user.role
// - "sessionRole" è solo nel JWT (non persistiamo altro, salvo currentRole legacy se già usato)
// - Tutte le risposte di login/upgrade/setSessionRole ritornano: { token, userId, registeredRole, sessionRole, user }

const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const Event = require("../models/eventModel");

const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_SECRET";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

// --------------------- helpers ---------------------
function safeUser(u) {
  return {
    id: String(u._id),
    email: u.email,
    name: u.name || "",
    registeredRole: u.role || "participant",
  };
}

function signToken(userDoc, sessionRole) {
  const payload = {
    uid: String(userDoc._id),
    registeredRole: userDoc.role || "participant",
    sessionRole: sessionRole || userDoc.role || "participant",
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function getSessionRoleFromReq(req) {
  return (req.user && req.user.sessionRole) || (req.user && req.user.registeredRole) || "participant";
}

function normalizeSessionRoleBody(body = {}) {
  const out = { ...body };
  if (!out.sessionRole && out.role) out.sessionRole = out.role;
  if (out.sessionRole !== "organizer" && out.sessionRole !== "participant") delete out.sessionRole;
  return out;
}

// --------------------- Auth ---------------------
exports.register = async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password || !name) {
      return res.status(400).json({ error: "EMAIL_PASSWORD_NAME_REQUIRED" });
    }

    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(409).json({ error: "EMAIL_ALREADY_REGISTERED" });

    const user = await User.create({
      email: email.toLowerCase(),
      password, // ⚠️ nel tuo modello è plain (TODO bcrypt in futuro)
      name,
      role: "participant", // registeredRole iniziale
    });

    const sessionRole = "participant";
    const token = signToken(user, sessionRole);

    return res.status(201).json({
      token,
      userId: String(user._id),
      registeredRole: user.role,
      sessionRole,
      user: safeUser(user),
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

    // Nel tuo schema la password è plain; confronto diretto
    if (String(user.password || "") !== String(password)) {
      return res.status(401).json({ error: "INVALID_CREDENTIALS" });
    }

    const sessionRole = user.role || "participant";
    const token = signToken(user, sessionRole);

    return res.json({
      token,
      userId: String(user._id),
      registeredRole: user.role || "participant",
      sessionRole,
      user: safeUser(user),
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
      user: safeUser(user),
      sessionRole: getSessionRoleFromReq(req),
      registeredRole: user.role || "participant",
    });
  } catch (err) {
    return res.status(500).json({ error: "ME_FAILED", message: err.message });
  }
};

// --------------------- Upgrade (registeredRole → organizer) ---------------------
exports.upgrade = async (req, res) => {
  try {
    const uid = req.user.uid || req.user._id;
    const user = await User.findById(uid);
    if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });

    if (user.role !== "organizer") {
      user.role = "organizer";
      await user.save();
    }

    const sessionRole = "organizer";
    const token = signToken(user, sessionRole);

    return res.json({
      token,
      userId: String(user._id),
      registeredRole: user.role,
      sessionRole,
      user: safeUser(user),
    });
  } catch (err) {
    return res.status(500).json({ error: "UPGRADE_FAILED", message: err.message });
  }
};

// --------------------- setSessionRole (toggle o esplicito) ---------------------
exports.setSessionRole = async (req, res) => {
  try {
    const uid = req.user.uid || req.user._id;
    const user = await User.findById(uid);
    if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });

    const body = normalizeSessionRoleBody(req.body || {});
    const current = getSessionRoleFromReq(req);
    let next = body.sessionRole || (current === "organizer" ? "participant" : "organizer");

    // vincolo: se non è organizer registrato, non può avere sessionRole=organizer
    const registeredRole = user.role || "participant";
    if (next === "organizer" && registeredRole !== "organizer") {
      next = "participant";
    }

    // opzionale: se usi currentRole legacy, lo aggiorno senza vincolarti
    if ("currentRole" in user) {
      user.currentRole = next;
      try { await user.save(); } catch (_) {}
    }

    const token = signToken(user, next);
    return res.json({
      token,
      userId: String(user._id),
      registeredRole,
      sessionRole: next,
      user: safeUser(user),
    });
  } catch (err) {
    return res.status(500).json({ error: "SESSION_ROLE_FAILED", message: err.message });
  }
};

// --------------------- Partecipazione eventi (riusata da /api/events/:id/join|leave) ---------------------
exports.join = async (req, res) => {
  try {
    const eventId = req.params.id;
    const uid = req.user.uid || req.user._id;

    const ev = await Event.findById(eventId);
    if (!ev) return res.status(404).json({ error: "EVENT_NOT_FOUND" });

    const list = Array.isArray(ev.participants) ? ev.participants.map(String) : [];
    if (!list.includes(String(uid))) {
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

