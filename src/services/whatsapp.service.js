const { Client, LocalAuth } = require("whatsapp-web.js");
const { handleIncomingMessage } = require("../controllers/message.controller");

let qrCodeData = null; // aquí guardamos el último QR

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "client1" }),
  puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] }
});

client.on("qr", qr => {
  qrCodeData = qr;
  console.log("Nuevo QR generado. Visita /qr para verlo.");
});

client.on("ready", () => {
  qrCodeData = null; // limpiamos QR una vez autenticado
  console.log("WhatsApp listo ✅");
});

client.on("message", msg => handleIncomingMessage(msg, sendMessage));

function sendMessage(to, message) {
  return client.sendMessage(`${to.replace(/\D/g, "")}@c.us`, message);
}

function getQrCode() {
  return qrCodeData;
}

function start() {
  client.initialize();
}

module.exports = { start, sendMessage, getQrCode };