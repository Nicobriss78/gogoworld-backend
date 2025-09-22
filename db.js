// backend/db.js
const mongoose = require('mongoose');
const { logger } = require("./core/logger"); // #CORE-LOGGER A1
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
    logger.info('✅ MongoDB connected');
  } catch (err) {
    logger.error('❌ MongoDB connection error:', err?.message || err);
    throw err;
  }
}

module.exports = connectDB;

