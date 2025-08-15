// backend/models/userModel.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true },
    email: { type: String, trim: true, unique: true, index: true, required: true },
    password: { type: String, default: '' }, // TODO: bcrypt in fase avanzata
    role: {
      type: String,
      enum: ['participant', 'organizer'],
      default: 'participant'
    },
    currentRole: {
      type: String,
      enum: ['participant', 'organizer'],
      default: 'participant'
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', UserSchema);


