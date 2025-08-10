const fs = require("fs");
const path = require("path");

const EVENTS_PATH = path.join(__dirname, "..", "data", "events.json");

// --- util ---
function safeRead() {
  try {
    const txt = fs.readFileSync(EVENTS_PATH, "utf8");
    return JSON.parse(txt || "[]");
  } catch (_) {
    return [];
  }
}

function safeWrite(data) {
  fs.writeFileSync(EVENTS_PATH, JSON.stringify(data, null, 2), "utf8");
}

/**
 * Normalizza un evento sullo schema ufficiale:
 * { id:number, title:string, description:string, date:ISO string, location:string, lat?:number, lng?:number }
 */
function normalize(input) {
  const out = {
    id: input.id != null ? Number(input.id) : undefined,
    title: (input.title ?? "").toString().trim(),
    description: (input.description ?? "").toString().trim(),
    location: (input.location ?? "").toString().trim(),
  };

  // Date: proviamo a normalizzare in ISO, ma se non valida lasciamo stringa così com’è
  if (input.date) {
    const d = new Date(input.date);
    out.date = isNaN(d.getTime()) ? String(input.date) : d.toISOString();
  } else {
    out.date = null;
  }

  if (input.lat !== undefined) out.lat = Number(input.lat);
  if (input.lng !== undefined) out.lng = Number(input.lng);

  return out;
}

exports.list = (req, res) => {
  const data = safeRead().map(normalize);
  res.json(data);
};

exports.get = (req, res) => {
  const id = Number(req.params.id);
  const data = safeRead();
  const found = data.find(e => Number(e.id) === id);
  if (!found) return res.status(404).json({ error: "Event not found" });
  res.json(normalize(found));
};

exports.create = (req, res) => {
  const data = safeRead();
  const body = normalize(req.body || {});

  // campi minimi richiesti
  if (!body.title || !body.date || !body.location) {
    return res.status(400).json({ error: "title, date, location are required" });
  }

  const nextId = data.length ? Math.max(...data.map(e => Number(e.id) || 0)) + 1 : 1;
  body.id = nextId;
  data.push(body);
  safeWrite(data);
  res.status(201).json(body);
};

exports.update = (req, res) => {
  const id = Number(req.params.id);
  const data = safeRead();
  const idx = data.findIndex(e => Number(e.id) === id);
  if (idx === -1) return res.status(404).json({ error: "Event not found" });

  const merged = { ...data[idx], ...req.body, id };
  const normalized = normalize(merged);
  data[idx] = normalized;
  safeWrite(data);
  res.json(normalized);
};

exports.remove = (req, res) => {
  const id = Number(req.params.id);
  const data = safeRead();
  const idx = data.findIndex(e => Number(e.id) === id);
  if (idx === -1) return res.status(404).json({ error: "Event not found" });

  const deleted = data.splice(idx, 1)[0];
  safeWrite(data);
  res.json({ ok: true, deleted: normalize(deleted) });
};
