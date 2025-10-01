require('dotenv').config();
const express = require('express');
const qrcode = require('qrcode');
const { start: startWhatsApp, getQrCode } = require('./src/services/whatsapp.service');
const { connectDB, disconnectDB } = require("./src/config/db");
const { start: startDateCron } = require('./cron/update_assistant_date.cron');

startDateCron();

const app = express();
app.use(express.json());

// Ruta de prueba de API
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Asistente WhatsApp en ejecución ✅' });
});

// Escanear QR
app.get('/qr', async (req, res) => {
  const qrData = getQrCode();
  if (!qrData) {
    return res.status(200).send(`
      <html>
      <head>
        <meta charset="UTF-8" />
        <title>QR de WhatsApp</title>
        <style>
          body {
            background: #f3f4f6;
            font-family: Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            color: #374151;
          }
          .container {
            background: white;
            padding: 2rem;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            text-align: center;
          }
          h2 {
            margin-bottom: 1rem;
          }
          p {
            color: #6b7280;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>No hay QR disponible</h2>
          <p>Es posible que ya estés autenticado en WhatsApp ✅</p>
        </div>
      </body>
      </html>
    `);
  }

  try {
    const qrImage = await qrcode.toDataURL(qrData); // Base64 QR
    res.send(`
      <html>
      <head>
        <meta charset="UTF-8" />
        <title>QR de WhatsApp</title>
        <style>
          body {
            background: #f3f4f6;
            font-family: Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            color: #374151;
          }
          .container {
            background: white;
            padding: 2rem;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            text-align: center;
          }
          h2 {
            margin-bottom: 1rem;
          }
          img {
            margin-top: 1rem;
            border-radius: 8px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
          }
          p {
            color: #6b7280;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Escanea este QR para vincular WhatsApp</h2>
          <img src="${qrImage}" alt="QR Code" />
          <p>Abre WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('Error generando QR');
  }
});

// Endpoint para enviar mensajes manualmente desde HTTP
// Ej: POST /send { "to": "5211234567890", "message": "Hola" }
app.post('/send', async (req, res) => {
  try {
    const { sendMessage } = require('./src/services/whatsapp.service');
    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({ error: 'Parámetros "to" y "message" requeridos' });
    }

    await sendMessage(to, message);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error en /send:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

// Inicia WhatsApp y servidor HTTP
(async () => {
  try {
    console.log('Iniciando asistente...');
    await connectDB(); // 🔹 Conexión MongoDB
    startWhatsApp();

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`Servidor escuchando en http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Error iniciando el servidor:', err);
    await disconnectDB();
    process.exit(1);
  }
})();

// ---- Manejo de cierre de conexión ----
const shutdown = async () => {
  try {
    console.log("Cerrando conexión a MongoDB...");
    await disconnectDB();
    console.log("Conexión a MongoDB cerrada.");
  } catch (error) {
    console.error("Error al cerrar la conexión con MongoDB", error);
  }
};

process.on("SIGINT", () => {
  console.log("Proceso terminado por SIGINT (Ctrl+C)");
  shutdown().then(() => process.exit(0)); 
});

process.on("SIGTERM", () => {
  console.log("Proceso terminado por SIGTERM (señal de terminación)");
  shutdown().then(() => process.exit(0));
});

process.on("uncaughtException", async (err) => {
  console.error("❌ Excepción no controlada:", err);
  shutdown().then(() => process.exit(0));
});

process.on("unhandledRejection", async (reason, promise) => {
  console.error("❌ Promesa rechazada sin manejar:", reason);
  shutdown().then(() => process.exit(0));
});