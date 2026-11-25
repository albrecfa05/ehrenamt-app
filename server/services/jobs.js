// Weitere automatisierte Abläufe aus dem Automatisierungskatalog.
// Jeder Ablauf prüft selbst, ob er eingeschaltet ist (isOn), und protokolliert, was er getan hat.

import { q, tx, getSetting, setSetting } from '../db.js';
import { addDays, audit, bad, formatDateDe, nowIso, today } from '../util.js';
import { createTask, notify } from './tasks.js';
import { isOn, param } from './catalog.js';
import { fetchIcs, isHomeGame } from '../connectors/ics.js';
import * as spieltag from './spieltag.js';
import { getSetting as gs } from '../db.js';

const admins = () => q.all(`SELECT id FROM users WHERE active = 1 AND role = 'admin'`).map(u => u.id);

// ---------- Spielpläne (ICS) ----------

/** Liest ein Spielplan-Abo ein: Termine anlegen/aktualisieren, entfallene künftige Termine entfernen, Heimspiel-Aufgaben. */
export async function syncFeed(feed, user = null) {
  let events;
  try {
    events = await fetchIcs(feed.url);
  } catch (err) {
    q.run('UPDATE feeds SET last_fetch_at = ?, last_status = ? WHERE id = ?', nowIso(), `Fehler: ${err.message}`, feed.id);
    audit(user, { entity: 'feed', entityId: feed.id, areaId: feed.area_id, action: 'fehler', summary: `Spielplan „${feed.name}“: ${err.message}` });
    return { error: err.message };
  }
  const d = today();
  let added = 0, changed = 0, removed = 0, tasks = 0;
  tx(() => {
    const seen = new Set();
    for (const e of events) {
      if (e.date < addDays(d, -30)) continue;
      seen.add(e.uid);
      const home = isHomeGame(e, feed.home_pattern);
      const title = `${home ? '🏠 ' : ''}${e.summary}`;
      const ex = q.get('SELECT * FROM events WHERE feed_id = ? AND external_uid = ?', feed.id, e.uid);
      if (!ex) {
        q.run(`INSERT INTO events (area_id, title, date, time, end_time, location, notes, in_feed, source, feed_id, external_uid, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'spielplan', ?, ?, ?)`, feed.area_id, title, e.date, e.time, e.end_time, e.location, e.description, feed.id, e.uid, nowIso());
        added++;
      } else if (ex.title !== title || ex.date !== e.date || ex.time !== e.time || ex.location !== e.location) {
        q.run('UPDATE events SET title = ?, date = ?, time = ?, end_time = ?, location = ? WHERE id = ?', title, e.date, e.time, e.end_time, e.location, ex.id);
        changed++;
        // Verlegtes Heimspiel: Aufgabe über die Zuordnung des Spiels finden (ältere Aufgaben ohne Zuordnung über die Quelle)
        const open = `status IN ('offen','in_arbeit','wartet')`;
        const t = ex.task_id ? q.get(`SELECT * FROM tasks WHERE id = ? AND ${open}`, ex.task_id)
          : q.get(`SELECT * FROM tasks WHERE parent_source = ? AND ${open}`, `spielplan:${feed.id}:${e.uid}`);
        const others = t ? q.get('SELECT COUNT(*) AS n FROM events WHERE task_id = ? AND id != ?', t.id, ex.id).n : 0;
        if (t && ex.date !== e.date && others) {
          // Heimspieltag mit weiteren Spielen: das verlegte Spiel herausnehmen, die übrigen bleiben an ihrem Tag.
          // Unten wird es dem neuen Tag zugeordnet (oder bekommt eine eigene Aufgabe).
          spieltag.linkEvent(ex.id, null);
          spieltag.refreshTask(t.id);
          audit(user, { entity: 'task', entityId: t.id, areaId: t.area_id, action: 'geändert', summary: `Spiel verlegt laut Spielplan: „${e.summary}“ vom ${formatDateDe(ex.date)} auf den ${formatDateDe(e.date)}, nicht mehr Teil dieses Heimspieltags` });
          notify([t.owner_id, t.deputy_id], t.id, 'verlegung', `Spiel verlegt: „${e.summary}“ jetzt am ${formatDateDe(e.date)} – nicht mehr an diesem Heimspieltag.`);
        } else if (t && t.due_date !== e.date) {
          q.run('UPDATE tasks SET due_date = ?, last_activity_at = ? WHERE id = ?', e.date, nowIso(), t.id);
          audit(user, { entity: 'task', entityId: t.id, areaId: t.area_id, action: 'geändert', summary: `Spiel verlegt laut Spielplan: Fälligkeit ${formatDateDe(t.due_date)} → ${formatDateDe(e.date)}` });
          notify([t.owner_id, t.deputy_id], t.id, 'verlegung', `Spiel verlegt: „${e.summary}“ jetzt am ${formatDateDe(e.date)}.`);
          if (ex.task_id) spieltag.refreshTask(t.id); // Titel und Beschreibung mit dem neuen Datum
        }
      }
      if (home && feed.create_tasks && isOn('heimspiel_aufgaben') && e.date >= d && addDays(e.date, -feed.lead_days) <= d) {
        const key = `spielplan:${feed.id}:${e.uid}`;
        const ev = q.get('SELECT * FROM events WHERE feed_id = ? AND external_uid = ?', feed.id, e.uid);
        // Eigene Aufgabe des Spiels – aber nicht mehr, wenn sie inzwischen andere Spiele an einem anderen Tag bündelt (Spiel verlegt)
        const existing = q.get(`SELECT t.id, t.due_date, (SELECT COUNT(*) FROM events WHERE task_id = t.id) AS games
                                FROM tasks t WHERE t.parent_source = ? ORDER BY t.id DESC LIMIT 1`, key);
        if (existing && (!existing.games || existing.due_date === e.date)) {
          if (ev && !ev.task_id) { spieltag.linkEvent(ev.id, existing.id); spieltag.refreshTask(existing.id); }
        } else if (ev && !ev.task_id) {
          // Mehrere Heimspiele an einem Tag: eine gemeinsame Heimspieltag-Aufgabe statt mehrerer
          const sameDay = spieltag.openTaskForDay(feed.area_id, e.date);
          if (sameDay) { spieltag.linkEvent(ev.id, sameDay.id); spieltag.refreshTask(sameDay.id); }
          else {
            const id = createTask(user, {
              area_id: feed.area_id, title: `Heimspiel ${formatDateDe(e.date)}${e.time ? ' ' + e.time : ''}: ${e.summary}`,
              description: `Aus dem Spielplan „${feed.name}“.${e.location ? `\nOrt: ${e.location}` : ''}`,
              due_date: e.date, template_id: feed.template_id || null, owner_id: feed.owner_id || null, channel: 'jahreskalender',
            }, { source: key });
            spieltag.linkEvent(ev.id, id);
            spieltag.refreshTask(id);
            tasks++;
          }
        }
      }
    }
    // Künftige Termine, die nicht mehr im Spielplan stehen (z. B. abgesetzt), entfernen
    for (const ex of q.all('SELECT id, external_uid, title, date FROM events WHERE feed_id = ? AND date >= ?', feed.id, d)) {
      if (!seen.has(ex.external_uid)) { q.run('DELETE FROM events WHERE id = ?', ex.id); removed++; }
    }
    const statusText = `${events.length} Termine gelesen; ${added} neu, ${changed} geändert, ${removed} entfernt, ${tasks} Heimspiel-Aufgabe(n)`;
    q.run('UPDATE feeds SET last_fetch_at = ?, last_status = ? WHERE id = ?', nowIso(), statusText, feed.id);
    if (added || changed || removed || tasks) audit(user, { entity: 'feed', entityId: feed.id, areaId: feed.area_id, action: 'abruf', summary: `Spielplan „${feed.name}“: ${statusText}` });
  });
  return { read: events.length, added, changed, removed, tasks };
}

export async function syncAllFeeds() {
  if (!isOn('spielplan_import')) return [];
  const out = [];
  for (const f of q.all('SELECT * FROM feeds WHERE active = 1')) out.push(await syncFeed(f));
  return out;
}

// ---------- Sponsoren (VOR-6) ----------

export function sponsorJobs(day = today()) {
  let n = 0;
  const vor6 = q.get(`SELECT id FROM process_templates WHERE key = 'VOR-6' AND active = 1`)?.id || null;
  if (isOn('sponsor_laufzeit')) {
    const days = Number(param('sponsor_laufzeit', 'tage')) || 90;
    for (const s of q.all(`SELECT * FROM sponsors WHERE status IN ('aktiv','verhandlung') AND end_date IS NOT NULL AND end_date >= ? AND end_date <= ?`, addDays(day, -30), addDays(day, days))) {
      if (s.reminded_for === s.end_date) continue;
      const office = q.get(`SELECT id FROM offices WHERE area_id = ? AND name = 'Sponsoring'`, s.area_id)?.id || null;
      createTask(null, {
        area_id: s.area_id, office_id: office, title: `Sponsorvertrag ${s.company} verlängern (Laufzeit bis ${formatDateDe(s.end_date)})`,
        description: `Partner: ${s.company}${s.contact_name ? `\nAnsprechpartner: ${s.contact_name}` : ''}${s.category ? `\nArt: ${s.category}` : ''}${s.notes ? `\n\n${s.notes}` : ''}`,
        owner_id: s.godparent_id || null, due_date: addDays(s.end_date, -30) < day ? s.end_date : addDays(s.end_date, -30), template_id: vor6, channel: 'jahreskalender',
      }, { source: `sponsor:${s.id}:${s.end_date}` });
      q.run('UPDATE sponsors SET reminded_for = ? WHERE id = ?', s.end_date, s.id);
      n++;
    }
  }
  if (isOn('sponsor_kontakt')) {
    const days = Number(param('sponsor_kontakt', 'tage')) || 180;
    const key = 'sponsor_kontakt_letzter_lauf';
    if (getSetting(key, null) !== day.slice(0, 7)) { // höchstens einmal im Monat
      setSetting(key, day.slice(0, 7));
      for (const s of q.all(`SELECT * FROM sponsors WHERE status = 'aktiv' AND (last_contact IS NULL OR last_contact < ?)`, addDays(day, -days))) {
        notify(s.godparent_id ? [s.godparent_id] : admins(), null, 'sponsor', `Kontaktpflege: Mit ${s.company} gab es ${s.last_contact ? 'seit ' + formatDateDe(s.last_contact) : 'noch'} keinen erfassten Kontakt.`);
        n++;
      }
    }
  }
  return n;
}

// ---------- Eskalation ----------

export function escalate(day = today()) {
  if (!isOn('eskalation')) return 0;
  const days = Number(param('eskalation', 'tage')) || 5;
  let n = 0;
  for (const t of q.all(`SELECT * FROM tasks WHERE kind = 'aufgabe' AND status IN ('offen','in_arbeit','wartet') AND due_date IS NOT NULL AND due_date < ? AND escalated_at IS NULL`, addDays(day, -days))) {
    const targets = [t.deputy_id, ...admins()].filter(id => id && id !== t.owner_id);
    notify(targets, t.id, 'eskalation', `Seit über ${days} Tagen überfällig: „${t.title}“ (verantwortlich: ${q.get('SELECT name FROM users WHERE id = ?', t.owner_id)?.name || 'niemand'}). Übernehmen oder neu planen?`);
    q.run('UPDATE tasks SET escalated_at = ? WHERE id = ?', nowIso(), t.id);
    audit(null, { entity: 'task', entityId: t.id, areaId: t.area_id, action: 'eskalation', summary: `Eskaliert an Vertretung und Admins (über ${days} Tage überfällig)` });
    n++;
  }
  return n;
}

// ---------- Monatsbericht ----------

export function monthlyReport(day = today(), force = false) {
  if (!force && (!isOn('monatsbericht') || day.slice(8) !== '01')) return null;
  const key = 'monatsbericht_letzter';
  const prevMonthDate = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 2, 1));
  const month = prevMonthDate.toISOString().slice(0, 7);
  if (!force && getSetting(key, null) === month) return null;
  const done = q.all(`SELECT * FROM tasks WHERE kind = 'aufgabe' AND status = 'erledigt' AND substr(completed_at,1,7) = ? AND (parent_source IS NULL OR parent_source NOT LIKE 'asana:%')`, month);
  const started = q.all(`SELECT * FROM tasks WHERE started_at IS NOT NULL AND substr(started_at,1,7) = ? AND (parent_source IS NULL OR parent_source NOT LIKE 'asana:%')`, month);
  const mean = (a) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : null;
  const lieg = mean(started.map(t => (Date.parse(t.started_at) - Date.parse(t.created_at)) / 86_400_000));
  const durch = mean(done.map(t => (Date.parse(t.completed_at) - Date.parse(t.created_at)) / 86_400_000));
  const minutes = q.get('SELECT COALESCE(SUM(minutes),0) AS m FROM time_entries WHERE substr(created_at,1,7) = ?', month).m;
  const open = q.get(`SELECT COUNT(*) AS n FROM tasks WHERE kind = 'aufgabe' AND status IN ('offen','in_arbeit','wartet')`).n;
  const overdue = q.get(`SELECT COUNT(*) AS n FROM tasks WHERE kind = 'aufgabe' AND status IN ('offen','in_arbeit','wartet') AND due_date < ?`, day).n;
  const target = gs('liegezeit_ziel_tage', 6);
  const title = `Monatsbericht ${['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'][+month.slice(5) - 1]} ${month.slice(0, 4)}`;
  const content = {
    title, created: nowIso(), month,
    totals: { erledigt: done.length, begonnen: started.length, offen: open, ueberfaellig: overdue, stunden: Math.round(minutes / 6) / 10 },
    kennzahlen: { liegezeit_mittel: lieg, durchlaufzeit_mittel: durch, ziel: target, ziel_erreicht: lieg == null ? null : lieg <= target },
    sections: [{ title: 'Erledigt im Monat', items: done.slice(0, 60).map(t => ({ id: t.id, title: t.title, due_date: t.due_date })) }],
  };
  const r = q.run('INSERT INTO reports (type, title, content, created_at) VALUES (?, ?, ?, ?)', 'monatsbericht', title, JSON.stringify(content), nowIso());
  setSetting(key, month);
  notify(admins(), null, 'bericht', `${title}: ${done.length} erledigt, Liegezeit ${lieg ?? '—'} Tage (Ziel ${target}).`);
  audit(null, { entity: 'report', entityId: Number(r.lastInsertRowid), action: 'erstellt', summary: `${title} erstellt` });
  return Number(r.lastInsertRowid);
}

// ---------- meinVerein-Export prüfen (VOR-2) ----------

/**
 * Prüft einen CSV-Export (Spalten u. a. Name/Vorname/Nachname, Geburtsdatum oder Geburtsjahr, Beitrag/Beitragsstufe).
 * Gibt nur die Personen mit anstehendem Stufenwechsel zurück. Der Export selbst wird nicht gespeichert.
 */
export function checkMembers(rows, stichtag, stufen) {
  if (!rows.length) throw bad('Die Datei enthält keine Zeilen.');
  const cols = Object.keys(rows[0]);
  const find = (...names) => cols.find(c => names.some(n => c.toLowerCase().replace(/[^a-zäöü]/g, '').includes(n)));
  const cName = find('name'), cVor = find('vorname'), cNach = find('nachname', 'familienname');
  const cGeb = find('geburtsdatum', 'geboren', 'geburtstag'), cJahr = find('geburtsjahr', 'jahrgang');
  const cStufe = find('beitragsstufe', 'beitragsart', 'beitrag', 'tarif', 'stufe');
  if (!(cGeb || cJahr)) throw bad(`Keine Spalte mit Geburtsdatum oder Geburtsjahr gefunden. Gefundene Spalten: ${cols.join(', ')}`);
  if (!(cName || cNach || cVor)) throw bad('Keine Namensspalte gefunden.');
  const year = Number(stichtag.slice(0, 4));
  const out = [];
  let checked = 0;
  for (const r of rows) {
    const name = [r[cVor], r[cNach]].filter(Boolean).join(' ') || r[cName] || '';
    const raw = String(r[cJahr] || r[cGeb] || '');
    const m = raw.match(/(\d{4})/) || raw.match(/\d{1,2}\.\d{1,2}\.(\d{2})$/);
    if (!name || !m) continue;
    let born = Number(m[1]);
    if (born < 100) born += born > year % 100 ? 1900 : 2000;
    checked++;
    const age = year - born;
    const soll = stufen.find(s => age >= s.ab_alter && (s.bis_alter == null || age <= s.bis_alter));
    const ist = cStufe ? String(r[cStufe] || '').trim() : '';
    if (!soll) continue;
    const passt = ist && (ist.toLowerCase().includes(soll.name.toLowerCase()) || soll.name.toLowerCase().includes(ist.toLowerCase()));
    if (!passt) out.push({ name: name.trim(), alter: age, ist: ist || '(unbekannt)', soll: soll.name, beitrag: soll.beitrag });
  }
  return { checked, changes: out, columns: { name: cName || `${cVor} ${cNach}`, geburt: cGeb || cJahr, stufe: cStufe || null } };
}

// ---------- Auto-Abschluss ----------

/** Wird nach dem Abhaken eines Teilschritts aufgerufen. Gibt 'abgeschlossen' | 'hinweis' | null zurück. */
export function onAllStepsDone(user, task, updateTask) {
  if (!isOn('auto_abschluss')) return null;
  const open = q.get('SELECT COUNT(*) AS n FROM task_steps WHERE task_id = ? AND done = 0', task.id).n;
  const total = q.get('SELECT COUNT(*) AS n FROM task_steps WHERE task_id = ?', task.id).n;
  if (!total || open) return null;
  if (param('auto_abschluss', 'modus') === 'abschliessen' && task.status !== 'wartet') {
    updateTask(user, q.get('SELECT * FROM tasks WHERE id = ?', task.id), { status: 'erledigt' });
    return 'abgeschlossen';
  }
  notify([task.owner_id].filter(id => id && id !== user?.id), task.id, 'abschluss', `Alle Teilschritte von „${task.title}“ sind erledigt. Abschließen?`);
  return 'hinweis';
}
