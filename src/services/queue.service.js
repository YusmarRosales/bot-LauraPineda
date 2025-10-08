// Cola por número (chatId) con serialización y flush diferido.
//
// - Agrupa mensajes por ventana (WINDOW_MS).
// - Garantiza 1 procesamiento activo por chatId.
// - Si el timer vence mientras se procesa, marca "deferred" y
//   ejecuta un flush inmediato al terminar el lote activo.
// - Mensajes que llegan durante el procesamiento se acumulan:
//   * si el timer ya había vencido -> flush inmediato al terminar
//   * si no -> inicia una nueva ventana

const queues = new Map();
const WINDOW_MS = 5000;

// (textos juntos, imágenes independientes) ---
function coalesce(items) {
  const out = [];
  let textBuf = [];
  for (const it of items) {
    if (!it) continue;
    if (it.type === 'text') {
      const m = (it.message || it.text || '').trim();
      if (m) textBuf.push(m);
    } else if (it.type === 'image') {
      if (textBuf.length) {
        out.push({ type: 'text', text: textBuf.join(', ') });
        textBuf = [];
      }
      out.push({
        type: 'image',
        caption: it.caption || '',
        media: it.media, // { buffer, mimetype, filename, size }
      });
    }
  }
  if (textBuf.length) out.push({ type: 'text', text: textBuf.join(', ') });
  return out;
}

// --- helpers internos ---
function getOrCreateQueue(chatId, onFlush) {
  let q = queues.get(chatId);
  if (!q) {
    q = {
      items: [],
      timer: null,
      onFlush,
      processing: false, // hay un lote en curso
      deferred: false,   // el timer venció mientras processing
    };
    queues.set(chatId, q);
  } else if (onFlush && !q.onFlush) {
    q.onFlush = onFlush;
  }
  return q;
}

function startWindowTimer(chatId) {
  const q = queues.get(chatId);
  if (!q || q.timer) return;
  q.timer = setTimeout(() => flush(chatId), WINDOW_MS);
}

function clearWindowTimer(q) {
  if (q?.timer) {
    clearTimeout(q.timer);
    q.timer = null;
  }
}

// --- API pública ---
function enqueue(chatId, piece, onFlush) {
  const q = getOrCreateQueue(chatId, onFlush);
  q.items.push(piece);

  // Si no hay procesamiento, arrancamos ventana si no existe timer
  if (!q.processing && !q.timer) {
    startWindowTimer(chatId);
  }
}

async function flush(chatId) {
  const q = queues.get(chatId);
  if (!q) return;

  // este flush viene del timer, lo limpiamos
  clearWindowTimer(q);

  // si hay procesamiento activo, marcamos diferido y salimos
  if (q.processing) {
    q.deferred = true;
    return;
  }

  // si no hay items, limpiar estructura
  if (!q.items.length) {
    if (!q.timer && !q.processing) queues.delete(chatId);
    return;
  }

  // snapshot de items y buffer limpio
  const itemsToProcess = q.items.splice(0, q.items.length);
  const items = coalesce(itemsToProcess);

  q.processing = true;
  try {
    if (items.length && typeof q.onFlush === 'function') {
      await q.onFlush(chatId, { type: 'mixed', items });
    }
  } catch (e) {
    console.error('[queue] Error en onFlush:', e);
  } finally {
    q.processing = false;

    // si el timer venció mientras procesábamos => flush inmediato
    if (q.deferred) {
      q.deferred = false;
      if (q.items.length) {
        await flush(chatId);
        return;
      }
    }

    // si hay items nuevos y no hubo "deferred", abrimos nueva ventana
    if (q.items.length) {
      startWindowTimer(chatId);
    } else {
      // nada más por hacer, liberamos
      if (!q.timer && !q.processing) queues.delete(chatId);
    }
  }
}

function shutdownQueues() {
  for (const [id, q] of queues.entries()) {
    clearWindowTimer(q);
    queues.delete(id);
  }
}

// útil para inspeccionar en el controlador
function isProcessing(chatId) {
  const q = queues.get(chatId);
  return !!q?.processing;
}

module.exports = { enqueue, flush, shutdownQueues, isProcessing };