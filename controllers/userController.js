// controllers/userController.js — orchestratore Users
const usersService = require("../services/usersService");
const UserProfile = require("../models/userProfileModel");
const User = require("../models/userModel");

async function register(req, res, next) {
  try {
    const { userId } = await usersService.register(req.body);
    return res.status(201).json({ ok: true, userId });
  } catch (err) { next(err); }
}

async function login(req, res, next) {
  try {
    const { email, password, desiredRole } = req.body || {};
    const out = await usersService.login({ email, password, desiredRole });
    return res.json({ ok: true, ...out });
  } catch (err) { next(err); }
}

async function setSessionRole(req, res, next) {
  try {
    const { sessionRole } = req.body || {};
    const out = await usersService.setSessionRole(req.user.id, sessionRole);
    return res.json({ ok: true, ...out });
  } catch (err) { next(err); }
}

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
  } catch (err) { next(err); }
}

async function join(req, res, next) {
  try {
    const eventId = req.body?.eventId;
    if (!eventId) { const e = new Error("EVENT_ID_REQUIRED"); e.status = 400; throw e; }
    const ev = await usersService.joinEvent(req.user.id, eventId);
    return res.json({ ok: true, eventId: ev._id, participants: ev.participants });
  } catch (err) { next(err); }
}

async function leave(req, res, next) {
  try {
    const eventId = req.body?.eventId;
    if (!eventId) { const e = new Error("EVENT_ID_REQUIRED"); e.status = 400; throw e; }
    const ev = await usersService.leaveEvent(req.user.id, eventId);
    return res.json({ ok: true, eventId: ev._id, participants: ev.participants });
  } catch (err) { next(err); }
}

module.exports = { register, login, setSessionRole, me, join, leave };





