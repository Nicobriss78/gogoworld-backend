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
const { createNotification } = require("./notificationController"); // A9.1 notifiche follow

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
  // ---- input validation minima (no deps) ----
  const nameRaw = typeof name === "string" ? name.trim() : "";
  const emailRaw = typeof email === "string" ? email.trim().toLowerCase() : "";
  const passRaw = typeof password === "string" ? password : "";

  if (!nameRaw || nameRaw.length < 2 || nameRaw.length > 50) {
    return res.status(400).json({ ok: false, error: "INVALID_NAME" });
  }
  // email minimale (non perfetta RFC, ma sufficiente per evitare garbage)
  if (!emailRaw || emailRaw.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
    return res.status(400).json({ ok: false, error: "INVALID_EMAIL" });
  }
  // password: limiti ragionevoli, evita vuoti/mega-stringhe
  if (!passRaw || passRaw.length < 8 || passRaw.length > 72) {
    return res.status(400).json({ ok: false, error: "INVALID_PASSWORD" });
  }

  // role: non consentire registrazione "admin" (deny-by-default)
  const roleNorm = role ? String(role).toLowerCase() : "participant";
  if (roleNorm !== "participant" && roleNorm !== "organizer") {
    return res.status(400).json({ ok: false, error: "INVALID_ROLE" });
  }

const nicknameFrom =
    (typeof name === "string" && name.trim()) ||
    (typeof email === "string" && email.includes("@") ? email.split("@")[0] : "");
  const userExists = await User.findOne({ email: emailRaw });
  if (userExists) {
    res.status(400);
    throw new Error("User already exists");
  }

const user = await User.create({
    name: nameRaw,
    email: emailRaw,
    password: passRaw,
    role: roleNorm,
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

  const emailRaw = typeof email === "string" ? email.trim().toLowerCase() : "";
  const passRaw = typeof password === "string" ? password : "";


  if (!emailRaw || emailRaw.length > 254) {
    return res.status(400).json({ ok: false, error: "INVALID_EMAIL" });
  }
  if (!passRaw || passRaw.length < 1 || passRaw.length > 72) {
    return res.status(400).json({ ok: false, error: "INVALID_PASSWORD" });
  }

  const user = await User.findOne({ email: emailRaw });

  if (user && (await user.matchPassword(passRaw))) {
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
   // A8.x — elenco ID dei profili che seguo
      // usato dall’area Partecipante per filtrare gli "Eventi delle persone che segui"
      following: Array.isArray(user.following)
        ? user.following.map((id) => String(id))
        : [],
      // (facoltativo ma utile in futuro)
      followersCount: Array.isArray(user.followers) ? user.followers.length : 0,
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
const token = String(req.body.token || "").trim();
  const newPassword = String(req.body.password || "");

  if (!token || token.length < 10 || token.length > 200) {
    return res.status(400).json({ ok: false, error: "INVALID_TOKEN" });
  }
  if (!newPassword || newPassword.length < 8 || newPassword.length > 72) {
    return res.status(400).json({ ok: false, error: "INVALID_PASSWORD" });
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
  const meId = req.user && req.user._id;

  // Carichiamo l'utente corrente solo se loggato, per sapere chi ha bloccato chi
  let me = null;
  if (meId) {
    me = await User.findById(meId).select("blockedUsers").lean();
  }

  const rows = await User.find(
    {
      isBanned: false,
      ...(meId ? { _id: { $ne: meId } } : {}),
      $or: [{ name: rx }, { "profile.nickname": rx }],
    },
    {
      name: 1,
      "profile.avatarUrl": 1,
      "profile.city": 1,
      "profile.region": 1,
      blockedUsers: 1, // per capire se l'altro ha bloccato me
      role: 1,
    }
  )
    .sort({ name: 1 })
    .limit(20)
    .lean();

  const meIdStr = meId ? meId.toString() : null;

  const data = rows.map((u) => {
    const uid = u._id.toString();

    const blockedByMe =
      me?.blockedUsers?.some((id) => id.toString() === uid) || false;

    const hasBlockedMe =
      u.blockedUsers?.some((id) => id.toString() === meIdStr) || false;

    return {
      _id: u._id,
      name: u.name,
      avatar: u.profile?.avatarUrl || null,
      city: u.profile?.city || null,
      region: u.profile?.region || null,
      blockedByMe,
      hasBlockedMe,
      role: u.role || null, // ⬅️ AGGIUNTO
      };
  });

  return res.json({ ok: true, data });
});
// -----------------------------------------------------------------------------
// FOLLOW / UNFOLLOW — Follow asimmetrico (A3.1)
// -----------------------------------------------------------------------------

// POST /api/users/:userId/follow
const followUser = asyncHandler(async (req, res) => {
  const meId = req.user && req.user._id;
  const targetId = req.params.userId;

  if (!meId || !targetId) {
    return res.status(400).json({ ok: false, error: "missing_data" });
  }

  // Auto-follow bloccato
  if (String(meId) === String(targetId)) {
    return res.status(400).json({ ok: false, error: "cannot_follow_yourself" });
  }

  // Recupero utenti
const me = await User.findById(meId).select("following blockedUsers name");
  const target = await User.findById(targetId).select("followers blockedUsers");


  if (!me || !target) {
    return res.status(404).json({ ok: false, error: "user_not_found" });
  }

  // Se l'altro mi ha bloccato → non posso seguirlo
  if (target.blockedUsers?.some((id) => String(id) === String(meId))) {
    return res.status(403).json({ ok: false, error: "blocked_by_target" });
  }

  // Se l'ho bloccato io → non posso seguirlo
  if (me.blockedUsers?.some((id) => String(id) === String(targetId))) {
    return res.status(403).json({ ok: false, error: "you_blocked_target" });
  }

// Evita doppio follow
  const already = me.following.some((id) => String(id) === String(targetId));
  if (!already) {
    me.following.push(targetId);
    target.followers.push(meId);

    await me.save({ validateModifiedOnly: true });
    await target.save({ validateModifiedOnly: true });

    // A9.1 — Notifica "nuovo follower"
    try {
      await createNotification({
        user: targetId, // chi riceve la notifica
        actor: meId, // chi ha iniziato a seguire
        type: "follow",
        title: "Hai un nuovo follower!",
        message: `${me.name || "Un utente"} ha iniziato a seguirti`,
      });
} catch (err) {
  logger.warn("[notifications][follow] notify failed", err);
  // non blocchiamo la risposta se la notifica fallisce
}

  }

  return res.json({ ok: true, following: true });
});

// DELETE /api/users/:userId/follow
const unfollowUser = asyncHandler(async (req, res) => {
  const meId = req.user && req.user._id;
  const targetId = req.params.userId;

  if (!meId || !targetId) {
    return res.status(400).json({ ok: false, error: "missing_data" });
  }

  const me = await User.findById(meId).select("following");
  const target = await User.findById(targetId).select("followers");

  if (!me || !target) {
    return res.status(404).json({ ok: false, error: "user_not_found" });
  }

  me.following = me.following.filter((id) => String(id) !== String(targetId));
  target.followers = target.followers.filter((id) => String(id) !== String(meId));

  await me.save({ validateModifiedOnly: true });
  await target.save({ validateModifiedOnly: true });

  return res.json({ ok: true, following: false });
});

// GET /api/users/:userId/followers
const getFollowers = asyncHandler(async (req, res) => {
  const userId = req.params.userId;

  const user = await User.findById(userId).select("followers").populate({
    path: "followers",
    select: "name profile.avatarUrl profile.city profile.region role",
  });

  if (!user) {
    return res.status(404).json({ ok: false, error: "user_not_found" });
  }

  return res.json({ ok: true, data: user.followers || [] });
});

// GET /api/users/:userId/following
const getFollowing = asyncHandler(async (req, res) => {
  const userId = req.params.userId;

  const user = await User.findById(userId).select("following").populate({
    path: "following",
    select: "name profile.avatarUrl profile.city profile.region role",
  });

  if (!user) {
    return res.status(404).json({ ok: false, error: "user_not_found" });
  }

  return res.json({ ok: true, data: user.following || [] });
});

// -----------------------------------------------------------------------------
// PROFILO PUBBLICO — A3.2
// -----------------------------------------------------------------------------

// GET /api/users/:userId/public
const getPublicProfile = asyncHandler(async (req, res) => {
  const targetId = req.params.userId;

  const viewerId = req.user ? String(req.user._id) : null;

  const user = await User.findById(targetId)
    .select("name role profile followers following")
    .lean();


  if (!user) {
    return res.status(404).json({ ok: false, error: "user_not_found" });
  }

  // Conteggi follow
  const followersCount = user.followers ? user.followers.length : 0;
  const followingCount = user.following ? user.following.length : 0;

  // Se chi guarda è loggato → determinare se lo segue
  let isFollowing = false;
  if (viewerId && user.followers) {
    isFollowing = user.followers.some((id) => String(id) === viewerId);
  }

  return res.json({
    ok: true,
    data: {
      _id: targetId,
      name: user.name || "",
      role: user.role || "user",
      profile: {
        avatarUrl: user.profile?.avatarUrl || null,
        city: user.profile?.city || "",
        region: user.profile?.region || "",
        bio: user.profile?.bio || "",
      },
      followersCount,
      followingCount,
      isFollowing,
      activityVisibility: user.profile?.activityVisibility || "followers-only",
    },
  });
});
// -----------------------------------------------------------------------------
// BACHECA ATTIVITÀ — A3.3
// -----------------------------------------------------------------------------

// GET /api/users/:userId/activity
const getUserActivityFeed = asyncHandler(async (req, res) => {
  const targetId = req.params.userId;
  const viewerId = req.user ? String(req.user._id) : null;

  const user = await User.findById(targetId)
    .select("profile followers")
    .lean();


  if (!user) {
    return res.status(404).json({ ok: false, error: "user_not_found" });
  }

// PRIVACY
  const visibility = user.profile?.activityVisibility || "followers-only";

  const isSelf = viewerId && String(viewerId) === String(targetId);

  if (visibility === "followers-only" && !isSelf) {
    // se il viewer NON è il proprietario e NON è un follower → accesso negato
    const isFollower =
      viewerId &&
      user.followers &&
      user.followers.some((id) => String(id) === viewerId);

    if (!isFollower) {
      return res.status(403).json({ ok: false, error: "activity_private" });
    }
  }

  // RECUPERO ATTIVITÀ (max 30)
  const Activity = require("../models/activityModel");

  const feed = await Activity.find({ user: targetId })
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();

  return res.json({ ok: true, data: feed });
});

// -----------------------------------------------------------------------------
// 31.2 - Blocchi utente (block/unblock)
// -----------------------------------------------------------------------------

/**
 * POST /api/users/:userId/block
 * Body opzionale: { userId }
 * L'utente loggato blocca userId (non può bloccare se stesso né l'admin)
 */
const blockUser = asyncHandler(async (req, res) => {
  const meId = req.user && req.user._id;
  const targetId = req.params.userId || (req.body && req.body.userId);

  if (!meId || !targetId) {
    return res
      .status(400)
      .json({ ok: false, error: "Dati mancanti per il blocco utente." });
  }

  // Non posso bloccare me stesso
  if (String(meId) === String(targetId)) {
    return res
      .status(400)
      .json({ ok: false, error: "Non puoi bloccare te stesso." });
  }

  // Recupero utente bersaglio (mi serve il ruolo)
  const target = await User.findById(targetId).select("role");
  if (!target) {
    return res
      .status(404)
      .json({ ok: false, error: "Utente da bloccare non trovato." });
  }

  // 🚫 Non si può bloccare l'amministratore
  if (target.role === "admin") {
    return res
      .status(403)
      .json({ ok: false, error: "Non puoi bloccare l'amministratore." });
  }

  // Recupero l'utente corrente con l'array dei bloccati
  const me = await User.findById(meId).select("blockedUsers");
  if (!me) {
    return res
      .status(404)
      .json({ ok: false, error: "Utente corrente non trovato." });
  }

  // Aggiungo ai bloccati solo se non è già presente
  if (!me.blockedUsers.some((id) => id.toString() === String(targetId))) {
    me.blockedUsers.push(targetId);
    await me.save();
  }

  return res.json({ ok: true, blocked: true });
});


/**
 * POST /api/users/unblock
 * Body: { userId }
 */
const unblockUser = asyncHandler(async (req, res) => {
  const meId = req.user._id;
  const userId = req.params.userId || (req.body && req.body.userId);

  const me = await User.findById(meId).select("blockedUsers");
  if (!me) {
    return res.status(404).json({ message: "User not found" });
  }

  me.blockedUsers = me.blockedUsers.filter(
    (id) => id.toString() !== String(userId)
  );
  await me.save();

  return res.json({ ok: true, blocked: false });
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
  blockUser,
  unblockUser,
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
  getPublicProfile,
  getUserActivityFeed, // A3.3
};

























