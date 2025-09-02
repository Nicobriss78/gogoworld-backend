// controllers/importController.js — GoGoWorld.life
// Gestione import CSV eventi (Opzione A: bottone visibile a tutti, autorizzazione lato BE)

const fs = require("fs");
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
    // Whitelist: ADMIN_EMAILS
    const allowed = (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    if (!allowed.includes(req.user.email.toLowerCase())) {
      res.status(403);
      throw new Error("Non sei autorizzato a importare eventi");
    }

    if (!req.file) {
      res.status(400);
      throw new Error("Nessun file caricato");
    }

    // Leggi contenuto CSV
    const content = fs.readFileSync(req.file.path, "utf-8");

    // Parsa CSV
    let records;
    try {
      records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (err) {
      res.status(400);
      throw new Error("Formato CSV non valido");
    }

    const dryRun = String(req.query.dryRun || "").toLowerCase() === "true";

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
      const streetNumber= (line.streetNumber || "").trim();
      const postalCode = (line.postalCode || "").trim();
      const city = (line.city || "").trim();
      const province = (line.province || "").trim();
      const region = (line.region || "").trim();
      const country = (line.country || "").trim(); // ISO 3166-1 alpha-2 preferita

      const lat = line.lat !== undefined && line.lat !== null && String(line.lat).trim() !== ""
        ? parseFloat(String(line.lat).replace(",", "."))
        : undefined;
      const lon = line.lon !== undefined && line.lon !== null && String(line.lon).trim() !== ""
        ? parseFloat(String(line.lon).replace(",", "."))
        : undefined;

      // Date (nuovi nomi)
      const dateStart = parseDate(line.dateStart);
      let dateEnd = line.dateEnd ? parseDate(line.dateEnd) : null;

      // Prezzo/valuta
      const hasPriceField = line.price !== undefined && line.price !== null && String(line.price).trim() !== "";
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
          preview: { title, category, region, country, visibility, dateStart, dateEnd }
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
        results.push({ line: i + 2, status: "error", errors: [err.message] });
        skipped++;
      }
    }

    if (dryRun) {
      res.json({
        ok: true,
        dryRun: true,
        stats: { total: records.length, valid: records.length - skipped, invalid: skipped },
        rows: results,
      });
    } else {
      res.json({
        ok: true,
        dryRun: false,
        created,
        skipped,
        rows: results,
      });
    }
  } catch (err) {
    next(err);
  } finally {
    // cleanup file temporaneo
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, () => {});
    }
  }
};

module.exports = { importCsv };
