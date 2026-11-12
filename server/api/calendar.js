// Jahreskalender (AUF-4), Terminansicht (AUF-11) und Kalender-Abo (ICS).

import { del, get, post, put } from '../http.js';
import { q } from '../db.js';
import { areaClause, assertArea, canSeeArea, requireAdmin } from '../access.js';
import { generateRecurring, nextOccurrence, occurrences } from '../services/scheduler.js';
import { randomToken } from '../auth.js';
import { addDays, audit, bad, dateOrNull, HttpError, int, isDate, notFound, nowIso, oneOf, str, today } from '../util.js';
import { experienceFor } from '../services/tasks.js';

const FREQ = ['jaehrlich', 'halbjaehrlich', 'quartalsweise', 'monatlich', 'woechentlich'];

get('/api/recurring', ({ user }) => {
  const ac = areaClause(user, 'r.area_id');
  return q.all(`SELECT r.*, a.name AS area_name, a.color AS area_color, o.name AS office_name, p.name AS template_name, u.name AS owner_name
                FROM recurring r JOIN areas a ON a.id = r.area_id LEFT JOIN offices o ON o.id = r.office_id
                LEFT JOIN process_templates p ON p.id = r.template_id LEFT JOIN users u ON u.id = r.owner_id
                WHERE ${ac.sql} ORDER BY a.type DESC, a.name, r.month, r.day`, ...ac.params)
    .map(r => {
      const last = q.get(`SELECT * FROM tasks WHERE recurring_id = ? ORDER BY created_at DESC LIMIT 1`, r.id);
      return { ...r, next_due: r.active ? nextOccurrence(r) : null, last_task: last ? { id: last.id, status: last.status, due_date: last.due_date } : null,
        experience: last ? experienceFor({ ...last, id: -1 }) : null };
    });
});

function cleanRecurring(b) {
  const d = {
    area_id: int(b.area_id, { nullable: false, name: 'Bereich' }),
    office_id: int(b.office_id),
    template_id: int(b.template_id),
    title: str(b.title, { required: true, max: 200, name: 'Titel' }),
    description: str(b.description, { max: 5000 }),
    freq: oneOf(b.freq, FREQ, { name: 'Rhythmus' }),
    month: int(b.month, { min: 1, max: 12, name: 'Monat' }),
    day: int(b.day, { min: 1, max: 31, name: 'Tag' }),
    lead_days: int(b.lead_days, { min: 0, max: 180, nullable: false, name: 'Vorlauf' }),
    owner_id: int(b.owner_id),
    assumption: b.assumption ? 1 : 0,
    active: b.active === false ? 0 : 1,
  };
  if (['jaehrlich', 'halbjaehrlich', 'quartalsweise'].includes(d.freq) && !d.month) throw bad('Bitte einen Monat angeben.');
  if (d.freq === 'woechentlich' && (!d.day || d.day > 7)) throw bad('Bitte einen Wochentag (1 = Montag … 7 = Sonntag) angeben.');
  if (!d.day) d.day = 1;
  return d;
}

post('/api/recurring', ({ user, body }) => {
  requireAdmin(user);
  const d = cleanRecurring(body);
  assertArea(user, d.area_id);
  const r = q.run(`INSERT INTO recurring (area_id, office_id, template_id, title, description, freq, month, day, lead_days, owner_id, assumption, active)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    d.area_id, d.office_id, d.template_id, d.title, d.description, d.freq, d.month, d.day, d.lead_days, d.owner_id, d.assumption, d.active);
  audit(user, { entity: 'recurring', entityId: Number(r.lastInsertRowid), areaId: d.area_id, action: 'angelegt', summary: `Jahreskalender: „${d.title}“ angelegt` });
  return { id: Number(r.lastInsertRowid) };
});

put('/api/recurring/:id', ({ user, params, body }) => {
  requireAdmin(user);
  const r = q.get('SELECT * FROM recurring WHERE id = ?', int(params.id));
  if (!r) throw notFound();
  const d = cleanRecurring({ ...r, ...body });
  q.run(`UPDATE recurring SET area_id = ?, office_id = ?, template_id = ?, title = ?, description = ?, freq = ?, month = ?, day = ?, lead_days = ?,
         owner_id = ?, assumption = ?, active = ? WHERE id = ?`,
    d.area_id, d.office_id, d.template_id, d.title, d.description, d.freq, d.month, d.day, d.lead_days, d.owner_id, d.assumption, d.active, r.id);
  audit(user, { entity: 'recurring', entityId: r.id, areaId: d.area_id, action: 'geändert', summary: `Jahreskalender: „${d.title}“ geändert` });
  return { ok: true };
});

del('/api/recurring/:id', ({ user, params }) => {
  requireAdmin(user);
  const r = q.get('SELECT * FROM recurring WHERE id = ?', int(params.id));
  if (!r) throw notFound();
  q.run('UPDATE recurring SET active = 0 WHERE id = ?', r.id);
  audit(user, { entity: 'recurring', entityId: r.id, areaId: r.area_id, action: 'deaktiviert', summary: `Jahreskalender: „${r.title}“ deaktiviert` });
});

// Jetzt prüfen, ob Aufgaben anzulegen sind (sonst täglich automatisch)
post('/api/recurring/generate', ({ user }) => {
  requireAdmin(user);
  const ids = generateRecurring();
  audit(user, { entity: 'recurring', action: 'erzeugt', summary: `Jahreskalender von Hand geprüft: ${ids.length} Aufgabe(n) angelegt` });
  return { created: ids.length };
});

// ---------- Terminansicht ----------

get('/api/calendar', ({ user, query }) => {
  const from = isDate(query.from) ? query.from : today().slice(0, 8) + '01';
  const to = isDate(query.to) ? query.to : addDays(from, 41);
  if (Date.parse(to) - Date.parse(from) > 400 * 86_400_000) throw bad('Zeitraum zu groß.');
  const ac = areaClause(user, 't.area_id');
  const areaFilter = query.area ? ' AND t.area_id = ' + int(query.area) : '';
  const tasks = q.all(`SELECT t.id, t.title, t.due_date AS date, t.status, t.area_id, a.name AS area_name, a.color AS area_color, u.name AS owner_name, t.kind
                       FROM tasks t JOIN areas a ON a.id = t.area_id LEFT JOIN users u ON u.id = t.owner_id
                       WHERE ${ac.sql}${areaFilter} AND t.due_date BETWEEN ? AND ? AND t.status <> 'verworfen'`, ...ac.params, from, to);
  const events = q.all(`SELECT e.*, a.name AS area_name, a.color AS area_color FROM events e JOIN areas a ON a.id = e.area_id
                        WHERE ${ac.sql.replace('t.area_id', 'e.area_id')}${areaFilter.replace('t.area_id', 'e.area_id')} AND e.date BETWEEN ? AND ?`, ...ac.params, from, to);
  // Künftige Termine aus dem Jahreskalender, für die noch keine Aufgabe existiert
  const recurring = [];
  const rac = areaClause(user, 'r.area_id');
  for (const r of q.all(`SELECT r.*, a.name AS area_name, a.color AS area_color FROM recurring r JOIN areas a ON a.id = r.area_id WHERE r.active = 1 AND ${rac.sql}${areaFilter.replace('t.area_id', 'r.area_id')}`, ...rac.params)) {
    for (const d of occurrences(r, from, to)) {
      if (r.last_due && d <= r.last_due) continue;
      recurring.push({ recurring_id: r.id, title: r.title, date: d, area_id: r.area_id, area_name: r.area_name, area_color: r.area_color, assumption: !!r.assumption });
    }
  }
  return { from, to, tasks, events, recurring };
});

function cleanEvent(b) {
  return {
    area_id: int(b.area_id, { nullable: false, name: 'Bereich' }),
    task_id: int(b.task_id),
    title: str(b.title, { required: true, max: 200, name: 'Titel' }),
    date: dateOrNull(b.date, 'Datum') || (() => { throw bad('Bitte ein Datum angeben.'); })(),
    time: /^\d{2}:\d{2}$/.test(b.time || '') ? b.time : null,
    end_time: /^\d{2}:\d{2}$/.test(b.end_time || '') ? b.end_time : null,
    location: str(b.location, { max: 200 }),
    notes: str(b.notes, { max: 5000 }),
    in_feed: b.in_feed === false ? 0 : 1,
  };
}

// Termine, die ein Mensch selbst einträgt (kein automatisches Handeln, daher ohne Freigabe)
post('/api/events', ({ user, body }) => {
  const d = cleanEvent(body);
  assertArea(user, d.area_id);
  const r = q.run(`INSERT INTO events (area_id, task_id, title, date, time, end_time, location, notes, in_feed, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    d.area_id, d.task_id, d.title, d.date, d.time, d.end_time, d.location, d.notes, d.in_feed, user.id, nowIso());
  audit(user, { entity: 'event', entityId: Number(r.lastInsertRowid), areaId: d.area_id, action: 'angelegt', summary: `Termin „${d.title}“ am ${d.date} eingetragen` });
  return { id: Number(r.lastInsertRowid) };
});

put('/api/events/:id', ({ user, params, body }) => {
  const e = q.get('SELECT * FROM events WHERE id = ?', int(params.id));
  if (!e || !canSeeArea(user, e.area_id)) throw notFound();
  const d = cleanEvent({ ...e, ...body });
  assertArea(user, d.area_id);
  q.run('UPDATE events SET area_id = ?, task_id = ?, title = ?, date = ?, time = ?, end_time = ?, location = ?, notes = ?, in_feed = ? WHERE id = ?',
    d.area_id, d.task_id, d.title, d.date, d.time, d.end_time, d.location, d.notes, d.in_feed, e.id);
  audit(user, { entity: 'event', entityId: e.id, areaId: d.area_id, action: 'geändert', summary: `Termin „${d.title}“ geändert` });
  return { ok: true };
});

del('/api/events/:id', ({ user, params }) => {
  const e = q.get('SELECT * FROM events WHERE id = ?', int(params.id));
  if (!e || !canSeeArea(user, e.area_id)) throw notFound();
  q.run('DELETE FROM events WHERE id = ?', e.id);
  audit(user, { entity: 'event', entityId: e.id, areaId: e.area_id, action: 'geloescht', summary: `Termin „${e.title}“ am ${e.date} gelöscht` });
});

// ---------- Kalender-Abo ----------

get('/api/me/calendar', ({ user }) => {
  let token = q.get('SELECT calendar_token FROM users WHERE id = ?', user.id).calendar_token;
  if (!token) { token = randomToken(); q.run('UPDATE users SET calendar_token = ? WHERE id = ?', token, user.id); }
  return { path: `/api/calendar.ics?token=${token}` };
});

post('/api/me/calendar/renew', ({ user }) => {
  const token = randomToken();
  q.run('UPDATE users SET calendar_token = ? WHERE id = ?', token, user.id);
  audit(user, { entity: 'user', entityId: user.id, action: 'kalender_abo', summary: 'Kalender-Abo-Link erneuert (alter Link ungültig)' });
  return { path: `/api/calendar.ics?token=${token}` };
});

const icsEscape = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (d) => d.replace(/-/g, '');

// Abo-Feed für Kalender-Apps: freigegebene/eingetragene Termine und Fristen eigener Aufgaben.
// Enthält nur Titel und Bereich, keine personenbezogenen Details.
get('/api/calendar.ics', ({ query }) => {
  const token = String(query.token || '');
  const user = token.length > 20 ? q.get('SELECT * FROM users WHERE calendar_token = ? AND active = 1', token) : null;
  if (!user) throw new HttpError(404, 'Unbekannter Kalender.');
  const ac = areaClause(user, 'e.area_id');
  const from = addDays(today(), -60);
  const events = q.all(`SELECT e.*, a.name AS area_name FROM events e JOIN areas a ON a.id = e.area_id WHERE ${ac.sql} AND e.in_feed = 1 AND e.date >= ?`, ...ac.params, from);
  const tasks = q.all(`SELECT t.id, t.title, t.due_date, a.name AS area_name FROM tasks t JOIN areas a ON a.id = t.area_id
                       WHERE (t.owner_id = ? OR t.deputy_id = ?) AND t.status IN ('offen','in_arbeit','wartet') AND t.due_date >= ?`, user.id, user.id, from);
  const stamp = nowIso().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TT-Ehrenamt//DE', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Ehrenamt Tischtennis', 'X-WR-TIMEZONE:Europe/Berlin'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:event-${e.id}@tt-ehrenamt`, `DTSTAMP:${stamp}`);
    if (e.time) {
      lines.push(`DTSTART;TZID=Europe/Berlin:${icsDate(e.date)}T${e.time.replace(':', '')}00`);
      const end = e.end_time || `${String(Math.min(23, Number(e.time.slice(0, 2)) + 2)).padStart(2, '0')}:${e.time.slice(3)}`;
      lines.push(`DTEND;TZID=Europe/Berlin:${icsDate(e.date)}T${end.replace(':', '')}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(e.date)}`, `DTEND;VALUE=DATE:${icsDate(addDays(e.date, 1))}`);
    }
    lines.push(`SUMMARY:${icsEscape(`${e.title} (${e.area_name})`)}`);
    if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
    lines.push('END:VEVENT');
  }
  for (const t of tasks) {
    lines.push('BEGIN:VEVENT', `UID:task-${t.id}@tt-ehrenamt`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(t.due_date)}`, `DTEND;VALUE=DATE:${icsDate(addDays(t.due_date, 1))}`,
      `SUMMARY:${icsEscape(`Frist: ${t.title} (${t.area_name})`)}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return { __file: true, data: lines.join('\r\n'), filename: 'ehrenamt.ics', mime: 'text/calendar; charset=utf-8', inline: true };
}, { auth: 'public' });
