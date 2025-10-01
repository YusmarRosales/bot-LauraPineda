const OpenAI = require('openai');
const { toFile } = require('openai/uploads');

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Recibe Buffer y mimetype (p.ej. 'audio/ogg')
async function transcribeAudioBuffer(buffer, mimetype = 'audio/ogg') {
  try{
  const file = await toFile(buffer, `audio.${extFromMime(mimetype)}`, {
    contentType: mimetype,
  });

  const resp = await client.audio.transcriptions.create({
    file,
    model: 'whisper-1',
  });

  return resp.text || '';

  } catch(e){
    console.error("Error al transcribir audio: ", e?.message)
    throw e;
  }
}

function extFromMime(mime) {
  if (!mime) return 'ogg';
  const map = {
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/3gpp': '3gp',
  };
  return map[mime] || 'ogg';
}

async function createThread() {
  try{
    const emptyThread = await client.beta.threads.create();
    return emptyThread.id;
  } catch(e){
    console.error("Error en createThread: ", e.message)
    throw e;
  }
}

/** Agrega un mensaje de usuario al thread */
async function addMessageToThread(threadId, content, role = 'user') {
  try{
    if (!threadId) throw new Error('addMessageToThread: threadId requerido');
    const threadMessages = await client.beta.threads.messages.create(threadId, { role, content });
    return threadMessages;
  }catch(e){
    console.error("Error en addMessageToThread: ", e.message)
    throw e;
  }
}

/** Crea un run contra el assistant configurado */
async function createRun(threadId, assistantId = process.env.OPENAI_ASSISTANT_ID, extra = {}) {
  try{
    if (!threadId) throw new Error('createRun: threadId requerido');
    if (!assistantId) throw new Error('Falta OPENAI_ASSISTANT_ID en el entorno');
    const run = await client.beta.threads.runs.create(threadId, { assistant_id: assistantId, ...extra });
    return run; 
  }catch(e){
    console.error("Error en createRun: ", e.message)
    throw e;
  }
}

/** Recupera el estado del run */
async function getRunStatus(threadId, runId) {
  try{
    if (!threadId || !runId) throw new Error('getRunStatus: threadId y runId requeridos');
    return client.beta.threads.runs.retrieve(runId, { thread_id: threadId});
  } catch(e){
    console.error("Error en getRunStatus: ", e.message)
    throw e;
  }
}

/** Lista mensajes del thread */
async function listThreadMessages(threadId, { limit = 10, order = 'desc' } = {}) {
  try{
    if (!threadId) throw new Error('listThreadMessages: threadId requerido');
    const page = await client.beta.threads.messages.list(threadId, { limit, order });
    return page.data;
  } catch(e){
    console.error("Error en listThreadMessages: ", e.message)
    throw e;
  }
}

/** Extrae texto plano del primer mensaje de role=assistant en una lista dada */
function extractAssistantText(messages) {
  try{
    for (const m of messages) {
      if (m.role === 'assistant' && Array.isArray(m.content)) {
        const parts = m.content
          .filter((c) => c.type === 'text' && c.text && c.text.value)
          .map((c) => c.text.value);
        if (parts.length) return parts.join('\n');
      }
    }
    return null;
  }catch(e){
    console.error("Error en extractAssistantText: ", e.message)
    throw e;
  }
}

/** Espera hasta que el run alcance un estado terminal o se agote el tiempo */
async function waitForRunCompletion(threadId, runId, { intervalMs = 5000, timeoutMs = 120000 } = {}) {
  try{
    if (!threadId || !runId) throw new Error('waitForRunCompletion: threadId y runId requeridos');
    const start = Date.now();
    const terminal = new Set(['completed', 'failed', 'cancelled', 'expired']);
    while (true) {
      const run = await getRunStatus(threadId, runId);
      if (terminal.has(run.status) || run.status === 'requires_action') return run;
      if (Date.now() - start > timeoutMs) throw new Error(`Timeout del run tras ${timeoutMs}ms`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }catch(e){
    console.error("Error en waitForRunCompletion: ", e.message)
    throw e;
  }
}

/** Devuelve la última respuesta de assistant (texto) del thread */
async function getAssistantResponseText(threadId) {
  try{
    const msgs = await listThreadMessages(threadId, { limit: 10, order: 'desc' });
    return extractAssistantText(msgs) || '';
  }catch(e){
    console.error("Error en getAssistantResponseText: ", e.message)
    throw e;
  }
}

/** Subir imagen */
async function uploadVisionImage(buffer, filename, mimetype) {
  try{
    const file = await toFile(buffer, filename || 'image.jpg', { contentType: mimetype });
    const created = await client.files.create({ file, purpose: 'vision' });
    return created; // { id: 'file_...' }
  }catch(e){
    console.error("Error en uploadVisionImage: ", e.message)
    throw e;
  }
}

/* Subir Imagen al hilo */
async function addImageToThread(threadId, fileId, caption = '') {
  try{
    if (!threadId) throw new Error('addImageToThread: threadId requerido');
    if (!fileId) throw new Error('addImageToThread: fileId requerido');
    const content = [{ type: 'image_file', image_file: { file_id: fileId } }];
    if (caption && caption.trim()) content.push({ type: 'text', text: caption.trim() });
    return client.beta.threads.messages.create(threadId, { role: 'user', content });
  } catch(e){
    console.error("Error en addImageToThread: ", e.message)
    throw e;
  }
}

async function submitToolOutputs(thread_id, runId, toolOutputs) {
  try{
    return client.beta.threads.runs.submitToolOutputs(runId, {
      thread_id,
      tool_outputs: toolOutputs,
    });
  }catch(e){
    console.error("Error en submitToolOutputs: ", e.message)
    throw e;
  }
}

/** Lee las instrucciones actuales del Assistant */
async function getAssistantInstructions(assistantId = process.env.OPENAI_ASSISTANT_ID) {
  try{
    if (!assistantId) throw new Error('Falta OPENAI_ASSISTANT_ID');
    const a = await client.beta.assistants.retrieve(assistantId);
    return a.instructions || '';
  }catch(e){
    console.error("Error en getAssistantInstructions: ", e.message)
    throw e;
  }
}

/** Actualiza las instrucciones del Assistant */
async function updateAssistantInstructions(newInstructions, assistantId = process.env.OPENAI_ASSISTANT_ID) {
   try{
    if (!assistantId) throw new Error('Falta OPENAI_ASSISTANT_ID');
    const a = await client.beta.assistants.update(assistantId, {
      instructions: newInstructions
    });
    return a.instructions || '';
  }catch(e){
    console.error("Error en updateAssistantInstructions: ", e.message)
    throw e;
  }
}

module.exports = { 
  transcribeAudioBuffer,
  createThread,
  addMessageToThread,
  createRun,
  getRunStatus,
  waitForRunCompletion,
  listThreadMessages,
  getAssistantResponseText,
  extractAssistantText,
  uploadVisionImage,
  addImageToThread,
  submitToolOutputs,
  getAssistantInstructions,
  updateAssistantInstructions,
};