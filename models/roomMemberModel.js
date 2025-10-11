// models/roomMemberModel.js — C2.2
const mongoose = require("mongoose");
const { Schema } = mongoose;

const roomMemberSchema = new Schema(
  {
    roomId: { type: Schema.Types.ObjectId, ref: "Room", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    lastReadAt: { type: Date, default: null, index: true },
    joinedAt: { type: Date, default: Date.now },
    grants: { type: [String], default: [] }, // es. ["code"] per eventi privati (in futuro)
  },
  { timestamps: false }
);

roomMemberSchema.index({ roomId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.models.RoomMember || mongoose.model("RoomMember", roomMemberSchema);
