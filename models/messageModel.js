// models/messageModel.js — C2 DM (MVP testo)
const mongoose = require("mongoose");
const { Schema } = mongoose;

// Nota: i thread sono coppie di utenti, identificate da una chiave deterministica (ordinata)
function threadKeyFor(a, b) {
  const A = String(a), B = String(b);
  return A < B ? `${A}-${B}` : `${B}-${A}`;
}

const messageSchema = new Schema(
  {
    threadKey: { type: String, required: true, index: true }, // es. "A-B"
    sender: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    recipient: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    text: { type: String, required: true, maxlength: 2000, trim: true },
    readAt: { type: Date, default: null, index: true },
    meta: {
      replyTo: { type: Schema.Types.ObjectId, ref: "Message", default: null },
      context: { type: String, default: null }, // es. "from:event:<id>"
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Indici utili
messageSchema.index({ threadKey: 1, createdAt: -1 }); // paginazione in thread
messageSchema.index({ recipient: 1, readAt: 1 }); // contatore non letti
messageSchema.index({ sender: 1, createdAt: -1 }); // anti-abuso / report

// Helper static per ottenere la chiave
messageSchema.statics.threadKeyFor = threadKeyFor;

module.exports = mongoose.models.Message || mongoose.model("Message", messageSchema);
