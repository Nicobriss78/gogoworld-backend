// services/usersService.js — registeredRole in DB, sessionRole nel token + creazione profilo
const User = require("../models/userModel");
const Event = require("../models/eventModel");
const UserProfile = require("../models/userProfileModel");
const jwt = require("jsonwebtoken");

const ALLOWED_ROLES = ["participant", "organizer"];

function signToken({ id, registeredRole, sessionRole }) {
  return jwt.sign(
    { id, registeredRole, sessionRole },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

async function register({ name, email, password, role, profile }) {
  const exists = await User.findOne({ email });
  if (exists) {
    const err = new Error("EMAIL_IN_USE");
    err.status = 409;
    throw err;
  }
  const registeredRole = ALLOWED_ROLES.includes(role) ? role : "participant";
  const user = await User.create({
    name, email, password,
    role: registeredRole, // persistito per statistiche
    currentRole: registeredRole, // compat legacy
  });

  // Crea il profilo opzionale (se fornito)
  try {
    if (profile && typeof profile === "object") {
      await UserProfile.create({
        userId: user._id,
        phone: profile.phone ?? undefined,
        city: profile.city ?? undefined,
        province: profile.province ?? undefined,
        region: profile.region ?? undefined,
        country: profile.country ?? undefined,
        favoriteCategories: Array.isArray(profile.favoriteCategories) ? profile.favoriteCategories : [],
        availability: Array.isArray(profile.availability) ? profile.availability : [],
        travelWillingness: profile.travelWillingness ?? undefined,
        social: {
          instagram: profile.social?.instagram ?? undefined,
          facebook: profile.social?.facebook ?? undefined,
          website: profile.social?.website ?? undefined,
        },
        bio: profile.bio ?? undefined,
        languages: Array.isArray(profile.languages) ? profile.languages : [],
        gender: profile.gender ?? undefined,
        birthDate: profile.birthDate ? new Date(profile.birthDate) : undefined,
        newsletterOptIn: !!profile.newsletterOptIn,
      });
    }
  } catch (e) {
    // Non blocchiamo la registrazione se il profilo fallisce: log e si prosegue
    console.error("UserProfile create failed:", e?.message);
  }

  return user;
}

async function login({ email, password, desiredRole }) {
  const user = await User.findOne({ email });
  if (!user) { const e = new Error("INVALID_CREDENTIALS"); e.status = 401; throw e; }
  const ok = await user.comparePassword(password);
  if (!ok) { const e = new Error("INVALID_CREDENTIALS"); e.status = 401; throw e; }

  const registeredRole = user.role || "participant";
  const sessionRole = ALLOWED_ROLES.includes(desiredRole) ? desiredRole : registeredRole;

  const token = signToken({ id: user._id, registeredRole, sessionRole });
  return { token, user, registeredRole, sessionRole };
}

async function setSessionRole(userId, sessionRole) {
  if (!ALLOWED_ROLES.includes(sessionRole)) {
    const e = new Error("ROLE_NOT_ALLOWED");
    e.status = 422;
    throw e;
  }
  const user = await User.findById(userId);
  if (!user) { const e = new Error("USER_NOT_FOUND"); e.status = 404; throw e; }

  const registeredRole = user.role || "participant";
  const token = signToken({ id: user._id, registeredRole, sessionRole });
  return { token, registeredRole, sessionRole };
}

async function joinEvent(userId, eventId) {
  const ev = await Event.findById(eventId);
  if (!ev) { const e = new Error("EVENT_NOT_FOUND"); e.status = 404; throw e; }
  if (typeof ev.capacity === "number" && ev.capacity > 0) {
    const count = (ev.participants || []).length;
    if (count >= ev.capacity) { const e = new Error("EVENT_FULL"); e.status = 409; throw e; }
  }
  const has = (ev.participants || []).some(id => String(id) === String(userId));
  if (!has) {
    ev.participants = [...(ev.participants || []), String(userId)];
    await ev.save();
  }
  return ev;
}

async function leaveEvent(userId, eventId) {
  const ev = await Event.findById(eventId);
  if (!ev) { const e = new Error("EVENT_NOT_FOUND"); e.status = 404; throw e; }
  ev.participants = (ev.participants || []).filter(id => String(id) !== String(userId));
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
