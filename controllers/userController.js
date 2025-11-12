// controllers/userController.js — GoGoWorld.life
// NOTE: Modifica CHIRURGICA per Opzione B
// - sessionRole ora protetto + persistente (salva davvero il ruolo in DB)
// - accetta solo "participant" o "organizer"
// - nessun altro endpoint modificato

const asyncHandler = require("express-async-handler");
const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const crypto = require("crypto");
const { logger } = require("../core/logger");
// -----------------------------------------------------------------------------
// Generate JWT
// -----------------------------------------------------------------------------
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

// -----------------------------------------------------------------------------
// @desc Register new user
// @route POST /api/users
// @access Public
// -----------------------------------------------------------------------------
const registerUser = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;
const nicknameFrom =
    (typeof name === "string" && name.trim()) ||
    (typeof email === "string" && email.includes("@") ? email.split("@")[0] : "");
  const userExists = await User.findOne({ email });
  if (userExists) {
    res.status(400);
    throw new Error("User already exists");
  }

const user = await User.create({
    name,
    email,
    password,
    role: role || "participant",
    profile: {
      nickname: nicknameFrom || undefined,
      privacy: { optInDM: false, dmsFrom: "everyone" }
    }
  });

  if (user) {
    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user._id),
    });
  } else {
    res.status(400);
    throw new Error("Invalid user data");
  }
});

// -----------------------------------------------------------------------------
// @desc Auth user & get token
// @route POST /api/users/login
// @access Public
// -----------------------------------------------------------------------------
const authUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });

  if (user && (await user.matchPassword(password))) {
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user._id),
    });
  } else {
    res.status(401);
    throw new Error("Invalid email or password");
  }
});

// -----------------------------------------------------------------------------
// @desc Get user profile
// @route GET /api/users/me
// @access Private
// -----------------------------------------------------------------------------
const getUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (user) {
 res.json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    // Nuovi campi per gamification / reputation
    score: user.score || 0,
    status: user.status || "novizio",
    stats: {
      attended: (user.stats && user.stats.attended) || 0,
      reviewsApproved: (user.stats && user.stats.reviewsApproved) || 0,
      lastScoreUpdateAt: (user.stats && user.stats.lastScoreUpdateAt) || null,
    },
    // Opzione B (già presente)
    canOrganize: !!user.canOrganize,
  });
  } else {
    res.status(404);
    throw new Error("User not found");
  }
});

// -----------------------------------------------------------------------------
// @desc Abilita modalità organizzatore per l'utente loggato
// @route POST /api/users/me/enable-organizer
// @access Private
// -----------------------------------------------------------------------------
const enableOrganizer = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  // Se un admin ha esplicitamente disabilitato l'organizzazione, non riabilitare
  if (user.canOrganize === false) {
    return res.status(403).json({
      ok: false,
      error: "Organizzazione disabilitata da un amministratore",
    });
  }

  // Se è già abilitato, conferma
  if (user.canOrganize === true) {
    return res.json({ ok: true, canOrganize: true, message: "Già abilitato" });
  }

  // Caso legacy: campo assente/undefined -> abilita una tantum
  user.canOrganize = true;
  await user.save();

  res.json({ ok: true, canOrganize: true });
});
// -----------------------------------------------------------------------------
// VERIFY EMAIL (GET /api/users/verify?token=...)
// -----------------------------------------------------------------------------
const verifyEmail = asyncHandler(async (req, res) => {
  const token = String(req.query.token || "");
  if (!token) {
    res.status(400);
    throw new Error("Missing token");
  }
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const now = new Date();
  const user = await User.findOne({
    verificationTokenHash: tokenHash,
    verificationTokenExpires: { $gt: now },
  });
  if (!user) {
    res.status(400);
    throw new Error("Invalid or expired token");
  }
  user.verified = true;
  user.verificationTokenHash = undefined;
  user.verificationTokenExpires = undefined;
  await user.save();
  res.json({ ok: true, verified: true });
});

// -----------------------------------------------------------------------------
// FORGOT PASSWORD (POST /api/users/forgot { email })
// -----------------------------------------------------------------------------
const forgotPassword = asyncHandler(async (req, res) => {
  const email = String(req.body.email || "").toLowerCase().trim();
  if (!email) {
    res.status(400);
    throw new Error("Email richiesta");
  }
  const user = await User.findOne({ email });
  if (!user) {
    // Non riveliamo se esiste o meno
    return res.json({ ok: true });
  }
  const raw = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  user.resetTokenHash = tokenHash;
  user.resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1h
  await user.save();

  const base = process.env.FRONTEND_URL || process.env.API_PUBLIC_BASE || "";
  const link = `${base}/reset.html?token=${encodeURIComponent(raw)}`;
  // In DEV logghiamo, in PROD il tuo MailAdapter invierà davvero
  if (logger && logger.info) {
    logger.info(`[mail][reset] to=${email} link=${link}`);
  }
  res.json({ ok: true });
});

// -----------------------------------------------------------------------------
// RESET PASSWORD (POST /api/users/reset { token, password })
// -----------------------------------------------------------------------------
const resetPassword = asyncHandler(async (req, res) => {
  const token = String(req.body.token || "");
  const newPassword = String(req.body.password || "");
  if (!token || !newPassword) {
    res.status(400);
    throw new Error("Token e password richiesti");
  }
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const now = new Date();
  const user = await User.findOne({
    resetTokenHash: tokenHash,
    resetTokenExpires: { $gt: now },
  });
  if (!user) {
    res.status(400);
    throw new Error("Invalid or expired token");
  }
  user.password = newPassword;
  user.resetTokenHash = undefined;
  user.resetTokenExpires = undefined;
  await user.save();
  res.json({ ok: true, reset: true });
});

// --- GET /api/users/search?query=... (auth) ---
// Ritorna: _id, name, avatar (profile.avatarUrl), city, region

const buildRegex = (q) => {
  try {
    return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  } catch {
    return new RegExp("", "i");
  }
};

const searchUsers = asyncHandler(async (req, res) => {
  const q = String(req.query.query || "").trim();
  if (!q || q.length < 2) {
    return res.json({ ok: true, data: [] });
  }
  const rx = buildRegex(q);
  const rows = await User.find(
    {
      isBanned: false,
      $or: [{ name: rx }, { "profile.nickname": rx }],
    },
    { name: 1, "profile.avatarUrl": 1, "profile.city": 1, "profile.region": 1 }
  )
    .sort({ name: 1 })
    .limit(20)
    .lean();

  const data = rows.map((u) => ({
    _id: u._id,
    name: u.name,
    avatar: u.profile?.avatarUrl || null,
    city: u.profile?.city || null,
    region: u.profile?.region || null,
  }));
  return res.json({ ok: true, data });
});

module.exports = {
  registerUser,
  authUser,
  getUserProfile,
  enableOrganizer,
  verifyEmail,
  forgotPassword,
  resetPassword,
  searchUsers,
};





