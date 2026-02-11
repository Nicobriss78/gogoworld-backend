// backend/controllers/bannerController.js
// Controller Banner — B1/1: fetch attivi con rotazione + tracking impression/click

const { Banner, BannerStatsDaily } = require("../models/bannerModel");
const { logger } = require("../core/logger");

// Cache semplice in RAM con TTL per lista attiva e indice round-robin per chiave
const activeCache = new Map(); // key -> { expiresAt, items: [banner], rr: 0 }
const TTL_MS = 60 * 1000; // 60s: abbastanza breve per B1/1
function requireRole(req, res, roles) {
  if (!req.user || !roles.includes(req.user.role)) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return false;
  }
  return true;
}
function cacheKey({ placement, country, region }) {
  const c = (country || "").toUpperCase();
  const r = region || "";
  return `${placement}::${c}::${r}`;
}

function now() {
  return Date.now();
}

function isAlive(entry) {
  return entry && entry.expiresAt > now();
}

// Normalizza paese a ISO-like maiuscolo (se arriva "it" dal FE)
function normalizeArea(qs) {
  const placement = String(qs.placement || "").trim();
  const country = qs.country ? String(qs.country).trim().toUpperCase() : undefined;
  const region = qs.region ? String(qs.region).trim() : undefined;
  return { placement, country, region };
}

// Filtro “time active”
function timeActiveFilter() {
  return Banner.timeActiveFilter(new Date());
}

// Filtro targeting area: match se (campo non valorizzato) O (campo == richiesta)
function areaFilter(country, region) {
  const clauses = [];
  if (country) {
    clauses.push({ $or: [{ country: null }, { country }] });
  }
  if (region) {
    clauses.push({ $or: [{ region: null }, { region }] });
  }
  return clauses.length ? { $and: clauses } : {};
}

// Aggiorna/imposta stat giornaliera
async function touchDailyStat(bannerId, field /* 'impressions' | 'clicks' */) {
  try {
    const key = BannerStatsDaily.keyFor(bannerId, new Date());
    const inc = field === "clicks" ? { clicks: 1 } : { impressions: 1 };
    await BannerStatsDaily.updateOne(
      key,
      { $setOnInsert: key, $inc: inc },
      { upsert: true }
    );
} catch (err) {
  logger.warn("[BannerStatsDaily] update failed", err);
}
}

// Incremento veloce sui totali
async function incTotals(bannerId, field /* 'impressions' | 'clicks' */) {
  try {
    const inc = field === "clicks" ? { clicksTotal: 1 } : { impressionsTotal: 1 };
    await Banner.updateOne({ _id: bannerId }, { $inc: inc }).lean();
} catch (err) {
  logger.warn("[Banner] totals update failed", err);
}
}

// Seleziona prossimo banner (round-robin) dalla lista in cache
function pickNext(cacheEntry) {
  if (!cacheEntry || !cacheEntry.items || cacheEntry.items.length === 0) return null;
  const idx = cacheEntry.rr % cacheEntry.items.length;
  const picked = cacheEntry.items[idx];
  cacheEntry.rr = (cacheEntry.rr + 1) % cacheEntry.items.length;
  return picked;
}
// Seleziona i prossimi N banner (round-robin) dalla lista in cache, senza duplicati nel batch
function pickNextBatch(cacheEntry, n) {
  if (!cacheEntry || !cacheEntry.items || cacheEntry.items.length === 0) return [];
  const total = cacheEntry.items.length;
  const take = Math.max(1, Math.min(Number(n) || 1, total));

  const out = [];
  for (let i = 0; i < take; i++) {
    const idx = cacheEntry.rr % total;
    out.push(cacheEntry.items[idx]);
    cacheEntry.rr = (cacheEntry.rr + 1) % total;
  }
  return out;
}

/**
 * GET /api/banners/active?placement=home_top&country=IT&region=Basilicata
 * Ritorna UN banner per volta (rotazione round-robin) per placement/area.
 */
exports.getActiveBanners = async (req, res) => {
  try {
    const { placement, country, region } = normalizeArea(req.query);

    if (!placement) {
      return res.status(400).json({ ok: false, error: "placement is required" });
    }

    const key = cacheKey({ placement, country, region });
    let entry = activeCache.get(key);

    // Se cache scaduta o assente: ricarica
    if (!isAlive(entry)) {
      const filter = {
        placement,
        isActive: true,
        status: "ACTIVE",
        ...timeActiveFilter(),
      };

      const area = areaFilter(country, region);
      if (Object.keys(area).length) {
        Object.assign(filter, area);
         // Enforce finestra temporale anche se il model helper cambia naming/logica
       const nowDt = new Date();
       const _and = Array.isArray(filter.$and) ? filter.$and.slice() : [];
       _and.push({ $or: [{ activeFrom: null }, { activeFrom: { $lte: nowDt } }] });
       _and.push({ $or: [{ activeTo: null }, { activeTo: { $gte: nowDt } }] });
       filter.$and = _and;

      }

      // Ordinamento: priority ASC (più piccolo => più rilevante), poi update più recente
      const fresh = await Banner.find(filter)
        .sort({ priority: 1, updatedAt: -1, _id: 1 })
        .lean();

      entry = {
        expiresAt: now() + TTL_MS,
        items: fresh,
        rr: 0,
      };
      activeCache.set(key, entry);
    }

    const picked = pickNext(entry);
    if (!picked) {
      // Nessun banner → 204 No Content per differenziare da errori
      return res.status(204).send();
    }

    // Traccia impression (best-effort)
    touchDailyStat(picked._id, "impressions").catch(() => {});
    incTotals(picked._id, "impressions").catch(() => {});

    // Risposta minimale per FE B1/2
    return res.json({
      ok: true,
      data: {
        id: String(picked._id),
        type: picked.type,
        title: picked.title,
        imageUrl: picked.imageUrl,
        targetUrl: picked.targetUrl,
        placement: picked.placement,
        country: picked.country || null,
        region: picked.region || null,
        priority: picked.priority,
      },
    });
  } catch (err) {
    logger.error("[Banner] getActiveBanners error:", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
};
/**
 * GET /api/banners/active-batch?placement=events_list_inline&country=IT&region=Basilicata&limit=8
 * Ritorna una LISTA di banner (batch) per placement/area, con round-robin equo.
 * Nota: NON incrementiamo impression qui per evitare overcount (rotazione lato FE).
 */
exports.getActiveBannersBatch = async (req, res) => {
  try {
    const { placement, country, region } = normalizeArea(req.query);
    const limitRaw = req.query.limit;
    const limit = Math.max(1, Math.min(parseInt(limitRaw, 10) || 8, 20));

    if (!placement) {
      return res.status(400).json({ ok: false, error: "placement is required" });
    }

    const key = cacheKey({ placement, country, region });
    let entry = activeCache.get(key);

    // Se cache scaduta o assente: ricarica (stessa logica di getActiveBanners)
    if (!isAlive(entry)) {
      const filter = {
        placement,
        isActive: true,
        status: "ACTIVE",
        ...timeActiveFilter(),
      };

      const area = areaFilter(country, region);
      if (Object.keys(area).length) {
        Object.assign(filter, area);
        // Enforce finestra temporale anche se il model helper cambia naming/logica
        const nowDt = new Date();
        const _and = Array.isArray(filter.$and) ? filter.$and.slice() : [];
        _and.push({ $or: [{ activeFrom: null }, { activeFrom: { $lte: nowDt } }] });
        _and.push({ $or: [{ activeTo: null }, { activeTo: { $gte: nowDt } }] });
        filter.$and = _and;
      }

      // Ordinamento: priority ASC (più piccolo => più rilevante), poi update più recente
      const fresh = await Banner.find(filter)
        .sort({ priority: 1, updatedAt: -1, _id: 1 })
        .lean();

      entry = {
        expiresAt: now() + TTL_MS,
        items: fresh,
        rr: 0,
      };
      activeCache.set(key, entry);
    }

    const pickedList = pickNextBatch(entry, limit);
    if (!pickedList || pickedList.length === 0) {
      return res.status(204).send();
    }

    // Payload compatto per FE (array)
    const data = pickedList.map((b) => ({
      id: String(b._id),
      type: b.type,
      title: b.title,
      imageUrl: b.imageUrl,
      targetUrl: b.targetUrl,
      placement: b.placement,
      country: b.country || null,
      region: b.region || null,
      priority: b.priority,
    }));

    return res.json({ ok: true, data });
  } catch (err) {
    logger.error("[Banner] getActiveBannersBatch error:", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
};

/**
 * POST /api/banners/:id/click?redirect=1
 * Incremente il click. Se redirect=1, esegue 302 verso targetUrl.
 */
exports.clickBanner = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ ok: false, error: "id is required" });

    const banner = await Banner.findById(id).select("targetUrl isActive").lean();
    if (!banner) return res.status(404).json({ ok: false, error: "not_found" });

    // Traccia click (best-effort)
    touchDailyStat(id, "clicks").catch(() => {});
    incTotals(id, "clicks").catch(() => {});

    const doRedirect = String(req.query.redirect || "0") === "1";
    if (doRedirect) {
      // Per sicurezza: se niente targetUrl valido, rispondi 204
      if (!banner.targetUrl) return res.status(204).send();
      return res.redirect(302, banner.targetUrl);
    }

    return res.status(204).send(); // NO CONTENT; FE non ha bisogno di payload
  } catch (err) {
    logger.error("[Banner] clickBanner error:", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
};
// ------------------------------------------------------------------
// B1/2 — CRUD & Moderazione
// ------------------------------------------------------------------

// Validazione payload minima
function assertHttpsUrl(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== "https:") return false;
    return true;
  } catch {
    return false;
  }
}

function pick(obj, keys) {
  const out = {};
  keys.forEach(k => {
    if (obj[k] !== undefined) out[k] = obj[k];
  });
  return out;
}

exports.listBannersAdmin = async (req, res) => {
  if (!requireRole(req, res, ["admin"])) return;

  try {
    const q = req.query || {};
    const filter = {};
    if (q.status) filter.status = String(q.status);
    if (q.type) filter.type = String(q.type);
    if (q.source) filter.source = String(q.source);
    if (q.placement) filter.placement = String(q.placement);
    if (q.createdBy) filter.createdBy = q.createdBy;

    const items = await Banner.find(filter).sort({ updatedAt: -1 }).lean();
    return res.json({ ok: true, data: items });
  } catch (err) {
    logger.error("[Banner] listBannersAdmin error:", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
};

// Lista MIEI banner (organizer)
exports.listBannersMine = async (req, res) => {
  if (!requireRole(req, res, ["organizer", "admin"])) return;

  try {
    const q = req.query || {};
    const me = req.user && req.user._id ? req.user._id : null;
    if (!me) return res.status(401).json({ ok: false, error: "not_authorized" });

    const filter = { createdBy: me };
    if (q.status) filter.status = String(q.status);
    if (q.placement) filter.placement = String(q.placement);

    const items = await Banner.find(filter).sort({ updatedAt: -1 }).lean();
    return res.json({ ok: true, data: items });
  } catch (err) {
    logger.error("[Banner] listBannersMine error:", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
};

// Organizer: lista MIEI banner con filtri opzionali
exports.listBannersMine = async (req, res) => {
try {
const me = req.user && req.user._id ? req.user._id : null;
if (!me) return res.status(401).json({ ok:false, error:"not_authorized" });

const q = req.query || {};
const filter = { createdBy: me };
 
// status: accetta 'expired' (logico) oppure gli stati reali (ACTIVE/PAUSED/...)
if (q.status) {
const s = String(q.status).trim().toUpperCase();
if (s === "EXPIRED") {
// gestito sotto con $and (activeTo < now)
} else {
filter.status = s; // es.: ACTIVE, PAUSED, PENDING_REVIEW, SCHEDULED, REJECTED, DRAFT
}
}
if (q.placement) filter.placement = String(q.placement);
 
// Filtro temporale opzionale: intervallo [from,to] (ISO date) + 'expired'
const and = [];
const now = new Date();
if (q.from) {
const from = new Date(q.from);
and.push({ $or: [{ activeTo: null }, { activeTo: { $gte: from } }] }); // non finiti prima di 'from'
}
if (q.to) {
const to = new Date(q.to);
and.push({ $or: [{ activeFrom: null }, { activeFrom: { $lte: to } }] }); // iniziati entro 'to'
}
if (q.status && String(q.status).trim().toUpperCase() === "EXPIRED") {
and.push({ activeTo: { $ne: null, $lt: now } }); // scaduti
}
if (and.length) filter.$and = and;
 
const items = await Banner.find(filter).sort({ updatedAt: -1, priority: 1 }).lean();
// Campo calcolato lato BE: isExpired
const data = items.map(b => {
const exp = !!(b.activeTo && new Date(b.activeTo) < now);
return Object.assign(b, { isExpired: exp });
});
return res.json({ ok:true, data });
} catch (err) {
logger.error("[Banner] listBannersMine error:", err);
return res.status(500).json({ ok:false, error:"internal_error" });
}
};

exports.createBanner = async (req, res) => {
  if (!requireRole(req, res, ["admin"])) return;

  try {
    const body = req.body || {};
    // campi obbligatori minimi
    const required = ["type","source","title","imageUrl","targetUrl","placement"];
    for (const k of required) {
      if (!body[k]) return res.status(400).json({ ok:false, error:`${k} is required` });
    }
    if (!assertHttpsUrl(body.imageUrl) || !assertHttpsUrl(body.targetUrl)) {
      return res.status(400).json({ ok:false, error:"imageUrl and targetUrl must be https://" });
    }

    const doc = new Banner({
      type: body.type,
      source: body.source,
      status: body.status || "DRAFT",
      eventId: body.eventId || null,
      title: String(body.title).trim(),
      imageUrl: String(body.imageUrl).trim(),
      targetUrl: String(body.targetUrl).trim(),
      placement: body.placement,
      country: body.country || null,
      region: body.region || null,
      isActive: body.isActive !== undefined ? !!body.isActive : true,
      activeFrom: body.activeFrom || null,
      activeTo: body.activeTo || null,
      priority: body.priority !== undefined ? Number(body.priority) : 100,
      createdBy: req.user && req.user._id ? req.user._id : null,
      notes: body.notes || ""
    });

    await doc.save();
    return res.status(201).json({ ok:true, data:{ id: String(doc._id) }});
  } catch (err) {
    logger.error("[Banner] create error:", err);
    return res.status(500).json({ ok:false, error:"internal_error" });
  }
};

exports.updateBanner = async (req, res) => {
  if (!requireRole(req, res, ["admin"])) return;

  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ ok:false, error:"id is required" });
    const body = req.body || {};
    const up = pick(body, [
      "type","source","status","eventId","title","imageUrl","targetUrl",
      "placement","country","region","isActive","activeFrom","activeTo","priority","notes"
    ]);
    if (up.imageUrl && !assertHttpsUrl(up.imageUrl)) {
      return res.status(400).json({ ok:false, error:"imageUrl must be https://" });
    }
    if (up.targetUrl && !assertHttpsUrl(up.targetUrl)) {
      return res.status(400).json({ ok:false, error:"targetUrl must be https://" });
    }

    const r = await Banner.updateOne({ _id:id }, { $set: up });
    if (r.matchedCount === 0) return res.status(404).json({ ok:false, error:"not_found" });
    return res.status(204).send();
  } catch (err) {
    logger.error("[Banner] update error:", err);
    return res.status(500).json({ ok:false, error:"internal_error" });
  }
};

exports.deleteBanner = async (req, res) => {
  if (!requireRole(req, res, ["admin"])) return;

  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ ok:false, error:"id is required" });
    const r = await Banner.deleteOne({ _id:id });
    if (r.deletedCount === 0) return res.status(404).json({ ok:false, error:"not_found" });
    return res.status(204).send();
  } catch (err) {
    logger.error("[Banner] delete error:", err);
    return res.status(500).json({ ok:false, error:"internal_error" });
  }
};

// Moderazione (solo admin)
exports.approveBanner = async (req, res) => {
  if (!requireRole(req, res, ["admin"])) return;

  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ ok:false, error:"id is required" });

    const b = await Banner.findById(id).select("activeFrom activeTo").lean();
    if (!b) return res.status(404).json({ ok:false, error:"not_found" });

    const now = new Date();
    let nextStatus = "ACTIVE";
    if (b.activeFrom && new Date(b.activeFrom) > now) nextStatus = "SCHEDULED";

const updated = await Banner.findOneAndUpdate(
  { _id: id, status: "PENDING_REVIEW" },
  { $set: { status: nextStatus, isActive: true, approvedAt: new Date() } },
  { new: true }
);
if (!updated) {
  return res.status(404).json({ ok: false, error: "already_processed_or_missing" });
}
    return res.status(204).send();
  } catch (err) {
    logger.error("[Banner] approve error:", err);
    return res.status(500).json({ ok:false, error:"internal_error" });
  }
};

exports.rejectBanner = async (req, res) => {
  if (!requireRole(req, res, ["admin"])) return;

  try {
    
    const id = req.params.id;
    if (!id) return res.status(400).json({ ok:false, error:"id is required" });
    await Banner.updateOne({ _id:id }, { $set: { status:"REJECTED", isActive:false }});
    return res.status(204).send();
  } catch (err) {
    logger.error("[Banner] reject error:", err);
    return res.status(500).json({ ok:false, error:"internal_error" });
  }
};

exports.pauseBanner = async (req, res) => {
  if (!requireRole(req, res, ["admin"])) return;

  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ ok:false, error:"id is required" });
    await Banner.updateOne({ _id:id }, { $set: { status:"PAUSED", isActive:false }});
    return res.status(204).send();
  } catch (err) {
    logger.error("[Banner] pause error:", err);
    return res.status(500).json({ ok:false, error:"internal_error" });
  }
};

exports.resumeBanner = async (req, res) => {
  if (!requireRole(req, res, ["admin"])) return;

  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ ok:false, error:"id is required" });

    const b = await Banner.findById(id).select("activeFrom activeTo").lean();
    if (!b) return res.status(404).json({ ok:false, error:"not_found" });

    const now = new Date();
    let nextStatus = "ACTIVE";
    if (b.activeFrom && new Date(b.activeFrom) > now) nextStatus = "SCHEDULED";

    await Banner.updateOne({ _id:id }, { $set: { status: nextStatus, isActive:true }});
    return res.status(204).send();
  } catch (err) {
    logger.error("[Banner] resume error:", err);
    return res.status(500).json({ ok:false, error:"internal_error" });
  }
};
// Organizer — submit banner request
exports.submitBannerRequest = async (req, res) => {
  if (!requireRole(req, res, ["organizer", "admin"])) return;

  try {
    const body = req.body || {};
    const required = ["title", "imageUrl", "targetUrl", "placement"];
    for (const k of required) {
      if (!body[k]) return res.status(400).json({ ok:false, error:`${k} is required` });
    }

    // Consenti solo URL https
    const isHttps = (u) => { try { const x = new URL(String(u)); return x.protocol === "https:"; } catch { return false; } };
    if (!isHttps(body.imageUrl) || !isHttps(body.targetUrl)) {
      return res.status(400).json({ ok:false, error:"imageUrl and targetUrl must be https://" });
    }

    const doc = new Banner({
      type: "event_promo",
      source: "organizer",
      status: "PENDING_REVIEW",
      eventId: body.eventId || null,
      title: String(body.title).trim(),
      imageUrl: String(body.imageUrl).trim(),
      targetUrl: String(body.targetUrl).trim(),
      placement: body.placement,
      country: body.country || null,
      region: body.region || null,
      isActive: true,
      activeFrom: body.activeFrom || null,
      activeTo: body.activeTo || null,
      priority: body.priority !== undefined ? Number(body.priority) : 100,
      createdBy: req.user && req.user._id ? req.user._id : null,
      notes: body.notes || ""
    });

    await doc.save();
    return res.status(201).json({ ok:true, data:{ id: String(doc._id) }});
  } catch (err) {
    logger.error("[Banner] submitBannerRequest error:", err);
    return res.status(500).json({ ok:false, error:"internal_error" });
  }
};
