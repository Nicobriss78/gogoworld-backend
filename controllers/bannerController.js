// backend/controllers/bannerController.js
// Controller Banner — B1/1: fetch attivi con rotazione + tracking impression/click

const { Banner, BannerStatsDaily } = require("../models/bannerModel");
const { logger } = require("../core/logger");
const {
estimateBannerPrice,
normalizeGeoTarget,
} = require("../services/bannerPricingService");
const {
checkPromoAvailability,
} = require("../services/promoAvailabilityService");
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
const PROMO_FIXED_STATUSES = new Set([
  "DRAFT",
  "PENDING_REVIEW",
  "PENDING_PAYMENT",
  "AWAITING_PAYMENT",
  "PAUSED",
  "REJECTED",
  "CANCELLED",
  "INVALIDATED_BY_EVENT_CHANGE",
]);

function getEffectivePromoStatus(banner, nowDate = new Date()) {
  const persistedStatus = String(banner?.status || "").toUpperCase();

  if (PROMO_FIXED_STATUSES.has(persistedStatus)) {
    return persistedStatus;
  }

  if (persistedStatus !== "SCHEDULED" && persistedStatus !== "ACTIVE") {
    return persistedStatus || "DRAFT";
  }

  const activeFrom = banner?.activeFrom ? new Date(banner.activeFrom) : null;
  const activeTo = banner?.activeTo ? new Date(banner.activeTo) : null;

  if (activeTo && activeTo <= nowDate) {
    return "ENDED";
  }

  if (activeFrom && activeFrom > nowDate) {
    return "SCHEDULED";
  }

  return "ACTIVE";
}

function enrichPromoLifecycle(banner, nowDate = new Date()) {
  if (!banner) return banner;

  const persistedStatus = String(banner.status || "").toUpperCase();
  const effectiveStatus = getEffectivePromoStatus(banner, nowDate);

  return {
    ...banner,
    persistedStatus,
    status: effectiveStatus,
    isExpired: effectiveStatus === "ENDED",
    isActive: effectiveStatus === "ACTIVE",
  };
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

// Organizer: lista MIEI banner con filtri opzionali
exports.listBannersMine = async (req, res) => {
try {
const me = req.user && req.user._id ? req.user._id : null;
if (!me) return res.status(401).json({ ok:false, error:"not_authorized" });

const q = req.query || {};
const filter = { createdBy: me };
 
// status: accetta stati DB diretti oppure stati lifecycle calcolati
const requestedStatus = q.status
  ? String(q.status).trim().toUpperCase()
  : "";

if (requestedStatus) {
  const directDbStatuses = [
    "DRAFT",
    "PENDING_REVIEW",
    "PENDING_PAYMENT",
    "AWAITING_PAYMENT",
    "PAUSED",
    "REJECTED",
    "CANCELLED",
    "INVALIDATED_BY_EVENT_CHANGE",
  ];

  if (directDbStatuses.includes(requestedStatus)) {
    filter.status = requestedStatus;
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
 
const items = await Banner.find(filter)
.sort({ updatedAt: -1, priority: 1 })
.populate("eventId", "title nome dateStart dateEnd")
.lean();
  
// Campo calcolato lato BE: isExpired
let data = items.map((b) => enrichPromoLifecycle(b, now));

if (requestedStatus && ["SCHEDULED", "ACTIVE", "ENDED"].includes(requestedStatus)) {
data = data.filter((b) => b.status === requestedStatus);
}

return res.json({ ok:true, data });
} catch (err) {
logger.error("[Banner] listBannersMine error:", err);
return res.status(500).json({ ok:false, error:"internal_error" });
}
};
// Organizer: dettaglio di un mio banner
exports.getBannerMineById = async (req, res) => {
  try {
    const me = req.user && req.user._id ? req.user._id : null;
    if (!me) {
      return res.status(401).json({ ok: false, error: "not_authorized" });
    }

    const bannerId = req.params.id;

    const item = await Banner.findOne({
      _id: bannerId,
      createdBy: me,
    })
      .populate("eventId", "title nome dateStart dateEnd")
      .lean();

    if (!item) {
      return res.status(404).json({
        ok: false,
        error: "banner_not_found",
      });
    }

    const now = new Date();

return res.json({
  ok: true,
  data: enrichPromoLifecycle(item, now),
});
  } catch (err) {
    logger.error("[Banner] getBannerMineById error:", err);
    return res.status(500).json({
      ok: false,
      error: "internal_error",
    });
  }
};
// Organizer: ritira una mia richiesta promo ancora in revisione
exports.withdrawBannerMine = async (req, res) => {
  try {
    const me = req.user && req.user._id ? req.user._id : null;
    if (!me) {
      return res.status(401).json({ ok: false, error: "not_authorized" });
    }

    const bannerId = req.params.id;
    if (!bannerId) {
      return res.status(400).json({ ok: false, error: "id is required" });
    }

    const reason =
      req.body && typeof req.body.reason === "string"
        ? req.body.reason.trim().slice(0, 500)
        : "";

    const updated = await Banner.findOneAndUpdate(
      {
        _id: bannerId,
        createdBy: me,
        source: "organizer",
        type: "event_promo",
        status: "PENDING_REVIEW",
      },
      {
        $set: {
          status: "CANCELLED",
          isActive: false,
          paymentStatus: "NOT_REQUIRED",
          cancelledAt: new Date(),
          cancelledBy: me,
          cancelledReason: reason || null,
        },
      },
      { new: true }
    )
      .populate("eventId", "title nome dateStart dateEnd")
      .lean();

    if (!updated) {
      return res.status(409).json({
        ok: false,
        error: "withdraw_not_allowed",
        message: "La promozione può essere ritirata solo se è ancora in revisione.",
      });
    }

    const now = new Date();

return res.json({
ok: true,
data: enrichPromoLifecycle(updated, now),
});
  } catch (err) {
    logger.error("[Banner] withdrawBannerMine error:", err);
    return res.status(500).json({
      ok: false,
      error: "internal_error",
    });
  }
};
// Organizer/Admin TEST: simula pagamento promo in attesa pagamento
// Non è un checkout reale: serve solo per testare il lifecycle payment-ready.
exports.payTestBannerMine = async (req, res) => {
  try {
    const me = req.user && req.user._id ? req.user._id : null;
    if (!me) {
      return res.status(401).json({ ok: false, error: "not_authorized" });
    }

    const bannerId = req.params.id;
    if (!bannerId) {
      return res.status(400).json({ ok: false, error: "id is required" });
    }

    const now = new Date();

    const promo = await Banner.findOne({
      _id: bannerId,
      createdBy: me,
      source: "organizer",
      type: "event_promo",
      status: "PENDING_PAYMENT",
    }).lean();

    if (!promo) {
      return res.status(409).json({
        ok: false,
        error: "pay_test_not_allowed",
        message: "Il pagamento test è disponibile solo per promozioni in attesa di pagamento.",
      });
    }

    const nextStatus = getEffectivePromoStatus(
{
...promo,
status: "ACTIVE",
},
now
);

    const paymentIntentId = `TEST_${bannerId}_${now.getTime()}`;

    const updated = await Banner.findOneAndUpdate(
      {
        _id: bannerId,
        createdBy: me,
        source: "organizer",
        type: "event_promo",
        status: "PENDING_PAYMENT",
      },
      {
        $set: {
          status: nextStatus,
          isActive: nextStatus === "ACTIVE" || nextStatus === "SCHEDULED",
          paymentStatus: "PAID",
          paymentProvider: "TEST",
          paymentIntentId,
          paidAt: now,
          paymentTestAt: now,
          paymentTestBy: me,
          scheduledAt: nextStatus === "SCHEDULED" ? now : null,
        },
      },
      { new: true }
    )
      .populate("eventId", "title nome dateStart dateEnd")
      .lean();

    return res.json({
ok: true,
data: enrichPromoLifecycle(updated, now),
});
  } catch (err) {
    logger.error("[Banner] payTestBannerMine error:", err);
    return res.status(500).json({
      ok: false,
      error: "internal_error",
    });
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

    const updated = await Banner.findOneAndUpdate(
      { _id: id, status: "PENDING_REVIEW" },
      {
        $set: {
          status: "PENDING_PAYMENT",
          paymentStatus: "PENDING",
          isActive: false,
          approvedAt: new Date(),
        },
      },
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

    await Banner.updateOne(
      { _id: id, status: "PENDING_REVIEW" },
      {
        $set: {
          status: "REJECTED",
          isActive: false,
          paymentStatus: "NOT_REQUIRED",
          rejectedAt: new Date(),
        },
      }
    );

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

    await Banner.updateOne(
      { _id:id },
      {
        $set: {
          status:"PAUSED",
          isActive:false,
        },
      }
    );

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

    const b = await Banner.findById(id).select("activeFrom activeTo status").lean();
if (!b) return res.status(404).json({ ok:false, error:"not_found" });

const now = new Date();
const nextStatus = getEffectivePromoStatus(
{
...b,
status: "ACTIVE",
},
now
);

await Banner.updateOne(
{ _id:id },
{
$set: {
status: nextStatus,
isActive: nextStatus === "ACTIVE" || nextStatus === "SCHEDULED",
},
}
);
    return res.status(204).send();
  } catch (err) {
    logger.error("[Banner] resume error:", err);
    return res.status(500).json({ ok:false, error:"internal_error" });
  }
};
// Admin/Test — simula pagamento promozione
exports.markPaidBanner = async (req, res) => {
  if (!requireRole(req, res, ["admin"])) return;

  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ ok:false, error:"id is required" });

    const banner = await Banner.findOne({ _id: id, status: "PENDING_PAYMENT" })
      .select("activeFrom activeTo")
      .lean();

    if (!banner) {
      return res.status(404).json({
        ok:false,
        error:"not_found_or_not_pending_payment",
      });
    }

    const now = new Date();
const nextStatus = getEffectivePromoStatus(
{
...banner,
status: "ACTIVE",
},
now
);

    const updated = await Banner.findOneAndUpdate(
      { _id: id, status: "PENDING_PAYMENT" },
      {
        $set: {
          paymentStatus: "PAID",
          paidAt: new Date(),
          status: nextStatus,
          isActive: nextStatus === "ACTIVE" || nextStatus === "SCHEDULED",
        },
      },
      { new: true }
    );

    return res.json({
      ok:true,
      data:{
        id: String(updated._id),
        status: updated.status,
        paymentStatus: updated.paymentStatus,
        paidAt: updated.paidAt,
      },
    });
  } catch (err) {
    logger.error("[Banner] markPaidBanner error:", err);
    return res.status(500).json({ ok:false, error:"internal_error" });
  }
};
// Organizer — stima prezzo promozione
exports.estimateBannerRequest = async (req, res) => {
if (!requireRole(req, res, ["organizer", "admin"])) return;

try {
const estimate = estimateBannerPrice(req.body || {});

return res.json({
ok: true,
data: {
estimatedPrice: estimate.estimatedPrice,
currency: estimate.currency,
pricingSnapshot: estimate.pricingSnapshot,
geoTarget: estimate.normalizedTarget,
},
});
} catch (err) {
logger.warn("[Banner] estimateBannerRequest validation error:", err);
return res.status(err.statusCode || 400).json({
ok: false,
error: err.code || "invalid_estimate_payload",
message: err.message || "Invalid estimate payload",
});
}
};
// Organizer — analisi disponibilità + preventivo promo
exports.analyzeBannerRequest = async (req, res) => {
if (!requireRole(req, res, ["organizer", "admin"])) return;

try {
const body = req.body || {};

const estimate = estimateBannerPrice(body);
const availability = await checkPromoAvailability(body);

return res.json({
ok: true,
data: {
valid: true,
validationErrors: [],
pricing: {
estimatedPrice: estimate.estimatedPrice,
currency: estimate.currency,
pricingSnapshot: estimate.pricingSnapshot,
geoTarget: estimate.normalizedTarget,
},
availability,
},
});
} catch (err) {
logger.warn("[Banner] analyzeBannerRequest validation error:", err);

return res.status(err.statusCode || 400).json({
ok: false,
data: {
valid: false,
validationErrors: [err.code || "ANALYZE_FAILED"],
},
error: err.code || "invalid_analyze_payload",
message: err.message || "Invalid analyze payload",
});
}
};
// Organizer — submit banner request
exports.submitBannerRequest = async (req, res) => {
if (!requireRole(req, res, ["organizer", "admin"])) return;

try {
const body = req.body || {};
const required = ["eventId", "title", "imageUrl", "targetUrl", "placement", "activeFrom", "activeTo"];
for (const k of required) {
if (!body[k]) return res.status(400).json({ ok:false, error:`${k} is required` });
}

// Consenti solo URL https
const isHttps = (u) => {
try {
const x = new URL(String(u));
return x.protocol === "https:";
} catch {
return false;
}
};

if (!isHttps(body.imageUrl) || !isHttps(body.targetUrl)) {
return res.status(400).json({ ok:false, error:"imageUrl and targetUrl must be https://" });
}

const estimate = estimateBannerPrice(body);
const availability = await checkPromoAvailability(body);

if (!availability || availability.available === false) {
  return res.status(409).json({
    ok: false,
    error: "PLACEMENT_CAPACITY_EXCEEDED",
    message: "No promotional availability for the selected period",
    data: {
      valid: false,
      validationErrors: ["PLACEMENT_CAPACITY_EXCEEDED"],
      availability,
    },
  });
}

const geoTarget = estimate.normalizedTarget || normalizeGeoTarget(body);
const normalizedActiveFrom = availability.activeFrom
  ? new Date(`${availability.activeFrom}T00:00:00.000Z`)
  : body.activeFrom;
const normalizedActiveTo = availability.exclusiveActiveTo
  ? new Date(`${availability.exclusiveActiveTo}T00:00:00.000Z`)
  : body.activeTo;

const requestKey = [
  req.user && req.user._id ? String(req.user._id) : "unknown",
  String(body.eventId || ""),
  String(body.placement || ""),
  String(geoTarget.geoScope || ""),
  String(geoTarget.country || ""),
  String(geoTarget.region || ""),
  normalizedActiveFrom instanceof Date ? normalizedActiveFrom.toISOString() : String(normalizedActiveFrom || ""),
  normalizedActiveTo instanceof Date ? normalizedActiveTo.toISOString() : String(normalizedActiveTo || ""),
].join("::");

const existingRequest = await Banner.findOne({
  requestKey,
  status: { $in: ["PENDING_REVIEW", "PENDING_PAYMENT", "SCHEDULED", "ACTIVE"] },
}).lean();

if (existingRequest) {
  return res.status(200).json({
    ok: true,
    data: {
      id: String(existingRequest._id),
      status: existingRequest.status,
      paymentStatus: existingRequest.paymentStatus,
      estimatedPrice: existingRequest.estimatedPrice,
      currency: existingRequest.currency,
      pricingSnapshot: existingRequest.pricingSnapshot,
      duplicate: true,
    },
  });
}

const doc = new Banner({
type: "event_promo",
source: "organizer",
status: "PENDING_REVIEW",
eventId: body.eventId,
requestKey,  
title: String(body.title).trim(),
imageUrl: String(body.imageUrl).trim(),
targetUrl: String(body.targetUrl).trim(),
placement: body.placement,
country: geoTarget.country,
region: geoTarget.region,
geoScope: geoTarget.geoScope,
pricingSnapshot: estimate.pricingSnapshot,
estimatedPrice: estimate.estimatedPrice,
currency: estimate.currency,
paymentStatus: "NOT_REQUIRED",
paymentProvider: null,
paymentIntentId: null,
paidAt: null,
isActive: false,
activeFrom: normalizedActiveFrom,
activeTo: normalizedActiveTo,
priority: body.priority !== undefined ? Number(body.priority) : 100,
createdBy: req.user && req.user._id ? req.user._id : null,
notes: body.notes || "",
});

await doc.save();

return res.status(201).json({
ok:true,
data:{
id: String(doc._id),
status: doc.status,
paymentStatus: doc.paymentStatus,
estimatedPrice: doc.estimatedPrice,
currency: doc.currency,
pricingSnapshot: doc.pricingSnapshot,
},
});
} catch (err) {
logger.error("[Banner] submitBannerRequest error:", err);
return res.status(err.statusCode || 500).json({
ok:false,
error: err.code || "internal_error",
message: err.message || "Internal error",
});
}
};
