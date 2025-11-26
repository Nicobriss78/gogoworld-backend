const mongoose = require("mongoose");

const activitySchema = new mongoose.Schema(
  {
    // Utente a cui appartiene questa attività (chi ha fatto l'azione)
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    // Tipo di attività evento-centrica
    // created_event → l'utente ha creato un evento (se organizer)
    // joined_event → l'utente ha confermato la partecipazione a un evento
    // will_join_event → l'utente parteciperà a un evento (prenotazione futura, se distinta)
    // review_event → l'utente ha lasciato una recensione
    // level_up → l'utente ha cambiato livello (novizio → esploratore, ecc.)
type: {
      type: String,
      enum: [
        "created_event",
        "joined_event",
        "attended_event",
        "will_join_event",
        "review_event",
        "level_up"
      ],
      required: true,
      index: true
    },

    // Riferimento all'evento coinvolto (se presente)
    // Per alcune attività (es. level_up) può essere null
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: false
    },

    // Payload flessibile per informazioni aggiuntive
    // Esempi:
    // - review_event: { rating: 4, commentSnippet: "Bellissima serata..." }
    // - level_up: { from: "novizio", to: "esploratore" }
    // - joined_event: { role: "participant" }
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: {
      createdAt: true,
      updatedAt: false
    }
  }
);

// Indice per recuperare rapidamente la bacheca di un utente in ordine cronologico
activitySchema.index({ user: 1, createdAt: -1 });

// Indice utile in futuro per feed globali / per tipo attività
activitySchema.index({ type: 1, createdAt: -1 });

const Activity = mongoose.model("Activity", activitySchema);

module.exports = Activity;
