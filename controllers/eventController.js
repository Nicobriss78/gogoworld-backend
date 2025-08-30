const Event = require("../models/eventModel");
const asyncHandler = require("express-async-handler");

// Costruisce filtri dinamici dalle query string
function buildFilters(q) {
  const query = {};

  if (q.title) {
    query.title = { $regex: q.title, $options: "i" };
  }
  if (q.city) {
    query.city = { $regex: q.city, $options: "i" };
  }
  if (q.region) {
    query.region = { $regex: q.region, $options: "i" };
  }
  if (q.country) {
    query.country = { $regex: q.country, $options: "i" };
  }
  if (q.category) {
    query.category = q.category;
  }
  if (q.subcategory) {
    query.subcategory = q.subcategory;
  }
  if (q.visibility) {
    query.visibility = q.visibility;
  }
  if (q.type) {
    query.type = q.type;
  }
  if (q.isFree) {
    query.isFree = q.isFree === "true";
  }

  if (q.dateStart || q.dateEnd) {
    query.date = {};
    if (q.dateStart) {
      query.date.$gte = new Date(q.dateStart);
    }
    if (q.dateEnd) {
      const end = new Date(q.dateEnd);
      // FIX CHIRURGICO: se la query è in formato solo-data (YYYY-MM-DD),
      // includiamo l’intera giornata con $lt di giorno successivo.
      if (/^\d{4}-\d{2}-\d{2}$/.test(q.dateEnd)) {
        const nextDay = new Date(end);
        nextDay.setDate(end.getDate() + 1);
        query.date.$lt = nextDay;
      } else {
        query.date.$lte = end;
      }
    }
  }

  return query;
}

// @desc Ottiene tutti gli eventi (pubblici) con filtri
// @route GET /api/events
// @access Public
const listEvents = asyncHandler(async (req, res) => {
  const filters = buildFilters(req.query);
  const events = await Event.find(filters).sort({ date: 1 });
  res.json({ ok: true, events });
});

// @desc Ottiene eventi creati dall’organizzatore corrente
// @route GET /api/events/mine/list
// @access Private (organizer)
const listMyEvents = asyncHandler(async (req, res) => {
  const filters = buildFilters(req.query);
  filters.organizer = req.user._id;
  const events = await Event.find(filters).sort({ date: 1 });
  res.json({ ok: true, events });
});

// @desc Ottiene un evento singolo
// @route GET /api/events/:id
// @access Public
const getEventById = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id).populate("organizer", "name email");
  if (!event) {
    res.status(404);
    throw new Error("Evento non trovato");
  }
  res.json({ ok: true, event });
});

// @desc Crea un nuovo evento
// @route POST /api/events
// @access Private (organizer)
const createEvent = asyncHandler(async (req, res) => {
  const event = new Event({
    ...req.body,
    organizer: req.user._id,
  });
  const created = await event.save();
  res.status(201).json({ ok: true, event: created });
});

// @desc Aggiorna un evento
// @route PUT /api/events/:id
// @access Private (organizer)
const updateEvent = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id);
  if (!event) {
    res.status(404);
    throw new Error("Evento non trovato");
  }
  if (event.organizer.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Non autorizzato");
  }
  Object.assign(event, req.body);
  const updated = await event.save();
  res.json({ ok: true, event: updated });
});

// @desc Elimina un evento
// @route DELETE /api/events/:id
// @access Private (organizer)
const deleteEvent = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id);
  if (!event) {
    res.status(404);
    throw new Error("Evento non trovato");
  }
  if (event.organizer.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Non autorizzato");
  }
  await event.remove();
  res.json({ ok: true, message: "Evento eliminato" });
});

// @desc Aggiunge partecipante a un evento
// @route POST /api/events/:id/join
// @access Private (participant)
const joinEvent = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id);
  if (!event) {
    res.status(404);
    throw new Error("Evento non trovato");
  }
  if (!event.participants.includes(req.user._id)) {
    event.participants.push(req.user._id);
    await event.save();
  }
  res.json({ ok: true, event });
});

// @desc Rimuove partecipante da un evento
// @route POST /api/events/:id/leave
// @access Private (participant)
const leaveEvent = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id);
  if (!event) {
    res.status(404);
    throw new Error("Evento non trovato");
  }
  event.participants = event.participants.filter(
    (p) => p.toString() !== req.user._id.toString()
  );
  await event.save();
  res.json({ ok: true, event });
});

module.exports = {
  listEvents,
  listMyEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  joinEvent,
  leaveEvent,
};


