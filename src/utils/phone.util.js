const VE_MOBILE_PREFIXES = new Set(['412','414','416','424','426','422']);

function ensureJid(target) {
  // Acepta: "573249208565", "+57 324 920 8565", "573249208565@c.us"
  if (!target) return null;
  const s = String(target).trim();
  if (s.includes('@')) return s;                      // ya es JID
  const digits = s.replace(/[^\d]/g, '');             // sólo números
  if (!digits) return null;
  return `${digits}@c.us`;
}

function jidToDisplay(jidOrPhone) {
  // "573249208565@c.us" -> "+573249208565"
  if (!jidOrPhone) return '';
  const digits = String(jidOrPhone).split('@')[0].replace(/[^\d]/g, '');
  return digits ? `+${digits}` : '';
}

function parseAgents(env = process.env.ATTENTION_AGENT) {
  return String(env || '')
    .split(/[,\s]+/)       // coma o espacios
    .map(ensureJid)
    .filter(Boolean);
}

function isAttentionAgent(jid) {
  const agents = parseAgents();     // si prefieres rendimiento, cachea en módulo
  return agents.includes(jid);
}

// Normaliza un input de admin a JID con fallback VE:
// - acepta: "+58...", "58...", "0...", "0424...", "424...", "573..."
// - si empieza en "0", hace VE: "0XXXXXXXXXX" -> "58XXXXXXXXX"
function ensureJidWithVEFallback(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (s.includes('@')) return s;                  // ya es JID

  // Solo dígitos
  let digits = s.replace(/[^\d]/g, '');
  if (!digits) return null;

  // Si inicia en 0 => quitar 0 y prefijar 58
  if (digits.startsWith('0')) {
    digits = '58' + digits.slice(1);
  }

  else if (digits.length === 10 && VE_MOBILE_PREFIXES.has(digits.slice(0,3))) {
    digits = '58' + digits;
  }

  // Validación mínima: requerimos al menos 11 dígitos para construir JID sensato
  if (digits.length < 11) return null;

  return `${digits}@c.us`;
}

module.exports = {
  jidToDisplay,
  ensureJid,
  parseAgents,
  isAttentionAgent,
  ensureJidWithVEFallback,
}