// Zeitgesteuerte Abläufe. Läuft im Server-Prozess jede Minute.
//  - Jahreskalender: legt wiederkehrende Aufgaben rechtzeitig an (AUF-4)
//  - Nachfassen: Erinnerungen bei überfälligen und lange liegenden Aufgaben (AUF-7)
//  - Ideenspeicher: Einträge ohne Bewegung zur Entscheidung vorlegen (AUF-8)
//  - Regeln mit Auslöser Zeitplan und Frist (AUT-2, AUT-13)
//  - Löschfrist für Anhänge mit gelben Daten (DAT-2, NFA-12), sobald eingestellt

import fs from 'node:fs';
import { q, getSetting, setSetting } from '../db.js';
import { addDays, audit, berlinClock, formatDateDe, nowIso, today } from '../util.js';
import { createTask, notify } from './tasks.js';
import { runDeadlineRules, runScheduledRules } from './automation.js';
import { isOn, param } from './catalog.js';
import { escalate, monthlyReport, sponsorJobs, syncAllFeeds } from './jobs.js';
import { pollMailboxes } from './inbox.js';
import { config } from '../config.js';

const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, lastDay(y, m))).padStart(2, '0')}`;

/** Alle Fälligkeiten einer wiederkehrenden Aufgabe zwischen from und to (inklusive). */
export function occurrences(r, from, to) {
  const out = [];
  const y0 = Number(from.slice(0, 4)) - 1, y1 = Number(to.slice(0, 4)) + 1;
  const day = r.day || 1;
  const months = {
    jaehrlich: [r.month || 1],
    halbjaehrlich: [r.month || 1, ((r.month || 1) + 5) % 12 + 1],
    quartalsweise: [0, 3, 6, 9].map(o => ((r.month || 1) - 1 + o) % 12 + 1),
    monatlich: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  }[r.freq];
  if (r.freq === 'woechentlich') {
    // day = Wochentag 1 (Mo) … 7 (So)
    let d = from;
    for (let i = 0; i < 400 && d <= to; i++) {
      const wd = ((new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1;
      if (wd === (r.day || 1)) out.push(d);
      d = addDays(d, 1);
    }
    return out;
  }
  for (let y = y0; y <= y1; y++) for (const m of months) {
    const d = ymd(y, m, day);
    if (d >= from && d <= to) out.push(d);
  }
  return out.sort();
}

/** Nächste Fälligkeit ab heute (für die Anzeige im Jahreskalender). */
export function nextOccurrence(r, from = today()) {
  return occurrences(r, from, addDays(from, 400))[0] || null;
}

/** Legt fällige Aufgaben aus dem Jahreskalender an. */
export function generateRecurring(day = today()) {
  const created = [];
  for (const r of q.all('SELECT * FROM recurring WHERE active = 1')) {
    const horizon = addDays(day, r.lead_days);
    for (const due of occurrences(r, day, horizon)) {
      if (r.last_due && due <= r.last_due) continue;
      if (addDays(due, -r.lead_days) > day) continue;
      const office = r.office_id ? q.get('SELECT * FROM offices WHERE id = ?', r.office_id) : null;
      const id = createTask(null, {
        area_id: r.area_id, office_id: r.office_id, title: `${r.title} ${due.slice(0, 4)}${['monatlich', 'quartalsweise', 'woechentlich', 'halbjaehrlich'].includes(r.freq) ? ` (${formatDateDe(due)})` : ''}`,
        description: r.description + (r.assumption ? '\n\nHinweis: Das Datum im Jahreskalender ist eine Annahme. Bitte prüfen und im Jahreskalender korrigieren.' : ''),
        owner_id: r.owner_id || office?.holder_id || null, due_date: due, template_id: r.template_id, recurring_id: r.id,
        channel: 'jahreskalender',
      }, { source: `jahreskalender:${r.id}` });
      q.run('UPDATE recurring SET last_due = ? WHERE id = ?', due, r.id);
      created.push(id);
    }
  }
  return created;
}

/** Nachfassen (AUF-7). Pro Aufgabe höchstens eine Erinnerung am Tag bzw. je Liegezeit-Intervall. */
export function sendReminders(day = today()) {
  const staleDays = getSetting('liegezeit_warnung_tage', 7);
  const dueOn = isOn('erinnerungen'), staleOn = isOn('nachfassen');
  let n = 0;
  const open = q.all(`SELECT * FROM tasks WHERE kind = 'aufgabe' AND status IN ('offen','in_arbeit','wartet')`);
  for (const t of open) {
    const reminded = t.last_reminded_at ? today(new Date(t.last_reminded_at)) : null;
    const idle = (Date.now() - Date.parse(t.last_activity_at)) / 86_400_000;
    let msg = null;
    if (dueOn && t.due_date && t.due_date < day && reminded !== day) {
      msg = `Überfällig seit ${formatDateDe(t.due_date)}: „${t.title}“`;
    } else if (dueOn && t.due_date === day && reminded !== day) {
      msg = `Heute fällig: „${t.title}“`;
    } else if (staleOn && idle > staleDays && (!reminded || reminded <= addDays(day, -staleDays))) {
      msg = t.status === 'wartet'
        ? `Seit ${Math.floor(idle)} Tagen wartet „${t.title}“ auf ${t.waiting_who || 'Zulieferung'}. Nachfassen?`
        : `Seit ${Math.floor(idle)} Tagen ohne Bewegung: „${t.title}“`;
    }
    if (!msg) continue;
    const targets = [t.owner_id, t.deputy_id].filter(Boolean);
    if (!targets.length) targets.push(...q.all(`SELECT id FROM users WHERE active = 1 AND role = 'admin'`).map(u => u.id));
    notify(targets, t.id, 'nachfassen', msg);
    q.run('UPDATE tasks SET last_reminded_at = ? WHERE id = ?', nowIso(), t.id);
    n++;
  }
  return n;
}

/** Ideenspeicher (AUF-8): Einträge ohne Bewegung zur Entscheidung vorlegen. */
export function reviewIdeas(day = today()) {
  if (!isOn('ideen_vorlegen')) return 0;
  const days = getSetting('idee_vorlage_tage', 60);
  const ideas = q.all(`SELECT * FROM tasks WHERE kind = 'idee' AND status IN ('offen','in_arbeit','wartet')`);
  const due = ideas.filter(i => (Date.now() - Date.parse(i.last_activity_at)) / 86_400_000 > days
    && (!i.last_reminded_at || today(new Date(i.last_reminded_at)) <= addDays(day, -days)));
  if (!due.length) return 0;
  const admins = q.all(`SELECT id FROM users WHERE active = 1 AND role = 'admin'`).map(u => u.id);
  for (const i of due) {
    notify(admins, i.id, 'idee', `Zur Entscheidung: Idee „${i.title}“ liegt seit über ${days} Tagen. Umsetzen oder verwerfen?`);
    q.run('UPDATE tasks SET last_reminded_at = ? WHERE id = ?', nowIso(), i.id);
  }
  return due.length;
}

/** Löscht Anhänge mit gelben Daten N Tage nach Abschluss des Vorgangs (nur wenn eingestellt). */
export function purgeYellowFiles(day = today()) {
  if (!isOn('loeschfrist_gelb')) return 0;
  const days = Number(param('loeschfrist_gelb', 'tage'));
  if (!days) return 0;
  const cutoff = addDays(day, -Number(days));
  const files = q.all(`SELECT f.* FROM files f JOIN tasks t ON t.id = f.task_id
                       WHERE f.data_class = 'gelb' AND f.deleted_at IS NULL AND t.completed_at IS NOT NULL AND substr(t.completed_at,1,10) <= ?`, cutoff);
  for (const f of files) {
    try { fs.rmSync(`${config.uploadDir}/${f.stored_path}`, { force: true }); } catch { /* Datei fehlt bereits */ }
    q.run('UPDATE files SET deleted_at = ?, text_content = \'\' WHERE id = ?', nowIso(), f.id);
    audit(null, { entity: 'file', entityId: f.id, areaId: f.area_id, action: 'geloescht', summary: `Löschfrist: Datei „${f.filename}“ (gelbe Daten) ${days} Tage nach Abschluss gelöscht` });
  }
  return files.length;
}

/** Einmal täglich ab der eingestellten Stunde. */
function dailyJobs(now) {
  const day = today(now);
  const { hour } = berlinClock(now);
  if (hour < getSetting('erinnerung_stunde', 7)) return;
  if (getSetting('scheduler_letzter_tageslauf', null) === day) return;
  setSetting('scheduler_letzter_tageslauf', day);
  const created = isOn('jahreskalender') ? generateRecurring(day) : [];
  const reminded = sendReminders(day);
  const ideas = reviewIdeas(day);
  const purged = purgeYellowFiles(day);
  const escalated = escalate(day);
  const sponsors = sponsorJobs(day);
  monthlyReport(day);
  runDeadlineRules(now);
  if (created.length || reminded || ideas || purged || escalated || sponsors) {
    audit(null, { entity: 'system', action: 'tageslauf', summary: `Tageslauf: ${created.length} Aufgabe(n) aus dem Jahreskalender, ${reminded} Erinnerung(en), ${escalated} Eskalation(en), ${sponsors} Sponsor-Hinweis(e), ${ideas} Idee(n) zur Entscheidung, ${purged} Datei(en) gelöscht` });
  }
}

// Abläufe mit Netzwerkzugriff (Postfach, Spielpläne) laufen asynchron und überlappen sich nicht.
let lastPoll = 0;
function networkJobs(now) {
  const day = today(now);
  const { hour } = berlinClock(now);
  if (isOn('postfach_abruf')) {
    const every = Math.max(5, Number(param('postfach_abruf', 'minuten')) || 15) * 60_000;
    if (now.getTime() - lastPoll >= every) {
      lastPoll = now.getTime();
      pollMailboxes().catch(err => console.error('[Postfach] Fehler:', err.message));
    }
  }
  if (isOn('spielplan_import') && hour >= Number(param('spielplan_import', 'stunde') ?? 6) && getSetting('spielplan_letzter_abruf', null) !== day) {
    setSetting('spielplan_letzter_abruf', day);
    syncAllFeeds().catch(err => console.error('[Spielplan] Fehler:', err.message));
  }
}

export function tick(now = new Date()) {
  try {
    dailyJobs(now);
    runScheduledRules(now);
    networkJobs(now);
  } catch (err) {
    console.error('[Zeitplan] Fehler:', err);
  }
}

export function startScheduler() {
  if (config.disableScheduler) return null;
  tick();
  return setInterval(tick, config.schedulerIntervalMs).unref();
}
