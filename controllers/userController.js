// controllers/userController.js
// Controller utenti: delega ai services e usa next(err)

const usersService = require("../services/usersService");
const jwtSecret = process.env.JWT_SECRET;

async function register(req, res, next) {
  try {
    const user = await usersService.register(req.body);
    res.status(201).json({ ok: true, userId: user._id });
  } catch (err) { next(err); }
}

async function login(req, res, next) {
  try {
    const { token, user } = await usersService.login(req.body, { jwtSecret });
    res.json({
      token,
      userId: user._id,
      role: user.role,
      currentRole: user.currentRole,
    });
  } catch (err) { next(err); }
}

async function me(req, res, next) {
  try {
    res.json({ ok: true, userId: req.user.id, role: req.user.role, currentRole: req.user.currentRole });
  } catch (err) { next(err); }
}

async function switchRole(req, res, next) {
  try {
    const userId = req.user?.id;
    const nextRole = req.body?.role;
    const updated = await usersService.switchRole(userId, nextRole);
    res.json({
      ok: true,
      userId: updated._id,
      role: updated.role,
      currentRole: updated.currentRole,
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
  me,
  switchRole,
  join,
  leave,
};


