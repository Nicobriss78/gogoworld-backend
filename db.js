// backend/db.js
const mongoose = require('mongoose');
const { config } = require("./config");
mongoose.set('strictQuery', true);

async function connectDB() {
const uri = config.DB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI non impostata nelle environment variables');
  }

  try {
    await mongoose.connect(uri, {
      // lascia le opzioni di default per le versioni recenti
      // serverSelectionTimeoutMS evita attese infinite
      serverSelectionTimeoutMS: 15000
    });
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err?.message || err);
    throw err;
  }
}

module.exports = connectDB;

