// backend/controllers/userController.js
// Versione 2025-08-09 – schema attuale, senza librerie esterne

const fs = require("fs");
const path = require("path");

const USERS_PATH = path.join(__dirname, "..", "data", "users.json");

// -------------------- utilità file --------------------
function readUsers() {
  try {
    const txt = fs.readFileSync(USERS_PATH, "utf8");
    return JSON.parse(txt || "[]");
  } catch {
    return [];
  }
}
function writeUsers(arr) {
  fs.writeFileSync(USERS_PATH, JSON.stringify(arr, null, 2), "utf8");
}

// -------------------- utilità dati --------------------
function ensureUserShape(u) {
  // campi minimi / retro-compat
  if (!Array.isArray(u.eventsPartecipati)) u.eventsPartecipati = [];
  if (u.role2 === undefined) u.role2 = u.role || "participant";
  if (!u.currentRole) u.currentRole = u.role || "participant"; // ruolo attivo per lo switch
  return u;
}
function validPassword(pw) {
  return typeof pw === "string" &&
         pw.length >= 8 &&
         /[A-Za-z]/.test(pw) &&
         /\d/.test(pw);
}
function nextId(list) {
  return list.length ? Math.max(...list.map(x => Number(x.id) || 0)) + 1 : 1;
}

// -------------------- handlers --------------------

// GET /api/users (facoltativo, debug)
exports.list = (req, res) => {
  const users = readUsers().map(ensureUserShape).map(u => ({
    id: u.id, name: u.name, email: u.email, role: u.role, currentRole: u.currentRole
  }));
  res.json(users);
};

// GET /api/users/:id
exports.getById = (req, res) => {
  const id = Number(req.params.id);
  const users = readUsers().map(ensureUserShape);
  const u = users.find(x => Number(x.id) === id);
  if (!u) return res.status(404).json({ error: "User not found" });
  const { password, ...safe } = u;
  return res.json(safe);
};

// POST /api/users/register
// body: { name, email, password, role, acceptTerms }
exports.register = (req, res) => {
  const { name, email, password, role, acceptTerms } = req.body || {};

  if (!name || !email || !password || !role || !acceptTerms) {
    return res.status(400).json({ error: "Tutti i campi sono obbligatori" });
  }
  if (!validPassword(password)) {
    return res.status(400).json({ error: "Password non valida (min 8, 1 lettera e 1 numero)" });
  }
  const allowed = ["participant", "organizer"];
  const roleNorm = allowed.includes(role) ? role : "participant";

  const users = readUsers().map(ensureUserShape);
  const emailTaken = users.some(u => (u.email || "").toLowerCase() === String(email).toLowerCase());
  if (emailTaken) {
    return res.status(409).json({ error: "Email già registrata" });
  }

  const user = {
    id: nextId(users),
    name: String(name).trim(),
    email: String(email).trim(),
    // NOTE: dev-only, in prod usare bcrypt
    password: String(password),
    role: roleNorm,
    role2: roleNorm, // compat con tua logica precedente
    currentRole: roleNorm, // ruolo attivo (switchabile)
    eventsPartecipati: []
  };

  users.push(user);
  writeUsers(users);

  return res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role, currentRole: user.currentRole });
};

// POST /api/users/login
// body: { email, password }
exports.login = (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email e password sono obbligatorie" });
  }

  const users = readUsers().map(ensureUserShape);
  const u = users.find(x =>
    String(x.email).toLowerCase() === String(email).toLowerCase() &&
    String(x.password) === String(password)
  );

  if (!u) return res.status(401).json({ error: "Credenziali non valide" });

  const { password: _, ...safe } = u;
  // includo currentRole così il front può usarlo subito
  return res.json({ id: safe.id, name: safe.name, email: safe.email, role: safe.role, currentRole: safe.currentRole });
};

// POST /api/users/:id/partecipa
// body: { eventId }
exports.partecipa = (req, res) => {
  const id = Number(req.params.id);
  const { eventId } = req.body || {};
  const evId = Number(eventId);

  if (!evId) return res.status(400).json({ error: "eventId obbligatorio" });

  const users = readUsers().map(ensureUserShape);
  const idx = users.findIndex(u => Number(u.id) === id);
  if (idx === -1) return res.status(404).json({ error: "User not found" });

  const set = new Set((users[idx].eventsPartecipati || []).map(n => Number(n)));
  set.add(evId);

  users[idx].eventsPartecipati = Array.from(set);
  writeUsers(users);

  return res.json({ ok: true, userId: id, eventsPartecipati: users[idx].eventsPartecipati });
};

// POST /api/users/:id/annulla
// body: { eventId }
exports.annulla = (req, res) => {
  const id = Number(req.params.id);
  const { eventId } = req.body || {};
  const evId = Number(eventId);

  if (!evId) return res.status(400).json({ error: "eventId obbligatorio" });

  const users = readUsers().map(ensureUserShape);
  const idx = users.findIndex(u => Number(u.id) === id);
  if (idx === -1) return res.status(404).json({ error: "User not found" });

  const arr = (users[idx].eventsPartecipati || []).map(n => Number(n));
  users[idx].eventsPartecipati = arr.filter(n => n !== evId);
  writeUsers(users);

  return res.json({ ok: true, userId: id, eventsPartecipati: users[idx].eventsPartecipati });
};

// PUT /api/users/:id/role
// body: { newRole: "participant" | "organizer" }
exports.switchRole = (req, res) => {
  const id = Number(req.params.id);
  const { newRole } = req.body || {};
  const allowed = ["participant", "organizer"];

  if (!allowed.includes(newRole)) {
    return res.status(400).json({ error: "Ruolo non valido" });
  }

  const users = readUsers().map(ensureUserShape);
  const idx = users.findIndex(u => Number(u.id) === id);
  if (idx === -1) return res.status(404).json({ error: "User not found" });

  // logica flessibile: consenti il cambio tra i due ruoli supportati
  users[idx].currentRole = newRole;
  writeUsers(users);

  return res.json({ ok: true, userId: id, currentRole: users[idx].currentRole });
};
