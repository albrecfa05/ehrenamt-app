// Lesen von Kalender-Abos im iCalendar-Format (ICS), z. B. Mannschafts-Spielpläne aus click-TT/nuLiga
// oder Hallenbelegungen der Gemeinde. Nur lesend (DAT-3). Spielpläne sind öffentlich (grün, 5.8).

const TZ = 'Europe/Berlin';

/** Zerlegt eine ICS-Datei in Termine: { uid, summary, location, description, date, time, end_time, allDay } */
export function parseIcs(text) {
  // Zeilen entfalten (RFC 5545: Fortsetzungszeilen beginnen mit Leerzeichen oder Tab)
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/);
    if (!m) continue;
    const [, name, paramStr, value] = m;
    const params = Object.fromEntries(paramStr.split(';').filter(Boolean).map(p => p.split('=')));
    if (name === 'UID') cur.uid = value.trim();
    else if (name === 'SUMMARY') cur.summary = unescape(value);
    else if (name === 'LOCATION') cur.location = unescape(value);
    else if (name === 'DESCRIPTION') cur.description = unescape(value);
    else if (name === 'DTSTART') Object.assign(cur, toLocal(value, params, 'start'));
    else if (name === 'DTEND') Object.assign(cur, toLocal(value, params, 'end'));
    else if (name === 'STATUS') cur.status = value.trim().toUpperCase();
  }
  return events
    .filter(e => e.date && e.status !== 'CANCELLED')
    .map(e => ({
      uid: e.uid || `${e.date}-${e.time || ''}-${e.summary || ''}`,
      summary: (e.summary || 'Termin').slice(0, 200),
      location: (e.location || '').slice(0, 200),
      description: (e.description || '').slice(0, 2000),
      date: e.date, time: e.time || null, end_time: e.end_time || null, allDay: !e.time,
    }));
}

function unescape(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
}

const fmtLocal = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** DTSTART/DTEND in lokales Datum/Uhrzeit (Berlin) umrechnen. */
function toLocal(value, params, which) {
  const v = value.trim();
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    const date = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    return which === 'start' ? { date } : {};
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return {};
  let date = `${m[1]}-${m[2]}-${m[3]}`, time = `${m[4]}:${m[5]}`;
  if (m[7]) {
    // UTC → Berlin
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
    const [dd, tt] = fmtLocal.format(d).split(' ');
    date = dd; time = tt;
  }
  // Mit TZID oder ohne Zone: als lokale Zeit übernehmen (Spielpläne kommen in deutscher Zeit)
  return which === 'start' ? { date, time } : { end_time: time };
}

/** ICS von einer Adresse laden. Nur http(s), höchstens 5 MB. */
export async function fetchIcs(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Die Adresse muss mit http:// oder https:// beginnen.');
  const res = await fetch(url.replace(/^webcal:/i, 'https:'), { headers: { Accept: 'text/calendar, */*' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Abruf fehlgeschlagen (${res.status}).`);
  const text = await res.text();
  if (text.length > 5 * 1024 * 1024) throw new Error('Die Kalenderdatei ist zu groß.');
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Unter der Adresse liegt kein Kalender (ICS).');
  return parseIcs(text);
}

/**
 * Ist ein Spiel ein Heimspiel? Spielpläne schreiben meist „Heim - Gast“.
 * Muster = Teil des eigenen Vereinsnamens, z. B. „Hohberg“.
 */
export function isHomeGame(ev, pattern) {
  const p = String(pattern || '').trim().toLowerCase();
  if (!p) return false;
  const s = ev.summary.toLowerCase();
  const sep = s.match(/\s[-–:]\s|\svs\.?\s/);
  const home = sep ? s.slice(0, sep.index) : s;
  return home.includes(p) || (!sep && ev.location.toLowerCase().includes(p));
}
