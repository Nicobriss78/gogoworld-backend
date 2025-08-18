// src/internal/routes/events.internal.js
const express = require('express');
const router = express.Router();

// Import del modello Event per struttura: backend/models/eventModel.js
let EventModel;
try {
  EventModel = require('../../../models/eventModel');
} catch (e) {
  console.error("Errore nel require di models/eventModel.js:", e.message);
}

/**
 * Whitelist dei campi accettati da payload (evita di scrivere qualunque cosa a DB).
 * Aggiungi/togli chiavi in base al tuo schema attuale in eventModel.js.
 */
function normalizeEventPayload(payload = {}) {
  const safe = {};

  // campi base comunemente presenti nel tuo model
  if (payload.title) safe.title = payload.title;
  if (payload.description) safe.description = payload.description;
  if (payload.category) safe.category = payload.category;

  // date/luoghi (se esistono nel tuo schema)
  if (payload.dateStart) safe.dateStart = payload.dateStart;
  if (payload.dateEnd) safe.dateEnd = payload.dateEnd;
  if (payload.city) safe.city = payload.city;
  if (payload.province) safe.province = payload.province;
  if (payload.region) safe.region = payload.region;
  if (payload.country) safe.country = payload.country;
  if (payload.address) safe.address = payload.address;
  if (payload.location) safe.location = payload.location; // se usi un unico campo testuale

  // link/media (se presenti)
  if (payload.image) safe.image = payload.image;
  if (payload.link) safe.link = payload.link;

  // campi di integrazione Onira già previsti nel tuo model
  if (payload.external?.oniraEventId) {
    safe.external = { oniraEventId: payload.external.oniraEventId };
  }

  // status / syncStatus: di default quando creiamo da /internal
  // non imponiamo status se il tuo model gestisce default interni; altrimenti:
  if (payload.status) safe.status = payload.status; // lascia passare se esplicitato
  safe.syncStatus = payload.syncStatus || 'proposed'; // o 'created_internal' se preferisci

  return safe;
}

/**
 * Validazione minima (non invadente): richiediamo almeno un titolo
 * Aggiungi altre regole se ti servono (dateStart obbligatoria, ecc.)
 */
function validateForCreate(data) {
  const errors = [];
  if (!data.title || typeof data.title !== 'string' || !data.title.trim()) {
    errors.push('title is required');
  }
  return errors;
}

/**
 * POST /internal/events/create
 * - simulate:true -> non scrive su DB, echo dei dati
 * - simulate:false -> crea davvero su MongoDB usando EventModel
 */
router.post('/create', async (req, res) => {
  const { simulate = true, payload = {} } = req.body || {};

  if (simulate) {
    return res.status(200).json({ ok: true, simulate: true, action: 'create', payload });
  }

  try {
    if (!EventModel) throw new Error('EventModel non trovato. Controllare il path in events.internal.js');

    const data = normalizeEventPayload(payload);
    const errors = validateForCreate(data);
    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'validation_error', details: errors });
    }

    const doc = await EventModel.create(data);
    return res.status(201).json({ ok: true, simulate: false, event: doc });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /internal/events/:id/publish
 * - simulate:true -> non scrive su DB
 * - simulate:false -> aggiorna status/syncStatus su Mongo
 */
router.post('/:id/publish', async (req, res) => {
  const { simulate = true } = req.body || {};
  const { id } = req.params;

  if (simulate) {
    return res.status(200).json({ ok: true, simulate: true, action: 'publish', id });
  }

  try {
    if (!EventModel) throw new Error('EventModel non trovato. Controllare il path in events.internal.js');

    const update = { status: 'published', syncStatus: 'published' };
    // se nel tuo schema hai campi tipo publishedAt o publishDate, puoi sbloccarli qui:
    // update.publishedAt = new Date();

    const doc = await EventModel.findByIdAndUpdate(id, update, { new: true });
    if (!doc) return res.status(404).json({ ok: false, error: 'Event not found' });

    return res.status(200).json({ ok: true, simulate: false, event: doc });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
