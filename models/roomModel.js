// models/roomModel.js — C2.2 rooms (event)
const mongoose = require("mongoose");
const { Schema } = mongoose;

const roomSchema = new Schema(
  {
    type: { type: String, enum: ["event", "topic"], required: true, index: true },
    eventId: { type: Schema.Types.ObjectId, ref: "Event", default: null, index: true },
    categoryKey: { type: String, default: null }, // solo per topic (non usato qui)
    title: { type: String, required: true },
    isPrivate: { type: Boolean, default: false }, // evento privato => true (qui: false)
    isArchived: { type: Boolean, default: false, index: true },

    activeFrom: { type: Date, default: null, index: true },
    activeUntil: { type: Date, default: null, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

// Indici utili
roomSchema.index({ type: 1, eventId: 1 }, { unique: true, partialFilterExpression: { type: "event", eventId: { $type: "objectId" } } });

module.exports = mongoose.models.Room || mongoose.model("Room", roomSchema);
