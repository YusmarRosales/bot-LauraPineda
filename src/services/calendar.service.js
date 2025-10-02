// src/services/calendar.service.js
const { google } = require('googleapis');

const CAL_ID = process.env.GOOGLE_CALENDAR_ID;
const TZ = process.env.DOCTOR_TZ || 'America/Caracas';
const VE_SLOTS = ['09:00', '11:00', '14:00', '16:00', '18:30']; // 18:30 solo online

function getJwtAuth() {
  // Prioridad: GOOGLE_CREDENTIALS_JSON (prod), si no GOOGLE_APPLICATION_CREDENTIALS (dev)
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    const json = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON)
    return new google.auth.JWT(
      json.client_email,
      null,
      json.private_key,
      ['https://www.googleapis.com/auth/calendar'],
    );
  }
  // Si tienes GOOGLE_APPLICATION_CREDENTIALS (ruta a archivo)
  return new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
}

function toRFC3339(dateStr, timeStr, tz = TZ) {
  // dateStr: 'YYYY-MM-DD', timeStr: 'HH:mm'
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '09:00').split(':').map(Number);

  // Usamos un instante "de referencia" en UTC
  const probeUTC = new Date(Date.UTC(y, (m - 1), d, hh, mm, 0));

  // Pedimos el offset exacto de esa fecha/hora en el timezone deseado
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',   // ← clave: 'GMT-04:00'
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour12: false,
  }).formatToParts(probeUTC);

  const tzName = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+00:00';
  // Extraemos "+/-HH:MM"
  let offset = '+00:00';
  const mOffset = tzName.match(/GMT([+-]\d{2}):?(\d{2})?/);
  if (mOffset) {
    offset = `${mOffset[1]}:${mOffset[2] || '00'}`; // soporta 'GMT-04' y 'GMT-04:00'
  }

  const HH = String(hh).padStart(2, '0');
  const MM = String(mm).padStart(2, '0');

  return `${dateStr}T${HH}:${MM}:00${offset}`;
}

function isWorkingDay(dateStr, tz = TZ) {
  const dt = new Date(`${dateStr}T12:00:00`);
  const day = dt.getUTCDay(); // 0=Sun
  // Para exactitud por TZ usa librería; simplificamos: Lun–Vie
  return day >= 1 && day <= 5;
}

function allowedSlot(time, modality) {
  if (!VE_SLOTS.includes(time)) return false;
  if (time === '18:30' && modality !== 'online') return false;
  return true;
}

function addMinutes(rfc, mins) {
  const d = new Date(rfc);
  if (isNaN(d.getTime())) {
    throw new RangeError(`Invalid RFC3339 datetime: "${rfc}"`);
  }
  d.setMinutes(d.getMinutes() + mins);
  return d.toISOString();
}

async function freebusy(auth, timeMin, timeMax) {
  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin,
      timeMax,
      timeZone: TZ,
      items: [{ id: CAL_ID }],
    },
  });
  const busy = res.data.calendars?.[CAL_ID]?.busy || [];
  return busy; // [{ start, end }, ...]
}

function overlaps(startA, endA, startB, endB) {
  return (startA < endB) && (startB < endA);
}

async function isSlotFree(auth, dateStr, timeStr, durationMin = 120) {
  // Construye ventana del día para freebusy y verifica el slot puntual
  const startRFC = toRFC3339(dateStr, timeStr, TZ);
  const endRFC = addMinutes(startRFC, durationMin);

  // Consultamos el día completo para eficiencia simple
  const dayStart = toRFC3339(dateStr, '00:00', TZ);
  const dayEnd = toRFC3339(dateStr, '23:59', TZ);
  const busy = await freebusy(auth, dayStart, dayEnd);

  for (const b of busy) {
    if (overlaps(new Date(startRFC), new Date(endRFC), new Date(b.start), new Date(b.end))) {
      return false;
    }
  }
  return true;
}

async function getDayAvailability(auth, dateStr, modality, durationMin = 120) {
  const free = [];
  for (const t of VE_SLOTS) {
    if (!allowedSlot(t, modality)) continue;
    if (await isSlotFree(auth, dateStr, t, durationMin)) free.push(t);
  }
  return free;
}

async function checkAvailability({ date, modality, duration_minutes = 120, requested_time = null }) {
  if (!date || !modality) return { ok: false, error: 'date y modality son requeridos' };

  const auth = await getJwtAuth();
  if (auth.authorize) await new Promise((res, rej) => auth.authorize(err => err ? rej(err) : res()));

  const available_slots = await getDayAvailability(auth, date, modality, duration_minutes);
  const requested_time_available =
    requested_time && allowedSlot(requested_time, modality) && available_slots.includes(requested_time);

  return { ok: true, available_slots, requested_time_available: !!requested_time_available };
}

async function bookAppointment({ date, time, modality, duration_minutes = 60, patient_name, patient_phone, notes }) {
  if (!date || !time || !modality || !patient_name || !patient_phone) {
    return { ok: false, error: 'Faltan parámetros obligatorios.' };
  }
  if (!allowedSlot(time, modality)) {
    return { ok: false, error: 'La hora elegida no es válida para la modalidad.' };
  }

  const auth = await getJwtAuth();
  if (auth.authorize) await new Promise((res, rej) => auth.authorize(err => err ? rej(err) : res()));

  const free = await isSlotFree(auth, date, time, duration_minutes);
  if (!free) {
    return { ok: false, error: 'La hora ya no está disponible.' };
  }

  // Crear evento
  const calendar = google.calendar({ version: 'v3', auth });
  const startRFC = toRFC3339(date, time, TZ);
  const endRFC = addMinutes(startRFC, duration_minutes);
  const summary = `Consulta ${modality} - ${patient_name}`;
  const description =
    `Paciente: ${patient_name}\nTel: ${patient_phone}\nModalidad: ${modality}\nNotas: ${notes || '-'}`;

  const res = await calendar.events.insert({
    calendarId: CAL_ID,
    requestBody: {
      summary, description,
      start: { dateTime: startRFC, timeZone: TZ },
      end:   { dateTime: endRFC, timeZone: TZ },
    },
  });

  const ev = res.data;
  return {
    ok: true,
    booked: {
      date, time, modality, duration_minutes,
      description,
      eventId: ev.id,
      //hangoutLink: ev.hangoutLink || null,
      //htmlLink: ev.htmlLink || null,
    }
  };
}

async function firstAvailableSlot(auth, dateStr, modality, durationMin = 120) {
  for (const t of VE_SLOTS) {
    if (!allowedSlot(t, modality)) continue;
    if (await isSlotFree(auth, dateStr, t, durationMin)) {
      return t;
    }
  }
  return null;
}

async function createEvent(auth, { date, time, duration_minutes = 120, summary, description }) {
  const calendar = google.calendar({ version: 'v3', auth });
  const startRFC = toRFC3339(date, time, TZ);
  const endRFC = addMinutes(startRFC, duration_minutes);

  const res = await calendar.events.insert({
    calendarId: CAL_ID,
    requestBody: {
      summary,
      description,
      start: { dateTime: startRFC, timeZone: TZ },
      end: { dateTime: endRFC, timeZone: TZ },
    },
  });
  return res.data; // event
}

/** Punto principal: revisa regla, disponibilidad y agenda (si procede) */
async function checkAndBook({ date, time, modality, duration_minutes = 120, patient_name, patient_phone, notes }) {
  if (!date || !modality || !patient_name || !patient_phone) {
    return { ok: false, error: 'Faltan parámetros obligatorios.' };
  }
  if (!isWorkingDay(date, TZ)) {
    return { ok: false, error: 'La doctora atiende de lunes a viernes.' };
  }

  const auth = await getJwtAuth();
  if (auth.authorize) {
    await new Promise((resolve, reject) => auth.authorize(err => err ? reject(err) : resolve()));
  }


  // Validar/ajustar slot
  let slot = time && time.trim() ? time.trim() : null;
  if (slot && !allowedSlot(slot, modality)) {
    slot = null; // no permitido → forzar búsqueda
  }
  if (!slot) {
    const cand = await firstAvailableSlot(auth, date, modality, duration_minutes);
    if (!cand) {
      return { ok: false, error: 'No hay disponibilidad ese día.', suggestions: [] };
    }
    slot = cand;
  } else {
    const free = await isSlotFree(auth, date, slot, duration_minutes);
    if (!free) {
      const cand = await firstAvailableSlot(auth, date, modality, duration_minutes);
      if (!cand) {
        return { ok: false, error: 'La hora solicitada no está disponible.', suggestions: [] };
      }
      slot = cand;
    }
  }

  // Agenda
  const summary = `Consulta ${modality} - ${patient_name}`;
  const description = `Paciente: ${patient_name}\nTel: ${patient_phone}\nModalidad: ${modality}\nNotas: ${notes || '-'}`;
  const event = await createEvent(auth, { date, time: slot, duration_minutes, summary, description });

  return {
    ok: true,
    booked: {
      date,
      time: slot,
      modality,
      duration_minutes,
      //eventId: event.id,
      //hangoutLink: event.hangoutLink || null,
      //htmlLink: event.htmlLink || null,
    }
  };
}



module.exports = {
  checkAndBook,
  allowedSlot,
  firstAvailableSlot,
  isSlotFree,
  checkAvailability,
  bookAppointment,
};
