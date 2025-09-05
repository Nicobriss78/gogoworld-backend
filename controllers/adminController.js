// backend/controllers/adminController.js
// Admin Dashboard — Moderazione Eventi & Gestione Utenti
// Requisiti: middleware protect + authorize("admin") a monte

const asyncHandler = require("express-async-handler");
const Event = require("../models/eventModel");
const User = require("../models/userModel");

// -----------------------------
// Utils
// -----------------------------
function now() { return new Date(); }

function likeRx(s) {
  const esc = String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(esc, "i");
}

function pick(obj, keys) {
  const out = {};
  keys.forEach(k => {
    if (typeof obj[k] !== "undefined") out[k] = obj[k];
  });
  return out;
}

// -----------------------------
// Eventi — Moderazione
// -----------------------------

// GET /api/admin/events?approvalStatus=&q=&organizerId=&region=&category=...
const listModerationEvents = asyncHandler(async (req, res) => {
  const q = req.query || {};
  const where = {};

  // Filtri tassonomici/geografici opzionali
  ["region","country","city","category","subcategory","type","language","target","visibility"].forEach(k => {
    if (q[k]) where[k] = q[k];
  });

  if (q.approvalStatus) where.approvalStatus = q.approvalStatus;
  if (q.organizerId) where.organizer = q.organizerId;
  if (q.q) {
    const rx = likeRx(q.q);
    where.$or = [
      { title: rx },
      { description: rx },
      { city: rx },
      { region: rx },
      { country: rx },
      { category: rx },
      { subcategory: rx },
      { type: rx },
    ];
  }

  const events = await Event.find(where).sort({ approvalStatus: 1, dateStart: 1, createdAt: -1 }).lean();
  res.json({ ok: true, events });
});

async function setModeration(ev, status, { reason, notes }, adminUserId) {
  ev.approvalStatus = status;
  ev.moderation = {
    reason: typeof reason === "string" ? reason.trim() : ev?.moderation?.reason,
    notes: typeof notes === "string" ? notes.trim() : ev?.moderation?.notes,
    updatedBy: adminUserId,
    updatedAt: now(),
  };
  await ev.save();
  return ev;
}

// POST /api/admin/events/:id/approve
const approveEvent = asyncHandler(async (req, res) => {
  const ev = await Event.findById(req.params.id);
  if (!ev) { res.status(404); throw new Error("Evento non trovato"); }
  await setModeration(ev, "approved", pick(req.body, ["reason","notes"]), req.user._id);
  res.json({ ok: true, event: ev });
});

// POST /api/admin/events/:id/reject
const rejectEvent = asyncHandler(async (req, res) => {
  const { reason } = req.body || {};
  if (!reason || !String(reason).trim()) {
    res.status(422);
    throw new Error("Motivazione obbligatoria per il rifiuto");
  }
  const ev = await Event.findById(req.params.id);
  if (!ev) { res.status(404); throw new Error("Evento non trovato"); }
  await setModeration(ev, "rejected", pick(req.body, ["reason","notes"]), req.user._id);
  res.json({ ok: true, event: ev });
});

// POST /api/admin/events/:id/block
const blockEvent = asyncHandler(async (req, res) => {
  const ev = await Event.findById(req.params.id);
  if (!ev) { res.status(404); throw new Error("Evento non trovato"); }
  await setModeration(ev, "blocked", pick(req.body, ["reason","notes"]), req.user._id);
  res.json({ ok: true, event: ev });
});

// POST /api/admin/events/:id/unblock
const unblockEvent = asyncHandler(async (req, res) => {
  const ev = await Event.findById(req.params.id);
  if (!ev) { res.status(404); throw new Error("Evento non trovato"); }
  await setModeration(ev, "approved", pick(req.body, ["reason","notes"]), req.user._id);
  res.json({ ok: true, event: ev });
});

// DELETE /api/admin/events/:id/force
const forceDeleteEvent = asyncHandler(async (req, res) => {
  const ev = await Event.findById(req.params.id);
  if (!ev) { res.status(404); throw new Error("Evento non trovato"); }
  await ev.deleteOne();
  res.json({ ok: true, message: "Evento eliminato definitivamente" });
});

// -----------------------------
// Utenti — Gestione
// -----------------------------

// GET /api/admin/users?q=&role=&canOrganize=&isBanned=
const listUsers = asyncHandler(async (req, res) => {
  const q = req.query || {};
  const where = {};

  if (q.role) where.role = q.role;
  if (q.canOrganize !== undefined) where.canOrganize = q.canOrganize === "true" || q.canOrganize === true;
  if (q.isBanned !== undefined) where.isBanned = q.isBanned === "true" || q.isBanned === true;

  if (q.q) {
    const rx = likeRx(q.q);
    where.$or = [
      { name: rx },
      { email: rx },
    ];
  }

  const users = await User.find(where).sort({ role: 1, canOrganize: -1, createdAt: -1 }).lean();
  res.json({ ok: true, users });
});

// POST /api/admin/users/:id/ban
const banUser = asyncHandler(async (req, res) => {
  const targetId = req.params.id;
  if (String(targetId) === String(req.user._id)) {
    res.status(400); throw new Error("Non puoi bannare te stesso");
  }
  const u = await User.findById(targetId);
  if (!u) { res.status(404); throw new Error("Utente non trovato"); }
  u.isBanned = true;
  await u.save();
  res.json({ ok: true, user: u });
});

// POST /api/admin/users/:id/unban
const unbanUser = asyncHandler(async (req, res) => {
  const u = await User.findById(req.params.id);
  if (!u) { res.status(404); throw new Error("Utente non trovato"); }
  u.isBanned = false;
  await u.save();
  res.json({ ok: true, user: u });
});

// POST /api/admin/users/:id/role { role: "participant"|"organizer"|"admin" }
const setUserRole = asyncHandler(async (req, res) => {
  const { role } = req.body || {};
  const allowed = new Set(["participant","organizer","admin"]);
  if (!allowed.has(role)) { res.status(422); throw new Error("Ruolo non valido"); }

  const targetId = req.params.id;
  const self = String(targetId) === String(req.user._id);

  const u = await User.findById(targetId);
  if (!u) { res.status(404); throw new Error("Utente non trovato"); }

  // Piccola protezione: evita di togliere a te stesso il ruolo admin
  if (self && u.role === "admin" && role !== "admin") {
    res.status(400); throw new Error("Non puoi rimuovere da solo il tuo ruolo admin");
  }

  u.role = role;
  await u.save();
  res.json({ ok: true, user: u });
});

// POST /api/admin/users/:id/can-organize { value: true|false }
const toggleCanOrganize = asyncHandler(async (req, res) => {
  const { value } = req.body || {};
  const v = value === true || value === "true";
  const u = await User.findById(req.params.id);
  if (!u) { res.status(404); throw new Error("Utente non trovato"); }
  u.canOrganize = v;
  await u.save();
  res.json({ ok: true, user: u });
});

module.exports = {
  // Events
  listModerationEvents,
  approveEvent,
  rejectEvent,
  blockEvent,
  unblockEvent,
  forceDeleteEvent,
  // Users
  listUsers,
  banUser,
  unbanUser,
  setUserRole,
  toggleCanOrganize,
};
