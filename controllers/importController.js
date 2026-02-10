// controllers/importController.js — GoGoWorld.life
// Gestione import CSV eventi (Opzione A: bottone visibile a tutti, autorizzazione lato BE)

const { parse } = require("csv-parse/sync");
const Event = require("../models/eventModel");

// Helper: parse date (YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY)
function parseDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (!s) return null;

  // Try ISO first
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return new Date(s);
  }

  // Try DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
  if (m) {
    const [_, d, mth, y] = m;
    return new Date(`${y}-${mth}-${d}`);
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Helper: normalize price
function parsePrice(str) {
  if (str === undefined || str === null || str === "") return 0;
  const norm = String(str).replace(",", ".").trim();
  const val = parseFloat(norm);
  return isNaN(val) || val < 0 ? 0 : val;
}

// Helper: parse boolean-like values (1/0, true/false, yes/no)
function parseBool(val) {
  const s = String(val ?? "").trim().toLowerCase();
  if (!s) return false;
  return ["1", "true", "yes", "y", "si", "s"].includes(s);
}

// Controller principale
const importCsv = async (req, res, next) => {
  try {
    // Whitelist: ADMIN_EMAILS (se vuota, consenti a tutti gli organizer autenticati)
    const allowed = (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const userEmail = req?.user?.email ? String(req.user.email).toLowerCase() : null;

    if (!userEmail || (allowed.length > 0 && !allowed.includes(userEmail))) {
      return res.status(403).json({ ok: false, error: "Non sei autorizzato a importare eventi" });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Nessun file caricato" });
    }

    // Leggi contenuto CSV (supporta memoryStorage e diskStorage)
    let content;
    try {
    if (req.file && req.file.buffer) {
    content = req.file.buffer.toString("utf-8");
    } else {
    return res.status(400).json({ ok: false, error: "File non disponibile" });
}

    } catch (e) {
      return res.status(400).json({ ok: false, error: "Impossibile leggere il file caricato" });
    }

    // Parsa CSV
    let records;
    try {
      records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
} catch (err) {
  // no-leak: non esporre dettagli parser al client
  return res.status(400).json({ ok: false, error: "Formato CSV non valido" });
}


const dryRun =
  String(req.query.dryRun || (req.body && req.body.simulate) || "").toLowerCase() === "true";

    let results = [];
    let created = 0;
    let skipped = 0;

    for (let i = 0; i < records.length; i++) {
      const line = records[i];
      const errors = [];

      // === Estrazione campi dalla riga CSV (nuovo schema) ===
      const title = (line.title || "").trim();
      const description = (line.description || "").trim();

      const category = (line.category || "").trim();
      const subcategory = (line.subcategory || "").trim();

      const visibility = (line.visibility || "public").trim().toLowerCase(); // public|draft|private
      const language = (line.language || "it").trim().toLowerCase(); // ISO 639-1
      const target = (line.target || "tutti").trim().toLowerCase(); // tutti|famiglie|18+|professionisti

      // Localizzazione separata
      const venueName = (line.venueName || "").trim();
      const street = (line.street || "").trim();
      const streetNumber = (line.streetNumber || "").trim();
      const postalCode = (line.postalCode || "").trim();
      const city = (line.city || "").trim();
      const province = (line.province || "").trim();
      const region = (line.region || "").trim();
      const country = (line.country || "").trim(); // ISO 3166-1 alpha-2 preferita

      const lat =
        line.lat !== undefined && line.lat !== null && String(line.lat).trim() !== ""
          ? parseFloat(String(line.lat).replace(",", "."))
          : undefined;
      const lon =
        line.lon !== undefined && line.lon !== null && String(line.lon).trim() !== ""
          ? parseFloat(String(line.lon).replace(",", "."))
          : undefined;

      // Date (nuovi nomi)
      const dateStart = parseDate(line.dateStart);
      let dateEnd = line.dateEnd ? parseDate(line.dateEnd) : null;

      // Prezzo/valuta
      const hasPriceField =
        line.price !== undefined && line.price !== null && String(line.price).trim() !== "";
      const rawPrice = hasPriceField ? parsePrice(line.price) : 0;
      let isFree = parseBool(line.isFree);
      if (hasPriceField && rawPrice === 0) isFree = true;
      if (!hasPriceField && !isFree) isFree = true; // se non c'è price e isFree non è true => trattalo come gratuito

      let price = isFree ? 0 : rawPrice;
      let currency = (line.currency || "").trim().toUpperCase();
      if (!isFree && hasPriceField && !currency) {
        currency = "EUR"; // default concordato
      }

      // Media e tag (separatore pipe)
      const tags = line.tags
        ? String(line.tags)
            .split("|")
            .map((t) => t.trim())
            .filter(Boolean)
        : [];

      const images = line.images
        ? String(line.images)
            .split("|")
            .map((u) => u.trim())
            .filter(Boolean)
        : [];

      const coverImage = (line.coverImage || "").trim();

      // === Validazioni ===
      if (!title) errors.push("Titolo mancante");
      if (!category) errors.push("Categoria mancante");
      if (!visibility) errors.push("Visibilità mancante");
      if (!region) errors.push("Regione mancante");
      if (!country) errors.push("Paese mancante (ISO 3166-1 alpha-2)");
      if (!dateStart) errors.push("dateStart non valida");

      if (dateEnd && dateStart && dateEnd < dateStart) {
        errors.push("dateEnd precedente a dateStart");
      }

      // Valuta/prezzo
      if (!isFree && hasPriceField && price < 0) {
        errors.push("Prezzo non valido (negativo)");
      }
      if (!isFree && hasPriceField && !currency) {
        errors.push("Currency mancante");
      }

      // Lat/Lon (se forniti)
      if (lat !== undefined && Number.isNaN(lat)) errors.push("Lat non valida");
      if (lon !== undefined && Number.isNaN(lon)) errors.push("Lon non valida");

      if (errors.length > 0) {
        results.push({ line: i + 2, status: "error", errors });
        skipped++;
        continue;
      }

      if (dryRun) {
        results.push({
          line: i + 2,
          status: "ok",
          preview: { title, category, region, country, visibility, dateStart, dateEnd },
        });
        continue;
      }

      try {
        const ev = new Event({
          // Base
          title,
          description,

          // Tassonomia
          category,
          subcategory,

          // Visibilità / lingua / target
          visibility,
          language,
          target,

          // Localizzazione separata
          venueName,
          street,
          streetNumber,
          postalCode,
          city,
          province,
          region,
          country,
          ...(lat !== undefined ? { lat } : {}),
          ...(lon !== undefined ? { lon } : {}),
          // GeoJSON: aggiungi 'location' solo se entrambe le coord sono presenti
          ...(Number.isFinite(lat) && Number.isFinite(lon)
          ? { location: { type: "Point", coordinates: [lon, lat] } }
          : {}),

          // Date
          dateStart,
          ...(dateEnd ? { dateEnd } : {}),

          // Prezzo/valuta
          isFree,
          ...(isFree ? {} : { price, currency }),

          // Media & tag
          tags,
          images,
          coverImage,

          // Relazioni
          organizer: req.user._id,
        });
        await ev.save();
        created++;
        results.push({ line: i + 2, status: "ok", id: ev._id });
} catch (err) {
  // no-leak: non esporre errori mongo/node nel report righe
  results.push({ line: i + 2, status: "error", errors: ["internal_error"] });
  skipped++;
}

    }

    if (dryRun) {
      return res.json({
        ok: true,
        dryRun: true,
        stats: { total: records.length, valid: records.length - skipped, invalid: skipped },
        rows: results,
      });
    } else {
      return res.json({
        ok: true,
        dryRun: false,
        created,
        skipped,
        rows: results,
      });
    }
} catch (err) {
  return res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500).json({
    ok: false,
    error: "internal_error",
  });
}
};

module.exports = { importCsv };
