const { Schema, model, Types } = require('mongoose');

const mediaSchema = new Schema({
  kind: { type: String, enum: ['image', 'audio', 'video', 'doc'], default: null },
  mimetype: String,
  filename: String,
  size: Number,               // bytes
  openaiFileId: String,       // se setea tras subir a OpenAI
  openaiPurpose: String,      // 'vision' si es imagen para Assistants
}, { _id: false });

const messageSchema = new Schema(
  {
    user: { type: Types.ObjectId, ref: 'User', required: true },
    phone: { type: String, required: true, index: true },

    // Contenido entrante normalizado (lo que vas a procesar)
    type: { type: String, enum: ['text', 'image', 'audio', 'video', 'doc'], default: 'text' },
    text: { type: String, default: null },
    caption: { type: String, default: null },

    // Estado del procesamiento del bot
    status: {
      type: String,
      enum: ['pending', 'answered', 'error'],
      default: 'pending',
      index: true,
    },

    threadId: { type: String, default: null },
    media: { type: mediaSchema, default: null },
    assistantResponse: { type: String, default: null },
    runId: { type: String, default: null },
    runStatus: { type: String, default: null },     // completed | failed | expired | cancelled | ...
    runError: { type: String, default: null },      // último error del run/step
    runUsage: { type: Object, default: null },      //Tokens
  },
  { timestamps: true }
);

module.exports = model('Message', messageSchema);