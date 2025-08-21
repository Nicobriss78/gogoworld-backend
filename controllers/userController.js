// controllers/userController.js — orchestratore Users (completo)
const usersService = require("../services/usersService");
const UserProfile = require("../models/userProfileModel");
const User = require("../models/userModel");

// POST /api/users/register
async function register(req, res, next) {
  try {
    const { userId } = await usersService.register(req.body || {});
    return res.status(201).json({ ok: true, userId });
  } catch (err) {
    return next(err);
  }
}

// POST /api/users/login
// body: { email, password, desiredRole? }
async function login(req, res, next) {
  try {
    const { email, password, desiredRole } = req.body || {};
    const out = await usersService.login({ email, password, desiredRole });
    // out: { token, userId, registeredRole, sessionRole }
    return res.json({ ok: true, ...out });
  } catch (err) {
    return next(err);
  }
}

// PUT /api/users/session-role
// body: { sessionRole: "participant" | "organizer" }
async function setSessionRole(req, res, next) {
  try {
    const { sessionRole } = req.body || {};
    const out = await usersService.setSessionRole(req.user.id, sessionRole);
    // out: { token, sessionRole }
    return res.json({ ok: true, ...out });
  } catch (err) {
    return next(err);
  }
}

// ✅ PUT /api/users/upgrade — upgrade permanente a organizer
async function upgradeToOrganizer(req, res, next) {
  try {
    const out = await usersService.upgradeToOrganizer(req.user.id);
    // out: { token, registeredRole:"organizer", sessionRole:"organizer" }
    return res.json({ ok: true, ...out });
  } catch (err) {
    return next(err);
  }
}

// GET /api/users/me
async function me(req, res, next) {
  try {
    const user = await User.findById(req.user.id).lean();
    const profile = await UserProfile.findOne({ userId: req.user.id }).lean();
    return res.json({
      ok: true,
      user: {
        id: user?._id,
        name: user?.name,
        email: user?.email,
        registeredRole: user?.role || "participant",
        sessionRole: req.user.sessionRole,
      },
      profile: profile || null,
    });
  } catch (err) {
    return next(err);
  }
}

// POST /api/users/:id/partecipa
// body: { eventId }
async function join(req, res, next) {
  try {
    const eventId = req.body?.eventId;
    if (!eventId) {
      const e = new Error("EVENT_ID_REQUIRED");
      e.status = 400;
      throw e;
    }
    const ev = await usersService.joinEvent(req.user.id, eventId);
    return res.json({ ok: true, eventId: ev._id, participants: ev.participants });
  } catch (err) {
    return next(err);
  }
}

// POST /api/users/:id/annulla
// body: { eventId }
async function leave(req, res, next) {
  try {
    const eventId = req.body?.eventId;
    if (!eventId) {
      const e = new Error("EVENT_ID_REQUIRED");
      e.status = 400;
      throw e;
    }
    const ev = await usersService.leaveEvent(req.user.id, eventId);
    return res.json({ ok: true, eventId: ev._id, participants: ev.participants });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  register,
  login,
  setSessionRole,
  upgradeToOrganizer, // ✅ export aggiunto
  me,
  join,
  leave,
};
