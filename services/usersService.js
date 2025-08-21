// services/usersService.js — User + UserProfile, login con desiredRole, sessionRole nel JWT (completo)
const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const UserProfile = require("../models/userProfileModel");
const Event = require("../models/eventModel");

const ALLOWED_ROLES = ["participant", "organizer"];

function signToken({ id, registeredRole, sessionRole }) {
  return jwt.sign(
    { id, registeredRole, sessionRole },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

async function register(body = {}) {
  const { name, email, password = "", role = "participant", profile } = body;

  if (!name || !email) {
    const e = new Error("NAME_EMAIL_REQUIRED");
    e.status = 400;
    throw e;
  }
  if (!ALLOWED_ROLES.includes(role)) {
    const e = new Error("INVALID_ROLE");
    e.status = 400;
    throw e;
  }

  const exists = await User.findOne({ email });
  if (exists) {
    const e = new Error("EMAIL_EXISTS");
    e.status = 409;
    throw e;
  }

  const user = await User.create({ name, email, password, role });
  if (profile && typeof profile === "object") {
    // salva profilo esteso se presente
    await UserProfile.create({ userId: user._id, ...profile });
  }
  return { userId: user._id };
}

function computeSessionRole(registeredRole, desiredRole) {
  // organizer può attivare sessione organizer o participant
  if (registeredRole === "organizer") {
    return ALLOWED_ROLES.includes(desiredRole) ? desiredRole : "organizer";
  }
  // participant resta participant
  return "participant";
}

async function login({ email, password, desiredRole }) {
  const user = await User.findOne({ email });
  if (!user) {
    const e = new Error("USER_NOT_FOUND");
    e.status = 404;
    throw e;
  }

  // in questa fase base, password in chiaro
  if ((user.password || "") !== (password || "")) {
    const e = new Error("INVALID_CREDENTIALS");
    e.status = 401;
    throw e;
  }

  const registeredRole = user.role || "participant";
  const sessionRole = computeSessionRole(registeredRole, desiredRole);

  const token = signToken({ id: user._id, registeredRole, sessionRole });
  return { token, userId: user._id, registeredRole, sessionRole };
}

async function setSessionRole(userId, requestedRole) {
  if (!ALLOWED_ROLES.includes(requestedRole)) {
    const e = new Error("INVALID_SESSION_ROLE");
    e.status = 400;
    throw e;
  }
  const user = await User.findById(userId);
  if (!user) {
    const e = new Error("USER_NOT_FOUND");
    e.status = 404;
    throw e;
  }

  const registeredRole = user.role || "participant";
  const sessionRole = computeSessionRole(registeredRole, requestedRole);
  const token = signToken({ id: user._id, registeredRole, sessionRole });
  return { token, sessionRole };
}

async function joinEvent(userId, eventId) {
  const ev = await Event.findById(eventId);
  if (!ev) {
    const e = new Error("EVENT_NOT_FOUND");
    e.status = 404;
    throw e;
  }

  const already = (ev.participants || []).some(
    (pid) => String(pid) === String(userId)
  );
  if (!already) {
    ev.participants.push(userId);
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

  ev.participants = (ev.participants || []).filter(
    (pid) => String(pid) !== String(userId)
  );
  await ev.save();
  return ev;
}

module.exports = {
  register,
  login,
  setSessionRole,
  joinEvent,
  leaveEvent,
};

