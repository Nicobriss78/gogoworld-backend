const mongoose = require("mongoose");

const checkInSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["planned_presence", "spontaneous_presence"],
      required: true,
    },
    checkedInAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    position: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [lng, lat]
        required: true,
      },
    },

    distanceFromEventMeters: {
      type: Number,
      required: true,
      min: 0,
    },

    validationStatus: {
      type: String,
      enum: ["valid"],
      default: "valid",
    },

    source: {
      type: String,
      enum: ["map", "event_page", "trill"],
      default: "event_page",
    },

    meta: {
      geoMode: {
        type: String,
        enum: ["near_me", "explore", "unknown"],
        default: "unknown",
      },
      accuracyMeters: {
        type: Number,
        default: null,
      },
      locationTimestamp: {
        type: Date,
        default: null,
      },
    },
  },
  { timestamps: true }
);

checkInSchema.index({ eventId: 1, userId: 1 }, { unique: true });
checkInSchema.index({ position: "2dsphere" });

module.exports = mongoose.model("CheckIn", checkInSchema);
