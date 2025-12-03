// backend/models/notificationModel.js
// Modello notifiche in-app GoGoWorld.life (A9)

const mongoose = require("mongoose");
const { Schema } = mongoose;

const notificationSchema = new Schema(
  {
    // Utente destinatario della notifica
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Chi ha generato l'azione (es. chi ti ha seguito, chi ha creato l'evento)
    actor: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },

    // Evento collegato (per notifiche tipo "nuovo evento creato", "evento aggiornato", ecc.)
    event: {
      type: Schema.Types.ObjectId,
      ref: "Event",
    },

    // Tipo di notifica (estendibile in futuro)
type: {
  type: String,
  enum: ["follow", "event_created", "event_approved", "system"],
  required: true,
},

    // Titolo breve della notifica (mostrato nella lista)
    title: {
      type: String,
      required: true,
      trim: true,
    },

    // Messaggio opzionale, più descrittivo
    message: {
      type: String,
      trim: true,
    },

    // Payload flessibile per dati extra (es. URL, ids, meta, ecc.)
    data: {
      type: Object,
      default: {},
    },

    // Stato lettura
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indice per recuperare velocemente le notifiche di un utente
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });

const Notification = mongoose.model("Notification", notificationSchema);

module.exports = Notification;
