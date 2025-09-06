// controllers/userController.js — GoGoWorld.life
// NOTE: Modifica CHIRURGICA per Opzione B
// - sessionRole ora protetto + persistente (salva davvero il ruolo in DB)
// - accetta solo "participant" o "organizer"
// - nessun altro endpoint modificato

const asyncHandler = require("express-async-handler");
const jwt = require("jsonwebtoken");
const User = require("../models/userModel");

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
      // PATCH: includi canOrganize per la logica FE (Opzione B)
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
