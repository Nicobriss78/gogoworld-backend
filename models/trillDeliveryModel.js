const mongoose = require("mongoose");

const { Schema } = mongoose;

const trillDeliverySchema = new Schema(
  {
    trillId: {
      type: Schema.Types.ObjectId,
      ref: "Trill",
      required: true,
      index: true,
    },
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    notificationId: {
      type: Schema.Types.ObjectId,
      ref: "Notification",
      default: null,
      index: true,
    },
    deliveredAt: { type: Date, default: null },
    openedAt: { type: Date, default: null, index: true },
    clickedAt: { type: Date, default: null },
    checkedInAt: { type: Date, default: null },

    distanceBand: {
      type: String,
      enum: ["0-500m", "500m-1km", "1-3km", "3-5km", "unknown"],
      default: "unknown",
    },

    status: {
      type: String,
      enum: ["pending", "delivered", "opened", "clicked", "checked_in", "expired", "failed"],
      default: "pending",
      index: true,
    },
  },
  { timestamps: true }
);

trillDeliverySchema.index({ trillId: 1, userId: 1 }, { unique: true });
trillDeliverySchema.index({ userId: 1, createdAt: -1 });
trillDeliverySchema.index({ eventId: 1, status: 1 });

module.exports = mongoose.model("TrillDelivery", trillDeliverySchema);
