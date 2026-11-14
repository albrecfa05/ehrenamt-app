// Heimspieltage: Spiele aus den Spielplan-Abos einer Aufgabe zuordnen, mehrere Heimspiele eines Tages
// zusammenfassen, Jugendspiele erkennen (dort braucht es im Tischtennis keinen Schiedsrichter) und
// Werte für Textvorlagen liefern (Datum, Uhrzeit, Begegnungen, Gegner, Halle …).

import { q } from '../db.js';
import { addDays, formatDateDe, nowIso } from '../util.js';

const YOUTH = /\b(U\s?\d{1,2}|Jugend|Schüler|Mädchen|Jungen|Mini)\b/i;
export const isYouth = (text) => YOUTH.test(String(text || ''));
const SR_STEP = 'Schiedsrichter klären';
const SR_ENTFAELLT = 'Entfällt: Jugendspiel – im Tischtennis gibt es dort keinen Schiedsrichter (die Mannschaftsführer zählen).';

const WEEKDAY = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const withWeekday = (d) => `${WEEKDAY[new Date(d + 'T12:00:00Z').getUTCDay()]}, ${formatDateDe(d)}`;
const feedLabel = (name) => String(name || '').replace(/\s*\(.*\)\s*$/, '').replace(/^Jugendplaner:.*$/i, '').trim();

/** Zerlegt ein Spiel: Mannschaft, Gegner, Heim/Auswärts, Jugend. */
export function parseGame(ev, feed) {
  const raw = String(ev.title || '').replace(/^🏠\s*/, '').replace(/^ABGESAGT:\s*/i, '').replace(/^🏓\s*/, '').trim();
  const pattern = String(feed?.home_pattern || '').trim().toLowerCase();
  const sep = raw.match(/\s[-–:]\s|\svs\.?\s|\s@\s/);
  let home = raw, away = '';
  if (sep) { home = raw.slice(0, sep.index).trim(); away = raw.slice(sep.index + sep[0].length).trim(); }
  const isAway = sep && (/@/.test(sep[0]) || (pattern && !home.toLowerCase().includes(pattern) && away.toLowerCase().includes(pattern)));
  const ours = isAway ? away : home;
  const opponent = isAway ? home : away;
  let team = pattern ? ours.replace(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').trim() : ours;
  if (!team) team = feedLabel(feed?.name) || ours;
  // „TTV Musterhausen II“ → „Herren II“ (Bezeichnung aus dem Spielplan-Abo)
  else if (/^([IVX]+|\d)$/.test(team)) team = feedLabel(feed?.name)?.endsWith(team) ? feedLabel(feed.name) : `${feedLabel(feed?.name) || 'Mannschaft'} ${team}`.trim();
  return { id: ev.id, date: ev.date, time: ev.time || '', team, opponent, summary: raw, location: ev.location || '', youth: isYouth(`${raw} ${feed?.name || ''}`) };
}

/** Spiele, die einer Aufgabe zugeordnet sind (frühestes zuerst). */
export function gamesOf(taskId) {
  return q.all(`SELECT e.*, f.name AS feed_name, f.home_pattern FROM events e LEFT JOIN feeds f ON f.id = e.feed_id WHERE e.task_id = ? ORDER BY e.date, e.time`, taskId)
    .map(e => parseGame(e, { name: e.feed_name, home_pattern: e.home_pattern }));
}

const titleFor = (games) => games.length === 1
  ? `Heimspiel ${formatDateDe(games[0].date)}${games[0].time ? ' ' + games[0].time : ''}: ${games[0].summary}`
  : `Heimspieltag ${formatDateDe(games[0].date)}: ${games.map(g => `${g.team} gegen ${g.opponent}${g.time ? ` (${g.time})` : ''}`).join(' · ')}`;

/** Titel, Beschreibung und Schiedsrichter-Schritt an die zugeordneten Spiele anpassen. */
export function refreshTask(taskId) {
  const t = q.get('SELECT * FROM tasks WHERE id = ?', taskId);
  const games = gamesOf(taskId);
  if (!t || !games.length) return;
  const lines = games.map(g => `• ${g.time || '?'} Uhr: ${g.summary}${g.youth ? ' (Jugend – kein Schiedsrichter nötig)' : ''}`).join('\n');
  const desc = `Spiele an diesem Tag (aus dem Spielplan):\n${lines}${games[0].location ? `\nOrt: ${games[0].location}` : ''}${games.length > 1 ? '\n\nMehrere Spiele: Hallen- und Küchendienst für den ganzen Tag planen, ggf. zweite Küchenschicht.' : ''}`;
  q.run('UPDATE tasks SET title = ?, description = ?, due_date = ?, last_activity_at = ? WHERE id = ?', titleFor(games), desc, games[0].date, nowIso(), taskId);
  const step = q.get('SELECT * FROM task_steps WHERE task_id = ? AND title = ?', taskId, SR_STEP);
  if (!step) return;
  const allYouth = games.every(g => g.youth);
  if (allYouth && !step.done) q.run('UPDATE task_steps SET done = 1, done_at = ?, note = ? WHERE id = ?', nowIso(), SR_ENTFAELLT, step.id);
  if (!allYouth && step.done && step.note === SR_ENTFAELLT) q.run(`UPDATE task_steps SET done = 0, done_at = NULL, note = '' WHERE id = ?`, step.id);
}

/**
 * Offene Heimspieltag-Aufgabe im Bereich an diesem Tag – dann kommt das Spiel dazu, statt eine zweite Aufgabe anzulegen.
 */
export function openTaskForDay(areaId, date) {
  return q.get(`SELECT t.* FROM tasks t JOIN events e ON e.task_id = t.id
                WHERE t.area_id = ? AND e.date = ? AND e.source = 'spielplan' AND t.status IN ('offen','in_arbeit','wartet') ORDER BY t.id LIMIT 1`, areaId, date);
}

export function linkEvent(eventId, taskId) { q.run('UPDATE events SET task_id = ? WHERE id = ?', taskId, eventId); }

/** Werte für Textvorlagen aus den Spielen der Aufgabe (der Mensch kann sie im Entwurf überschreiben). */
export function draftValues(task) {
  const games = gamesOf(task.id);
  if (!games.length) return {};
  const first = games[0];
  const youth = games.filter(g => g.youth), adult = games.filter(g => !g.youth);
  const [hh, mm] = (first.time || '').split(':').map(Number);
  const aufbau = Number.isFinite(hh) ? `${String(Math.max(0, hh - 1)).padStart(2, '0')}:${String(mm || 0).padStart(2, '0')} Uhr` : undefined;
  const v = {
    datum: formatDateDe(first.date),
    spieltag: withWeekday(first.date),
    uhrzeit: first.time || undefined,
    begegnung: games.length === 1 ? first.summary : games.map(g => `${g.team} gegen ${g.opponent}${g.time ? ` (${g.time} Uhr)` : ''}`).join(', '),
    gegner: [...new Set(games.map(g => g.opponent).filter(Boolean))].join(', '),
    mannschaft: [...new Set(games.map(g => g.team))].join(', '),
    // Nur der Hallenname: Straßenangaben würden die Datenschutz-Prüfung der Entwürfe ohnehin entfernen
    halle: (first.location || '').split(',')[0].trim() || undefined,
    aufbau,
    rueckmeldung_bis: withWeekday(addDays(first.date, -3)),
  };
  if (youth.length && !adult.length) v.schiedsrichter = 'entfällt (Jugendspiel – kein Schiedsrichter nötig)';
  else if (youth.length) v.schiedsrichter = `${adult.map(g => g.team).join(', ')}: laut Einteilung; ${youth.map(g => g.team).join(', ')}: entfällt (Jugend)`;
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && x !== ''));
}
