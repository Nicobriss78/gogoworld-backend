// backend/models/eventModel.js
const mongoose = require('mongoose');

const CoordinatesSchema = new mongoose.Schema(
  { lat: { type: Number, min: -90, max: 90 }, lng: { type: Number, min: -180, max: 180 } },
  { _id: false }
);

const ExternalSchema = new mongoose.Schema(
  {
    oniraEventId: { type: String, default: null },
    syncStatus: { type: String, enum: ['pending', 'ok', 'error'], default: 'ok' },
    syncError: { type: String, default: null },
  },
  { _id: false }
);

const EventSchema = new mongoose.Schema(
  {
    // Identità
    eventIdExt: { type: String, default: null }, // dall’excel

    // Legacy (compat FE attuale)
    title: { type: String, required: true, trim: true },
    date: { type: String, default: '' }, // legacy: string
    location: { type: String, default: '', trim: true }, // legacy
    description: { type: String, default: '' },

    // Descrizioni estese
    shortDescription: { type: String, default: '' },
    longDescription: { type: String, default: '' },

    // Date moderne
    dateStart: { type: Date, default: null },
    dateEnd: { type: Date, default: null },
    timezone: { type: String, default: 'Europe/Rome' },

    // Luogo strutturato
    venueName: { type: String, default: '' },
    address: { type: String, default: '' },
    city: { type: String, default: '' },
    province: { type: String, default: '' },
    region: { type: String, default: '' },
    country: { type: String, default: '' },
    coords: { type: CoordinatesSchema, default: undefined },

    // Classificazione
    category: { type: String, default: '' },
    subcategory: { type: String, default: '' },
    type: { type: String, default: '' },
    tags: { type: [String], default: [] },

    // Capienza & prezzi
    capacity: { type: Number, default: 0 },
    isFree: { type: Boolean, default: false },
    priceMin: { type: Number, default: 0 },
    priceMax: { type: Number, default: 0 },
    currency: { type: String, default: 'EUR' },

    // Stato/visibilità
    status: { type: String, enum: ['draft', 'published', 'cancelled'], default: 'published' },
    visibility: { type: String, enum: ['public', 'private', 'unlisted'], default: 'public' },

    // Media & meta
    images: { type: [String], default: [] },
    language: { type: String, default: 'it' },
    accessibility: { type: [String], default: [] },
    ageRestriction: { type: String, default: '' },

    // Servizi & sorgente
    services: { type: [String], default: [] },
    sourceName: { type: String, default: '' },
    sourceUrl: { type: String, default: '' },
    isThirdPartyListing: { type: Boolean, default: false },
    disclaimerNote: { type: String, default: '' },
    moderationStatus: { type: String, default: '' },
    notesInternal: { type: String, default: '' },

    // Registrazione / contatti
    registrationRequired: { type: Boolean, default: false },
    externalUrl: { type: String, default: '' },
    contactEmail: { type: String, default: '' },
    contactPhone: { type: String, default: '' },

    // Ownership & partecipazioni
    organizerId: { type: String, required: true },
    participants: { type: [String], default: [] },

    // Integrazioni
    external: { type: ExternalSchema, default: undefined },
  },
  { timestamps: true }
);

// Indici
EventSchema.index({ dateStart: 1, dateEnd: 1 });
EventSchema.index({ city: 1, province: 1, region: 1, country: 1 });
EventSchema.index({ category: 1, subcategory: 1, tags: 1, type: 1 });
EventSchema.index({ organizerId: 1 });
EventSchema.index({ status: 1, visibility: 1 });
EventSchema.index({ title: 'text', description: 'text', shortDescription: 'text', longDescription: 'text' });

module.exports = mongoose.model('Event', EventSchema);
