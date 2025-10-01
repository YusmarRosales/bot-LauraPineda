const { checkAvailability, bookAppointment } = require('./calendar.service');
const { jidToDisplay } = require('../utils/phone.util');
const {MessageToAttentionAgent} = require("./alerts.service")
const { setUserBotEnabled } = require('../services/users.dbService');

async function runAssistantTools(toolCalls, context = {}) {
  const outputs = [];
  const { chatId, wpp_name, sendMessage } = context;

  for (const call of toolCalls) {
    const name = call.function?.name;
    let args = {};
    try { args = JSON.parse(call.function?.arguments || '{}'); } catch {}
    console.log(" fuction name: ", name, " arg:\n", args)
    try {
      if (name === 'check_availability') {
        const result = await checkAvailability(args);
        outputs.push({ tool_call_id: call.id, output: JSON.stringify(result) });
      } else if (name === 'book_appointment') {
        if (!args.patient_phone && chatId) {
          args.patient_phone = jidToDisplay(chatId); // sin @c.us y con '+'
        }
        if (!args.patient_name && wpp_name) {
          args.patient_name = wpp_name;
        }
        const result = await bookAppointment(args);
        outputs.push({ tool_call_id: call.id, output: JSON.stringify(result) });
        // 📣 Notificar al agente si se agendó con éxito
        if (result?.ok && result?.booked && typeof sendMessage === 'function') {
          const msg =
            `📅 *Nueva cita confirmada*\n\n` +
            `Paciente: ${args.patient_name || '-'}\n` +
            `Tel: ${args.patient_phone || '-'}\n` +
            `Modalidad: ${args.modality}\n` +
            `Fecha: ${args.date} - ${args.time}\n`;

          try { await MessageToAttentionAgent(sendMessage, msg); } catch {}
        }
      } else if (name === 'escalate_to_human') {
        const { reason, details, urgency = 'normal' } = args;
        const userDisp = jidToDisplay(chatId);

        // 1) Mensaje al/los agentes
        const message =
          `🆘 *Escalada a humano*\n\n` +
          `*Usuario*: ${wpp_name ? `${wpp_name} (${userDisp})` : userDisp}\n` +
          `*Urgencia*: ${urgency}\n` +
          `*Motivo*: ${reason}\n` +
          (details ? `*Detalles*: ${details}\n` : '');

        try { await MessageToAttentionAgent(sendMessage, message); } catch {}

        // 2) Apagar al usuario (no más respuestas del bot)
        try { await setUserBotEnabled(chatId, false); } catch {}

        // 3) Output para el Assistant (para que redacte respuesta al usuario)
        outputs.push({
          tool_call_id: call.id,
          output: JSON.stringify({ ok: true, user_disabled: true })
        });

      } else {
        outputs.push({ tool_call_id: call.id, output: JSON.stringify({ ok:false, error:`Función no implementada: ${name}` }) });
      }
    } catch (e) {
      outputs.push({ tool_call_id: call.id, output: JSON.stringify({ ok:false, error: e.message || String(e) }) });
    }
  }

  return outputs;
}

module.exports = { runAssistantTools };