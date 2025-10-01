const {setBotActive, isBotActive} = require("../services/settings.dbService")
const {ensureJid, jidToDisplay, ensureJidWithVEFallback} = require("../utils/phone.util")
const {setUserBotEnabled} = require("../services/users.dbService")

// Comandos: "bot on|off", "user on|off <telefono>", "status"
async function handleAgentMessage(msg, sendMessage) {
  const from = msg.from;
  const text = (msg.body || '').trim();

  console.log("text admin: ", text)

  // Solo procesamos texto; otros tipos se ignoran
  if (!text) return;

  // bot on/off
  const mBot = text.match(/^\/?\s*bot\s+(on|off)\b/i);
  if (mBot) {
    const on = mBot[1].toLowerCase() === 'on';
    await setBotActive(on);
    await sendMessage(from, `✅ Bot ${on ? 'activado' : 'desactivado'}.`);
    return;
  }

  // user on/off <telefono>
  const mUser = text.match(/^\/?\s*user\s+(on|off)\s+(.+)$/i);
  if (mUser) {
    const on = mUser[1].toLowerCase() === 'on';
    const raw = mUser[2];
    const targetJid = ensureJidWithVEFallback(raw);
    if (!targetJid || !/^\d{11,}@c\.us$/.test(targetJid)) {
      await sendMessage(from, '⚠️ Número inválido. Usa formatos como: 0424XXXXXXX, 58XXXXXXXXXX o +58XXXXXXXXXX');
      return;
    }
    await setUserBotEnabled(targetJid, on);
    await sendMessage(from, `✅ Usuario ${jidToDisplay(targetJid)} ${on ? 'habilitado' : 'deshabilitado'}.`);
    return;
  }

  // status
  if (/^\/?\s*status\b/i.test(text)) {
    const active = await isBotActive();
    await sendMessage(from, `ℹ️ Estado del bot: ${active ? 'ON' : 'OFF'}`);
    return;
  }

  // ayuda
  await sendMessage(from,
  `🛠 Comandos:
  • bot on | bot off
  • user on <telefono> | user off <telefono>
  • status`);
}

module.exports = {
  handleAgentMessage
}