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

router.post('/create', async (req, res) => {
  const { simulate = true, payload = {} } = req.body || {};

  if (simulate) {
    return res.status(200).json({ ok: true, simulate: true, action: 'create', payload });
  }

  try {
    if (!EventModel) throw new Error('EventModel non trovato. Controllare il path in events.internal.js');
    const doc = await EventModel.create(payload);
    return res.status(201).json({ ok: true, simulate: false, event: doc });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:id/publish', async (req, res) => {
  const { simulate = true } = req.body || {};
  const { id } = req.params;

  if (simulate) {
    return res.status(200).json({ ok: true, simulate: true, action: 'publish', id });
  }

  try {
    if (!EventModel) throw new Error('EventModel non trovato. Controllare il path in events.internal.js');
    const doc = await EventModel.findByIdAndUpdate(
      id,
      { status: 'published', syncStatus: 'published' },
      { new: true }
    );
    if (!doc) return res.status(404).json({ ok: false, error: 'Event not found' });
    return res.status(200).json({ ok: true, simulate: false, event: doc });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
