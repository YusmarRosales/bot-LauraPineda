const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
  botActive: { type: Boolean, default: true },
  timezone: { type: String, default: 'America/Caracas' },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Settings', SettingsSchema);