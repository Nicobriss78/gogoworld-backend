// controllers/userController.js — login/registrazione + sessionRole switch (con profilo)
const usersService = require("../services/usersService");

async function register(req, res, next) {
  try {
    const user = await usersService.register(req.body); // req.body include { ..., profile: {...} }
    res.status(201).json({ ok: true, userId: user._id });
  } catch (err) { next(err); }
}

async function login(req, res, next) {
  try {
    const { token, user, registeredRole, sessionRole } = await usersService.login(req.body);
    res.json({
      token,
      userId: user._id,
      registeredRole,
      sessionRole,
    });
  } catch (err) { next(err); }
}

async function setSessionRole(req, res, next) {
  try {
    const userId = req.user?.id;
    const { sessionRole } = req.body || {};
    const out = await usersService.setSessionRole(userId, sessionRole);
    res.json({ ok: true, ...out });
  } catch (err) { next(err); }
}

async function me(req, res, next) {
  try {
    res.json({
      ok: true,
      userId: req.user.id,
      registeredRole: req.user.registeredRole,
      sessionRole: req.user.sessionRole,
    });
  } catch (err) { next(err); }
}

async function join(req, res, next) {
  try {
    const userId = req.user?.id;
    const { eventId } = req.body || {};
    const ev = await usersService.joinEvent(userId, eventId);
    res.json({ ok: true, eventId: ev._id, participantsCount: (ev.participants || []).length });
  } catch (err) { next(err); }
}

async function leave(req, res, next) {
  try {
    const userId = req.user?.id;
    const { eventId } = req.body || {};
    const ev = await usersService.leaveEvent(userId, eventId);
    res.json({ ok: true, eventId: ev._id, participantsCount: (ev.participants || []).length });
  } catch (err) { next(err); }
}

module.exports = {
  register,
  login,
  setSessionRole,
  me,
  join,
  leave,
};






