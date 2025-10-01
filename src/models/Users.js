const { Schema, model } = require('mongoose');

const userSchema = new Schema(
  {
    phone: { type: String, required: true, unique: true, index: true },
    wpp_name: { type: String, default: null },
    thread: { type: String, default: null }, // id del hilo de OpenAI
    botEnabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = model('Users', userSchema);