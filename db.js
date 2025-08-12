// backend/db.js
const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }

  // Opzionale: specifica il nome del DB (puoi cambiarlo)
  const dbName = 'gogo_dev';

  try {
    await mongoose.connect(uri, { dbName });
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    throw err; // rilancia per fermare il boot (meglio vedere il motivo nei log)
  }
}

module.exports = connectDB;
