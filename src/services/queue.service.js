// Cola por número (chatId). Cada entrada tiene {items:[], timer:null}
const queues = new Map();
const WINDOW_MS = 5000;

function enqueue(chatId, piece, onFlush) {
  let q = queues.get(chatId);

  if (!q) {
    q = { items: [], timer: null, onFlush };
    queues.set(chatId, q);

    // inicia ventana de 10s
    q.timer = setTimeout(async () => {
      await flush(chatId);
    }, WINDOW_MS);
  }

  q.items.push(piece);
}

function coalesce(items) {
  const out = [];
  let textBuf = [];
  for (const it of items) {
    if (!it) continue;
    if (it.type === 'text') {
      const m = (it.message || '').trim();
      if (m) textBuf.push(m);
    } else if (it.type === 'image') {
      if (textBuf.length) { out.push({ type: 'text', text: textBuf.join(', ') }); textBuf = []; }
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

async function flush(chatId) {
  const q = queues.get(chatId);
  if (!q) return;

  clearTimeout(q.timer);
  q.timer = null;

  // Unimos todos los mensajes en text - image
  const items = coalesce(q.items);
  const onFlush = q.onFlush;
  queues.delete(chatId);

  
  if (items.length && typeof onFlush === 'function') {
    await onFlush(chatId, { type: 'mixed', items });
  }
}

function shutdownQueues() {
  for (const [id, q] of queues) { if (q.timer) clearTimeout(q.timer); queues.delete(id); }
}

module.exports = { enqueue, flush, shutdownQueues };