// src/services/alerts.service.js
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '';
const {parseAgents, jidToDisplay} = require("../utils/phone.util")

function parseSupportRecipients() {
  return SUPPORT_PHONE
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function truncate(str, n = 120) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function summarizeBatchItems(items = []) {
  const parts = [];
  items.forEach((it, idx) => {
    if (it.type === 'text') {
      parts.push(`T${idx + 1}="${truncate(it.text || '', 120)}"`);
    } else if (it.type === 'image') {
      const cap = truncate(it.caption || '', 80);
      parts.push(`IMG${idx + 1}${cap ? `:${cap}` : ''}`);
    } else {
      parts.push(`${(it.type || 'unknown').toUpperCase()}${idx + 1}`);
    }
  });
  return parts.join(' | ');
}

/**
 * Construye el texto del reporte para soporte.
 * Úsalo cuando el run quede en failed/expired (o el que tú decidas).
 */
function buildRunFailureReport({
  userPhone,
  wpp_name,
  threadId,
  runId,
  runStatus,
  runError,
  items,
}) {
  const when = new Date().toISOString();
  const header = '🚨 Asistente sin respuesta';
  const userLine = `Usuario: ${wpp_name ? `${wpp_name} (${userPhone})` : userPhone}`;
  const statusLine = `Estado run: ${runStatus}`;
  const errorLine = `Error: ${runError || 'n/a'}`;
  const idsLine = `Thread: ${threadId || 'n/a'} | Run: ${runId || 'n/a'}`;
  const batchLine = `Batch: ${summarizeBatchItems(items) || 'n/a'}`;
  const tsLine = `Fecha: ${when}`;

  return `${header}\n${userLine}\n${statusLine}\n${errorLine}\n${idsLine}\n${batchLine}\n${tsLine}`;
}

function buildInfraErrorReport({
  title = '🚨 Error en pipeline',
  phase = 'unknown',
  userPhone,
  wpp_name,
  error,
}) {
  const when = new Date().toISOString();
  const userLine = `Usuario: ${wpp_name ? `${wpp_name} (${userPhone})` : userPhone}`;
  const phaseLine = `Fase: ${phase}`;
  const errorLine = `Error: ${error?.message || String(error)}`;
  return [title, userLine, phaseLine, errorLine, `Fecha: ${when}`]
    .filter(Boolean)
    .join('\n');
}

/**
 * Envía el reporte a todos los destinatarios de SUPPORT_PHONE.
 * No lanza error si no hay destinatarios; simplemente no envía.
 */
async function notifySupport(sendMessage, messageText) {
  const recipients = parseSupportRecipients();
  if (!recipients.length || !messageText) return;
  await Promise.allSettled(recipients.map(to => sendMessage(to, messageText)));
}

async function notifyAttentionAgent(sendMessage, chatId) {
  const userDisp = jidToDisplay(chatId); 
  const texto=`🚨 *¡Alerta!*\nEl usuario ${userDisp} no obtuvo respuesta del bot. Por favor revisar la conversación.`
  for (const jid of parseAgents()) {
    await sendMessage(jid, texto);
  } 
  
}

/** Envía un texto a todos los ATTENTION_AGENT. Requiere message explícito. */
async function MessageToAttentionAgent(sendMessage, message) {
  const recipients = parseAgents();
  if (!recipients.length || !message) return;
  await Promise.allSettled(recipients.map(jid => sendMessage(jid, message)));
}

module.exports = {
  parseSupportRecipients,
  buildRunFailureReport,
  buildInfraErrorReport,
  notifySupport,
  notifyAttentionAgent,
  MessageToAttentionAgent,
};