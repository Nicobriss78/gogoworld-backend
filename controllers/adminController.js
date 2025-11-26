// backend/controllers/adminController.js
// Admin Dashboard — Moderazione Eventi & Gestione Utenti
// Requisiti: middleware protect + authorize("admin") a monte

const asyncHandler = require("express-async-handler");
const Event = require("../models/eventModel");
const User = require("../models/userModel");
const Activity = require("../models/activityModel");
const { notify } = require("../services/notifications");
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
// Admin Action Logger (container-friendly: STDOUT JSON)
// -----------------------------
function logAdmin(action, data) {
  try {
    const payload = {
      evt: "admin_action",
      action,
      ...data,
      ts: Date.now(),
    };
    console.log(JSON.stringify(payload));
  } catch (_) {
    // non bloccare il flusso in caso di errori di log
  }
}

// Activity helper: non blocca mai il flusso admin
async function safeCreateActivity(payload) {
  try {
    const doc = new Activity(payload);
    await doc.save();
    return doc;
  } catch (err) {
    console.error(
      "[activity] failed to create Activity from adminController:",
      err?.message || err
    );
    return null;
  }
}

// -----------------------------
// Eventi — Moderazione
// -----------------------------

// GET /api/admin/events?approvalStatus=&q=&organizerId=&region=&category=...
const listModerationEvents = asyncHandler(async (req, res) => {
  const q = req.query || {};
  const where = {};

  // Filtri tassonomici/geografici opzionali
 ["region","country","city","category","subcategory","type","language","target"].forEach(k => {
    if (q[k]) where[k] = q[k];
  });
// VISIBILITY esplicita: mappa su isPrivate quando vale "public"/"private",
  // altrimenti consenti filtro diretto su "draft"
  if (q.visibility) {
    const v = String(q.visibility).toLowerCase().trim();
    if (v === "public") {
      where.isPrivate = false; // tutti gli eventi pubblici
    } else if (v === "private") {
      where.isPrivate = true; // tutti i privati (anche se il campo visibility non è perfettamente allineato)
    } else if (v === "draft") {
      where.visibility = "draft"; // bozza rimane su stringa visibility
    }
  }

  if (q.approvalStatus) where.approvalStatus = String(q.approvalStatus).toLowerCase().trim();
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

// Dedup alla fonte: in casi particolari la query testuale può “toccare” più campi,
// ma non vogliamo rischi di doppioni; usiamo una aggregazione con $group su _id.
const eventsAgg = await Event.aggregate([
{ $match: where },
{ $sort: { approvalStatus: 1, dateStart: 1, createdAt: -1 } },
{ $group: { _id: "$_id", doc: { $first: "$$ROOT" } } },
{ $replaceRoot: { newRoot: "$doc" } },
]);
res.json({ ok: true, events: eventsAgg });
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
  if (!ev) {
    res.status(404);
    throw new Error("Evento non trovato");
  }

  // PATCH BE: quando approvo, azzero eventuale motivo/nota precedente
  ev.approvalStatus = "approved";
  ev.moderation = {
    reason: undefined,
    notes: undefined,
    updatedBy: req.user._id,
    updatedAt: now(),
  };

  // Prima approvazione? (usiamo approvedAt come flag di idempotenza)
  const isFirstApproval = !ev.approvedAt;
  if (isFirstApproval) {
    ev.approvedAt = now();
  }

  await ev.save();

  // BACHECA ATTIVITÀ — created_event: solo alla prima approvazione
  if (isFirstApproval && ev.organizer) {
    await safeCreateActivity({
      type: "created_event",
      user: ev.organizer,
      event: ev._id,
      meta: {
        title: ev.title || "",
        dateStart: ev.dateStart || null,
        city: ev.city || "",
        region: ev.region || "",
        country: ev.country || "",
      },
    });
  }

  await notify("event_approved", {
    eventId: ev?._id?.toString?.() || String(ev?._id || ""),
    organizerId: ev?.organizer?.toString?.() || String(ev?.organizer || ""),
    adminId: req?.user?._id?.toString?.() || String(req?.user?._id || ""),
  });

  logAdmin("event_approved", {
    eventId: String(ev?._id || ""),
    adminId: String(req?.user?._id || ""),
  });

  res.json({ ok: true, event: ev });
});

// POST /api/admin/events/:id/unapprove
const unapproveEvent = asyncHandler(async (req, res) => {
  const ev = await Event.findById(req.params.id);
  if (!ev) { res.status(404); throw new Error("Evento non trovato"); }

  // Revoca approvazione → torna in revisione (pending)
  ev.approvalStatus = "pending";

  // Come in unblock: riparto pulito (reset di reason/notes) e traccio chi ha fatto l’azione
  ev.moderation = {
    reason: undefined,
    notes: undefined,
    updatedBy: req.user._id,
    updatedAt: now(),
  };

  await ev.save();
  await notify("event_unapproved", {
    eventId: ev?._id?.toString?.() || String(ev?._id || ""),
    organizerId: ev?.organizer?.toString?.() || String(ev?.organizer || ""),
    adminId: req?.user?._id?.toString?.() || String(req?.user?._id || ""),
  });
logAdmin("event_unapproved", {
    eventId: String(ev?._id || ""),
    adminId: String(req?.user?._id || "")
  });
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
  await notify("event_rejected", {
    eventId: ev?._id?.toString?.() || String(ev?._id || ""),
    reason: (req?.body?.reason || "").toString().trim(),
    adminId: req?.user?._id?.toString?.() || String(req?.user?._id || ""),
  });
logAdmin("event_rejected", {
    eventId: String(ev?._id || ""),
    adminId: String(req?.user?._id || "")
  });

  res.json({ ok: true, event: ev });
});

// POST /api/admin/events/:id/block
const blockEvent = asyncHandler(async (req, res) => {
  const ev = await Event.findById(req.params.id);
  if (!ev) { res.status(404); throw new Error("Evento non trovato"); }
  // PATCH BE: motivo blocco obbligatorio
  const reason = (req.body && typeof req.body.reason === "string") ? req.body.reason.trim() : "";
  if (!reason) {
    return res.status(400).json({ ok: false, error: "Motivo blocco obbligatorio" });
  }
  // Registra moderazione con motivo
  ev.approvalStatus = "blocked";
  ev.moderation = {
    reason,
    notes: req.body && typeof req.body.notes === "string" ? req.body.notes.trim() : undefined,
    updatedBy: req.user._id,
    updatedAt: now(),
  };
  await ev.save();
  await notify("event_blocked", {
    eventId: ev?._id?.toString?.() || String(ev?._id || ""),
    reason: ev?.moderation?.reason || "",
    adminId: req?.user?._id?.toString?.() || String(req?.user?._id || ""),
  });
logAdmin("event_blocked", {
    eventId: String(ev?._id || ""),
    adminId: String(req?.user?._id || "")
  });

  res.json({ ok: true, event: ev });
});

// POST /api/admin/events/:id/unblock
const unblockEvent = asyncHandler(async (req, res) => {
  const ev = await Event.findById(req.params.id);
  if (!ev) { res.status(404); throw new Error("Evento non trovato"); }
  // PATCH (Workflow): sblocco → torna in revisione (pending), non approved diretto
  ev.approvalStatus = "pending";
  // PATCH BE: quando sblocco, riparto pulito (pending senza motivi residui)
  ev.moderation = {
    reason: undefined,
    notes: undefined,
    updatedBy: req.user._id,
    updatedAt: now(),
  };
  await ev.save();
  await notify("event_unblocked", {
    eventId: ev?._id?.toString?.() || String(ev?._id || ""),
    adminId: req?.user?._id?.toString?.() || String(req?.user?._id || ""),
  });
logAdmin("event_unblocked", {
    eventId: String(ev?._id || ""),
    adminId: String(req?.user?._id || "")
  });

  res.json({ ok: true, event: ev });
});

// DELETE /api/admin/events/:id/force
const forceDeleteEvent = asyncHandler(async (req, res) => {
  const ev = await Event.findById(req.params.id);
  if (!ev) { res.status(404); throw new Error("Evento non trovato"); }
  await ev.deleteOne();
  await notify("event_force_deleted", {
    eventId: ev?._id?.toString?.() || String(ev?._id || ""),
    adminId: req?.user?._id?.toString?.() || String(req?.user?._id || ""),
  });
logAdmin("event_force_deleted", {
    eventId: String(ev?._id || ""),
    adminId: String(req?.user?._id || "")
  });
  res.json({ ok: true, message: "Evento eliminato definitivamente" });
});

// POST /api/admin/import/events
// Import CSV con deduplica (no doppioni) e supporto "simulate" (validazione).
const adminImportEvents = asyncHandler(async (req, res) => {
  // Necessita di multer a monte: upload.single('csv')
  if (!req.file || !req.file.buffer) {
    res.status(400);
    throw new Error("CSV mancante (campo: csv)");
  }

  // parse CSV
  const { parse } = require("csv-parse/sync");
  let rows;
  try {
    rows = parse(req.file.buffer, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (e) {
    res.status(400);
    throw new Error("CSV non valido");
  }

  const simulate =
    req.body.simulate === true ||
    req.body.simulate === "true" ||
    req.body.simulate === "1";

  const results = [];
  let created = 0;
  let skipped = 0;

  // helper
  const toDate = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  };
  const norm = (s) => String(s || "").trim();
  const lc = (s) => norm(s).toLowerCase();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const lineNo = i + 2; // 1 = header

    try {
      const title = norm(r.title || r.titolo);
      const dateStart = toDate(r.dateStart || r.start || r.dataInizio);
      const dateEnd = toDate(r.dateEnd || r.end || r.dataFine);
      const city = norm(r.city || r.citta);
      const region = norm(r.region || r.regione);
      const country = norm(r.country || r.paese || "IT");

      if (!title) throw new Error("title mancante");
      if (!dateStart) throw new Error("dateStart non valida");
      if (!city) throw new Error("city mancante");

      // chiave deduplica: title + dateStart + city
      const dup = await Event.findOne({
        title,
        city,
        dateStart,
      }).lean();

      if (dup) {
        skipped++;
        results.push({ line: lineNo, status: "skipped", reason: "duplicato" });
        continue;
      }
// --- PATCH GEO: normalizza lat/lon da CSV (accetta virgole e alias) ---
        const latRaw = r.lat ?? r.latitude ?? r.latitudine ?? "";
        const lonRaw = r.lon ?? r.lng ?? r.long ?? r.longitude ?? r.longitudine ?? "";
        const latNum = String(latRaw).replace(",", ".").trim();
        const lonNum = String(lonRaw).replace(",", ".").trim();
        const lat = latNum !== "" && !isNaN(parseFloat(latNum)) ? parseFloat(latNum) : undefined;
        const lon = lonNum !== "" && !isNaN(parseFloat(lonNum)) ? parseFloat(lonNum) : undefined;
        // --- END PATCH GEO ---
const payload = {
          title,
          description: norm(r.description || r.descrizione),
          organizerName: norm(r.organizerName || r.organizzatore || ""),
          organizer: req.user?._id || null,
          visibility: r.visibility ? lc(r.visibility) : "public",
          language: r.language ? lc(r.language) : "it",
          target: r.target ? lc(r.target) : "tutti",
          category: norm(r.category || ""),
          subcategory: norm(r.subcategory || ""),
          type: norm(r.type || ""),
          city,
          region,
          country,
          dateStart,
          dateEnd: dateEnd || dateStart,
          price: norm(r.price || r.prezzo || "Gratuito"),
          approvalStatus: r.approvalStatus ? lc(r.approvalStatus) : "pending",
          createdBy: req.user?._id || null,
          ...(lat !== undefined ? { lat } : {}),
          ...(lon !== undefined ? { lon } : {}),
          ...(lat !== undefined && lon !== undefined
              ? { location: { type: "Point", coordinates: [lon, lat] } }
              : {}),
        };

      if (!simulate) {
        const doc = await Event.create(payload);
        created++;
        results.push({ line: lineNo, status: "ok", id: String(doc._id) });
      } else {
        results.push({ line: lineNo, status: "ok", simulate: true });
      }
    } catch (err) {
      results.push({ line: lineNo, status: "error", errors: [String(err.message || err)] });
    }
  }

  res.json({
    ok: true,
    dryRun: !!simulate,
    created,
    skipped,
    rows: results,
  });
});

// -----------------------------
// Utenti — Gestione
// -----------------------------

// GET /api/admin/users?q=&role=&canOrganize=&isBanned=
const listUsers = asyncHandler(async (req, res) => {
const q = req.query || {};
const where = {};
 
if (q.role) where.role = q.role;
if (q.canOrganize !== undefined && q.canOrganize !== "")
where.canOrganize = q.canOrganize === "true" || q.canOrganize === true;
if (q.isBanned !== undefined && q.isBanned !== "")
where.isBanned = q.isBanned === "true" || q.isBanned === true;
if (q.status) where.status = q.status;

if (q.q) {
const rx = likeRx(q.q);
where.$or = [{ name: rx }, { email: rx }];
}

if (q.scoreMin || q.scoreMax) {
const scoreFilter = {};
if (q.scoreMin) scoreFilter.$gte = Number(q.scoreMin);
if (q.scoreMax) scoreFilter.$lte = Number(q.scoreMax);
where.score = scoreFilter;
}

const page = Math.max(parseInt(q.page) || 1, 1);
const limit = Math.min(parseInt(q.limit) || 20, 100);
const skip = (page - 1) * limit;
 
const total = await User.countDocuments(where);
const users = await User.find(where)
.sort({ role: 1, canOrganize: -1, createdAt: -1 })
.skip(skip)
.limit(limit);

res.json({
ok: true,
page,
limit,
total,
totalPages: Math.ceil(total / limit),
users,
});
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

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT — identico, con soli alias per allineare i nomi attesi dalle routes
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/users/export.csv — export coerente ai filtri (stream)
// CSV helper senza dipendenze esterne
function toCsv(rows) {
if (!rows || !rows.length) return "";
const headers = Object.keys(rows[0]);
const esc = (v) => {
if (v === null || v === undefined) v = "";
v = String(v);
if (/[",\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
return v;
};
const out = [];
out.push(headers.join(","));
for (const r of rows) out.push(headers.map(h => esc(r[h])).join(","));
return out.join("\n");
}

const exportUsersCsv = asyncHandler(async (req, res) => {
const q = req.query || {};
const where = {};
 
if (q.role) where.role = q.role;
if (q.canOrganize !== undefined && q.canOrganize !== "")
where.canOrganize = q.canOrganize === "true" || q.canOrganize === true;
if (q.isBanned !== undefined && q.isBanned !== "")
where.isBanned = q.isBanned === "true" || q.isBanned === true;
if (q.status) where.status = q.status;
 
if (q.q) {
const rx = likeRx(q.q);
where.$or = [{ name: rx }, { email: rx }];
}
 
if (q.scoreMin || q.scoreMax) {
const scoreFilter = {};
if (q.scoreMin) scoreFilter.$gte = Number(q.scoreMin);
if (q.scoreMax) scoreFilter.$lte = Number(q.scoreMax);
where.score = scoreFilter;
}

const users = await User.find(where).sort({ createdAt: -1 }).lean();
const rows = users.map(u => ({
id: u._id,
name: u.name,
email: u.email,
role: u.role,
status: u.status,
score: u.score,
canOrganize: u.canOrganize,
isBanned: u.isBanned,
createdAt: u.createdAt,
}));
const csv = toCsv(rows);

res.setHeader("Content-Type", "text/csv");
res.setHeader("Content-Disposition", "attachment; filename=\"users.csv\"");
res.send(csv);
});

module.exports = {
  // Events
  listModerationEvents,
  approveEvent,
  unapproveEvent,
  rejectEvent,
  blockEvent,
  unblockEvent,
  forceDeleteEvent,
  adminImportEvents, // nome interno
  importEventsCsv: adminImportEvents, // ← alias per le routes

  // Users
  listUsers,
  exportUsersCsv,
  banUser,
  unbanUser,
  setUserRole,
  toggleCanOrganize, // nome interno
  setUserCanOrganize: toggleCanOrganize, // ← alias per le routes
};

