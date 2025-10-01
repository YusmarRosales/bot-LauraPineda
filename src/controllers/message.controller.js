const { 
  transcribeAudioBuffer,
  createThread,
  addMessageToThread,
  createRun,
  waitForRunCompletion,
  getAssistantResponseText,
  uploadVisionImage,
  addImageToThread,
  submitToolOutputs,
} = require('../services/openai.service');
const {enqueue} = require("../services/queue.service")
const { isBotActive } = require('../services/settings.dbService');
const { findOrCreateUserByPhone, setUserThread, isUserBotEnabled } = require('../services/users.dbService');
const { 
  createIncomingMessage,
  setMessageResponse,
  setMessageStatus,
  setMessageRunMeta,
  setMessageMediaOpenAI
 } = require('../services/messages.dbService');

const {
  buildRunFailureReport,
  buildInfraErrorReport,
  notifySupport,
  notifyAttentionAgent,
} = require('../services/alerts.service');
const {isAttentionAgent} = require("../utils/phone.util")
const {handleAgentMessage} = require("./message.agent.controller")
const { runAssistantTools } = require('../services/assistant_tools.router');
const { formatWhatsAppText } = require('../utils/text.util');

function isStatusOrGroup(msg) {
  // Status
  if (msg.isStatus || msg.from === 'status@broadcast') return true;
  // Grupos
  if (typeof msg.from === 'string' && msg.from.endsWith('@g.us')) return true;
  return false;
}

function getCaptionFromMessage(msg) {
  // 1) Para media, la caption suele estar en body
  const fromBody = (typeof msg.body === 'string' ? msg.body : '').trim();
  // 2) Fallbacks por si el wrapper expone otra propiedad o necesitamos _data
  const fromCaptionProp = (typeof msg.caption === 'string' ? msg.caption : '').trim();
  const fromData = (typeof msg._data?.caption === 'string' ? msg._data.caption : '').trim();

  // Si no es texto puro (chat), prioriza body como caption
  if (msg.type !== 'chat' && fromBody) return fromBody;
  return fromCaptionProp || fromData || fromBody || '';
}

async function handleIncomingMessage(msg, sendMessage) {
  let phase = 'start';
  try {
    // Filtrar estados/grupos
    if (isStatusOrGroup(msg)) return;

    //  flujo admin independiente
    if (isAttentionAgent(msg.from)) {
      await handleAgentMessage(msg, sendMessage);
      return;
    }

    // Verificar si el bot está activo
    phase = 'check-bot-active';
    const botActive = await isBotActive();
    if (!botActive) {
      return;
    }

    phase = 'check-user-enabled';
    const userEnabled = await isUserBotEnabled(msg.from);
    if (!userEnabled) {
      console.log(`🔕 Usuario ${msg.from} silenciado, mensaje ignorado.`);
      return;
    }

    // --- Procesar mensajes válidos ---
    console.log(`Mensaje de ${msg.from} - Tipo ${msg.type}: ${msg.body}`);

    // Normalizar por tipo de mensaje
    let normalized = null;

    phase = 'normalize';
    if (msg.type === 'chat') {
      normalized = { type: 'text', message: (msg.body || '').trim() };
    } else if(msg.type === 'sticker'){
      return;
    } else if (msg.hasMedia) {
      const media = await msg.downloadMedia(); // { data: base64, mimetype, filename? }
      if (!media || !media.data) return;

      const base64 = media.data;
      const buffer = Buffer.from(base64, 'base64');
      const mimetype = (media.mimetype || '').split(';')[0] || 'application/octet-stream';

      if (mimetype.startsWith('audio/')) {
        const transcript = await transcribeAudioBuffer(buffer, mimetype);
        normalized = { type: 'text', message: transcript?.trim?.() || '' };
      }  else if (mimetype.startsWith('image/')) {
        // Imagen con caption
        const caption = getCaptionFromMessage(msg);
        const filename = media.filename || (`image.${mimetype.split('/')[1] || 'jpg'}`);
        normalized = {
          type: 'image',
          caption,
          media: { buffer, mimetype, filename, size: buffer.length },
        };
      } else {
        return;
      }
    } else {
      return; // ignorar otros tipos por ahora
    }

    if (!normalized) return;

    const contact = await msg.getContact();
    const wppName = contact?.pushname || contact?.name || null;

    // Encolar por número (60s). Al vencer, se procesa TODO junto.
    phase = 'enqueue';
    enqueue(msg.from, normalized, async (chatId, batched) => {
      await processBatchedMessage(chatId, batched, sendMessage, { wpp_name: wppName });
    });

  } catch(e){
    console.error('Error en handleIncomingMessage:', e);
    try {
      await notifyAttentionAgent(sendMessage, msg?.from)

      const report = buildInfraErrorReport({
        title: '🚨 Error en handleIncomingMessage',
        phase,
        userPhone: msg?.from,
        wpp_name: msg?._data?.notifyName || null,
        error: e,
      });
      await notifySupport(sendMessage, report);
    } catch (nErr) {
      console.error('Error notificando a soporte (handleIncomingMessage):', nErr?.message);
    }
  }
}

// Procesamiento final (Procesar con Api de Asistentes)
async function processBatchedMessage(chatId, batched, sendMessage, { wpp_name } = {}) {
  try{
    let user = await findOrCreateUserByPhone(chatId, { wpp_name });
    let threadId = user?.thread || null;

    // Si no tiene thread, créalo y guárdalo
    if (!user.thread) {
      const newThreadId = await createThread();
      user = await setUserThread(user._id, newThreadId);
      threadId = user.thread || newThreadId;
    }

    if (!threadId) throw new Error('No se obtuvo threadId');

    const createdDocs = [];

    // Crear documentos (pending) y cargar al hilo en orden
    for (const item of batched.items) {
      if (item.type === 'text') {
        const doc = await createIncomingMessage({
          userId: user._id,
          phone: user.phone,
          type: 'text',
          text: item.text,
          threadId,
        });
        createdDocs.push(doc);
        await addMessageToThread(threadId, item.text, 'user');

      } else if (item.type === 'image') {
        // Persistir entrada de imagen (sin fileId aún)
        const doc = await createIncomingMessage({
          userId: user._id,
          phone: user.phone,
          type: 'image',
          caption: item.caption || null,
          threadId,
          media: {
            kind: 'image',
            mimetype: item.media?.mimetype,
            filename: item.media?.filename,
            size: item.media?.size,
          },
        });
        createdDocs.push(doc);

        // Subir la imagen a OpenAI con purpose 'vision' y referenciarla en el thread
        const uploaded = await uploadVisionImage(
          item.media.buffer,
          item.media.filename,
          item.media.mimetype
        );
        await setMessageMediaOpenAI(doc._id, { openaiFileId: uploaded.id, openaiPurpose: 'vision' });

        // Agregar mensaje de imagen (independiente) al thread, con caption si existe
        await addImageToThread(threadId, uploaded.id, item.caption || '');
      }
    }

    const runObj = await createRun(threadId);
    if (!runObj?.id || !String(runObj.id).startsWith('run_')) {
      throw new Error(`createRun devolvió un id inválido: ${runObj?.id}`);
    }
  
    let finalRun = await waitForRunCompletion(threadId, runObj.id);

    while (finalRun.status === 'requires_action' && finalRun.required_action?.type === 'submit_tool_outputs') {
      const toolCalls = finalRun.required_action.submit_tool_outputs.tool_calls || [];
        const toolOutputs = await runAssistantTools(toolCalls, {
        chatId,
        wpp_name,
        sendMessage,   // para notificar a agentes cuando se concrete la reserva
      });
      await submitToolOutputs(threadId, runObj.id, toolOutputs);
      finalRun = await waitForRunCompletion(threadId, runObj.id);
    }

    // Preparar datos para persistir SOLO en el último documento
    const lastDoc = createdDocs[createdDocs.length - 1];
    const otherDocs = createdDocs.slice(0, -1);

    let replyText = '';
    let runStatus = finalRun.status;
    let runError = finalRun?.last_error?.message || null;
    let runUsage = finalRun?.usage || null;

    // Tomar respuesta del assistant (o mensaje de fallback)
    console.log("Run status: ", finalRun.status)
    if (finalRun.status === 'completed') {
      replyText = await getAssistantResponseText(threadId);
    } else if (finalRun.status === 'requires_action') {
      replyText = 'Necesito realizar una acción adicional que aún no está implementada.';
    } else {
      await notifyAttentionAgent(sendMessage, chatId)
      const report = buildRunFailureReport({
        userPhone: chatId,
        wpp_name,
        threadId,
        runId: runObj.id,
        runStatus,
        runError,
        items: batched.items,
      });
      // Importante: que la notificación no bloquee el flujo
      try { await notifySupport(sendMessage, report); } catch (e) { console.warn('notifySupport falló:', e?.message); }
      //Expired or failed
      replyText = null;
    }

    // Enviar respuesta a WhatsApp
    const replyClean = replyText ? formatWhatsAppText(replyText) : null;
    if(replyClean){
      await sendMessage(chatId, replyClean);
    }

    // Los documentos anteriores: solo status
    const statusForOthers = (runStatus === 'completed') ? 'answered' : 'error';
    if (otherDocs.length) {
      await Promise.all(otherDocs.map(doc => setMessageStatus(doc._id, statusForOthers)));
    }

    // Último documento: meta del run + (respuesta o error) + status según haya respuesta
    await setMessageRunMeta(lastDoc._id, {
      runId: runObj.id,
      runStatus,
      runError,
      runUsage,
    });

    // Actualizar el documento del mensaje con la respuesta y estado "answered"
    await setMessageResponse(
      lastDoc._id,
      runStatus === 'completed' ? replyClean : null,    // respuesta solo si completed
      { status: runStatus === 'completed' ? 'answered' : 'error' }
    );

  } catch(e){
    console.error("Error al procesar mensaje con asistentes: ", e)
    try {
      await notifyAttentionAgent(sendMessage, chatId)
      const report = `🚨 Error en processBatchedMessage: ${e?.message || e}\nUsuario: ${chatId}\nFecha: ${new Date().toISOString()}`;
      await notifySupport(sendMessage, report);
    } catch (e) {console.error("Error al notificar falla en processBatchedMessage: ", e)}
  }
}

module.exports = { handleIncomingMessage };
