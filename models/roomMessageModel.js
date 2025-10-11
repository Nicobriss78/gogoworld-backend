// models/roomMessageModel.js — C2.2
const mongoose = require("mongoose");
const { Schema } = mongoose;

const roomMessageSchema = new Schema(
  {
    roomId: { type: Schema.Types.ObjectId, ref: "Room", required: true, index: true },
    sender: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    text: { type: String, required: true, maxlength: 2000, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

roomMessageSchema.index({ roomId: 1, createdAt: -1 });

module.exports = mongoose.models.RoomMessage || mongoose.model("RoomMessage", roomMessageSchema);
