// src/cron/update_assistant_date.cron.js
const cron = require('node-cron');
const { DateTime } = require('luxon');
const { getAssistantInstructions, updateAssistantInstructions } = require('../src/services/openai.service');
const { notifySupport } = require('../src/services/alerts.service'); // opcional si quieres avisar ante error

const TZ = process.env.DOCTOR_TZ || 'America/Caracas';

/** Construye etiqueta: "lunes 2025-08-25" en tz Venezuela */
function buildDateLabel(tz = TZ) {
  const now = DateTime.now().setZone(tz).setLocale('es');
  const day = now.toFormat('cccc').toLowerCase();    // lunes, martes...
  const ymd = now.toFormat('yyyy-LL-dd');            // 2025-08-26
  return `${day} ${ymd}`;
}

function replaceBracketedDate(instructions, tz = TZ) {
  const label = buildDateLabel(tz); // ej: "martes 2025-08-26".
  const lines = instructions.split(/\r?\n/);
  let foundAtLeastOne = false;

  const lineRegex = /(Fecha\s*actual\s*\[)[^\]]*(\])/i; // sin ancla; matchea en cualquier parte de la línea

  const updated = lines.map(line => {
    const replaced = line.replace(lineRegex, (_, p1, p2) => {
      foundAtLeastOne = true;
      return `${p1}${label}${p2}`;
    });
    return replaced;
  });

  if (!foundAtLeastOne) {
    return `# Fecha actual [${label}]\n${instructions}`;
  }

  return updated.join('\n');
}

/** Trabajo del cron */
async function updateAssistantDateOnce() {
  const assistantId = process.env.OPENAI_ASSISTANT_ID;
  if (!assistantId) throw new Error('Falta OPENAI_ASSISTANT_ID');

  const before = await getAssistantInstructions(assistantId);
  const after = replaceBracketedDate(before, TZ);

  if (after === before) {
    console.log('[assistant-date] No hay cambios en instrucciones.');
    return;
  }

  await updateAssistantInstructions(after, assistantId);
  console.log('[assistant-date] Instrucciones actualizadas con nueva fecha.');
}

/** Programa el cron: medianoche América/Caracas */
function start() {
  // “0 0 * * *” = a las 00:00 todos los días
  cron.schedule('0 0 * * *', async () => {
    try {
      await updateAssistantDateOnce();
    } catch (e) {
      console.error('[assistant-date] Error actualizando fecha:', e?.message || e);
      try {
        console.error(`⚠️ Error actualizando "Fecha actual" del Assistant: ${e?.message || e}`);
      } catch {}
    }
  }, { timezone: TZ });

  console.log(`[assistant-date] Cron programado a medianoche (${TZ}).`);
}

module.exports = { start, updateAssistantDateOnce, replaceBracketedDate, buildDateLabel };