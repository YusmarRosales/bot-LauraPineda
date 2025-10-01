/**
 * Convierte **bold** (Markdown) a *bold* (WhatsApp) y
 * elimina encabezados "### " al inicio de línea.
 * Respeta texto dentro de `inline code` y ```bloques``` de código.
 */
function formatWhatsAppText(input) {
  if (!input) return input;

  // Paso 1: recorrer carácter por carácter para respetar código y convertir ** -> *
  let tmp = '';
  let i = 0;
  let inBlock = false;  // entre ```
  let inInline = false; // entre `
  while (i < input.length) {
    // toggle bloque ```
    if (!inInline && input.startsWith('```', i)) {
      inBlock = !inBlock;
      tmp += '```';
      i += 3;
      continue;
    }
    // toggle inline `
    if (!inBlock && input[i] === '`') {
      inInline = !inInline;
      tmp += '`';
      i += 1;
      continue;
    }
    // ** -> * (solo fuera de código)
    if (!inBlock && !inInline && input.startsWith('**', i)) {
      tmp += '*';
      i += 2;
      continue;
    }
    tmp += input[i++];
  }

  // Paso 2: quitar "### " al inicio de línea fuera de bloques de código
  const lines = tmp.split(/\r?\n/);
  let inCodeBlock = false;
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    // ¿esta línea abre/cierra bloque?
    // procesamos el encabezado antes de togglear, usando el estado actual
    if (!inCodeBlock) {
      // elimina exactamente "### " (con 0-3 espacios previos)
      lines[idx] = line.replace(/^\s{0,3}###\s+/, '');
      // si quisieras eliminar TODOS los niveles (#, ##, ###...), usa:
      // lines[idx] = line.replace(/^\s{0,3}#{1,6}\s+/, '');
    }

    // toggles por cantidad de ``` en la línea
    const ticks = (line.match(/```/g) || []).length;
    if (ticks % 2 === 1) inCodeBlock = !inCodeBlock;
  }

  return lines.join('\n');
}

module.exports = { formatWhatsAppText };