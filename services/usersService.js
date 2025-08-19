// services/usersService.js
// Strato servizi per User e partecipazioni evento

const User = require("../models/userModel");
const Event = require("../models/eventModel");
const jwt = require("jsonwebtoken");

function signToken(user, secret) {
  return jwt.sign(
    { id: user._id, role: user.role, currentRole: user.currentRole },
    secret,
    { expiresIn: "7d" }
  );
}

async function register({ name, email, password, role }) {
  const exists = await User.findOne({ email });
  if (exists) {
    const err = new Error("EMAIL_IN_USE");
    err.status = 409;
    throw err;
  }
  const user = await User.create({
    name, email, password, role: role || "participant", currentRole: role || "participant",
  });
  return user;
}

async function login({ email, password }, { jwtSecret }) {
  const user = await User.findOne({ email });
  if (!user) {
    const err = new Error("INVALID_CREDENTIALS");
    err.status = 401;
    throw err;
  }
  const ok = await user.comparePassword(password);
  if (!ok) {
    const err = new Error("INVALID_CREDENTIALS");
    err.status = 401;
    throw err;
  }
  const token = signToken(user, jwtSecret);
  return { token, user };
}

async function switchRole(userId, nextRole) {
  const allowed = ["participant", "organizer"];
  if (!allowed.includes(nextRole)) {
    const err = new Error("ROLE_NOT_ALLOWED");
    err.status = 422;
    throw err;
  }
  const updated = await User.findByIdAndUpdate(
    userId,
    { currentRole: nextRole },
    { new: true }
  );
  if (!updated) {
    const e = new Error("USER_NOT_FOUND");
    e.status = 404;
    throw e;
  }
  return updated;
}

async function joinEvent(userId, eventId) {
  const ev = await Event.findById(eventId);
  if (!ev) {
    const e = new Error("EVENT_NOT_FOUND");
    e.status = 404;
    throw e;
  }
  // capienza (se definita)
  if (typeof ev.capacity === "number" && ev.capacity > 0) {
    const count = (ev.participants || []).length;
    if (count >= ev.capacity) {
      const e = new Error("EVENT_FULL");
      e.status = 409;
      throw e;
    }
  }
  // evita duplicati
  const has = (ev.participants || []).includes(String(userId));
  if (!has) {
    ev.participants = [...(ev.participants || []), String(userId)];
    await ev.save();
  }
  return ev;
}

async function leaveEvent(userId, eventId) {
  const ev = await Event.findById(eventId);
  if (!ev) {
    const e = new Error("EVENT_NOT_FOUND");
    e.status = 404;
    throw e;
  }
  ev.participants = (ev.participants || []).filter(id => String(id) !== String(userId));
  await ev.save();
  return ev;
}

module.exports = {
  register,
  login,
  switchRole,
  joinEvent,
  leaveEvent,
};
