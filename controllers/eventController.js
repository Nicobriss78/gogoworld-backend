// backend/controllers/eventController.js
// Controller eventi – versione MongoDB (Mongoose)
// Le route pubbliche GET restano libere; POST/PUT/DELETE sono protette a livello di routes.

const Event = require('../models/eventModel');

// ========== LISTA EVENTI ==========
// GET /api/events (pubblica)
exports.list = async (_req, res) => {
  try {
    const events = await Event.find().sort({ createdAt: -1 });
    return res.json(events);
  } catch (err) {
    console.error('events.list error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ========== SINGOLO EVENTO ==========
// GET /api/events/:id (pubblica)
exports.get = async (req, res) => {
  try {
    const { id } = req.params;
    const ev = await Event.findById(id);
    if (!ev) return res.status(404).json({ error: 'Event not found' });
    return res.json(ev);
  } catch (err) {
    console.error('events.get error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ========== CREA EVENTO ==========
// POST /api/events (protetta: auth + roleRequired('organizer') nelle routes)
exports.create = async (req, res) => {
  try {
    const { title, date, location, description } = req.body || {};
    if (!title || !date || !location) {
      return res.status(400).json({ error: 'Missing required fields (title, date, location)' });
    }

    const ev = await Event.create({
      title,
      date,
      location,
      description: description || '',
      organizerId: String(req.user.id), // da token
      participants: []
    });

    return res.status(201).json(ev);
  } catch (err) {
    console.error('events.create error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ========== AGGIORNA EVENTO ==========
// PUT /api/events/:id (protetta: auth + roleRequired('organizer') nelle routes)
exports.update = async (req, res) => {
  try {
    const { id } = req.params;

    // opzionale: controllare che sia l’organizer dell’evento
    // const evCheck = await Event.findById(id);
    // if (!evCheck) return res.status(404).json({ error: 'Event not found' });
    // if (String(evCheck.organizerId) !== String(req.user.id)) {
    // return res.status(403).json({ error: 'Forbidden' });
    // }

    const { title, date, location, description } = req.body || {};
    const upd = {};
    if (title !== undefined) upd.title = title;
    if (date !== undefined) upd.date = date;
    if (location !== undefined) upd.location = location;
    if (description !== undefined) upd.description = description;

    const ev = await Event.findByIdAndUpdate(id, upd, { new: true });
    if (!ev) return res.status(404).json({ error: 'Event not found' });

    return res.json(ev);
  } catch (err) {
    console.error('events.update error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ========== ELIMINA EVENTO ==========
// DELETE /api/events/:id (protetta: auth + roleRequired('organizer') nelle routes)
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;

    // opzionale: verifica ownership come sopra
    // const evCheck = await Event.findById(id);
    // if (!evCheck) return res.status(404).json({ error: 'Event not found' });
    // if (String(evCheck.organizerId) !== String(req.user.id)) {
    // return res.status(403).json({ error: 'Forbidden' });
    // }

    const out = await Event.findByIdAndDelete(id);
    if (!out) return res.status(404).json({ error: 'Event not found' });

    return res.status(204).end();
  } catch (err) {
    console.error('events.remove error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
