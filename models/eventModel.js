// backend/models/eventModel.js
const mongoose = require('mongoose');

const EventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    date: { type: String, required: true }, // TODO: passare a Date in fase avanzata
    location: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    organizerId: { type: String, required: true }, // userId string (compatibilità attuale)
    participants: { type: [String], default: [] } // array di userId string
  },
  { timestamps: true }
);

module.exports = mongoose.model('Event', EventSchema);
