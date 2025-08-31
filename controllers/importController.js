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

      const title = (line.title || "").trim();
      if (!title) errors.push("Titolo mancante");

      const date = parseDate(line.date);
      if (!date) errors.push("Data non valida");

      let endDate = null;
      if (line.endDate) {
        endDate = parseDate(line.endDate);
        if (!endDate) errors.push("EndDate non valida");
        else if (date && endDate < date) {
          errors.push("EndDate precedente alla Date");
        }
      }

      const city = line.city ? String(line.city).trim() : "";
      const region = line.region ? String(line.region).trim() : "";
      const category = line.category ? String(line.category).trim() : "";
      const description = line.description ? String(line.description).trim() : "";
      const price = parsePrice(line.price);
      const tags = line.tags
        ? String(line.tags)
            .split("|")
            .map((t) => t.trim())
            .filter(Boolean)
        : [];

      const coverImage = line.coverImage ? String(line.coverImage).trim() : "";
      const images = line.images
        ? String(line.images)
            .split("|")
            .map((u) => u.trim())
            .filter(Boolean)
        : [];

      if (errors.length > 0) {
        results.push({ line: i + 2, status: "error", errors });
        skipped++;
        continue;
      }

      if (dryRun) {
        results.push({ line: i + 2, status: "ok", preview: { title, date } });
        continue;
      }

      try {
        const ev = new Event({
          title,
          description,
          city,
          region,
          category,
          date,
          endDate,
          isFree: price === 0,
          price,
          tags,
          coverImage,
          images,
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
