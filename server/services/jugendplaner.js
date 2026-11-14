// Abgleich mit dem Jugendplaner: Stand lesen, Hinweise berechnen, Aufgaben anlegen und wieder schließen.
//
// Datenschutz: Der Jugendplaner enthält Namen von Kindern, Eltern und Fahrern. In die Ehrenamt-App
// übernommen werden nur Spieltermine (öffentlich, grün) und Hinweise OHNE Namen – Zählwerte wie
// „2 Zusagen – mindestens 3 nötig“ oder „Fahrer spielt selbst zur selben Zeit“.
// Die Namensliste bleibt im Jugendplaner. Gespeichert wird nur die letzte Zusammenfassung.

import { q, getSetting, setSetting } from '../db.js';
import { addDays, audit, daysBetween, formatDateDe, nowIso, today } from '../util.js';
import { createTask, updateTask } from './tasks.js';
import { isOn, param } from './catalog.js';
import * as jp from '../connectors/jugendplaner.js';

export const settings = () => ({ area_id: null, ...(getSetting('jugendplaner', {}) || {}) });
export const stand = () => getSetting('jugendplaner_stand', null);

const mins = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const personsOf = (s) => String(s || '').split(/\s*(?:,|\/|\+|&|\bund\b|\boder\b)\s*/i).map(x => x.trim().toLowerCase()).filter(x => x.length > 2);
const sameFirstOrFull = (a, b) => a === b || a.split(' ')[0] === b || b.split(' ')[0] === a;
const statusOf = (g) => g.cancelled ? 'abgesagt' : g.drivers ? 'fahrer' : g.betreuer ? 'betreut' : g.respTeam ? 'zustaendig' : 'offen';
export const STATUS_LABEL = { fahrer: 'Fahrer fest', betreut: 'Betreuer da', zustaendig: 'Mannschaft sucht', offen: 'offen', abgesagt: 'abgesagt' };

/**
 * Hinweise wie im Jugendplaner selbst (gleiche Regeln), aber ohne Personennamen.
 * Gibt die künftigen Spiele mit Status, Zusagen und Hinweisen zurück.
 */
export function analyze(data, day = today()) {
  const s = data.settings || {};
  const H = (Number(s.conflictHours) || 3) * 60;
  const urgent = Number(s.urgentDays) || 14;
  const youth = new Map((data.youthTeams || []).map(t => [t.id, t]));
  const adult = new Map((data.adultTeams || []).map(t => [t.id, t]));
  const adultByDate = new Map();
  for (const a of data.adultGames || []) { if (!adultByDate.has(a.date)) adultByDate.set(a.date, []); adultByDate.get(a.date).push(a); }
  const overlap = (t1, t2) => { const a = mins(t1), b = mins(t2); return a == null || b == null ? true : Math.abs(a - b) < H; };

  const out = [];
  for (const g of (data.games || []).filter(x => x.date >= day).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))) {
    const t = youth.get(g.team) || { name: g.team, minPlayers: 3 };
    const min = Number(t.minPlayers) || 3;
    const yes = Object.values(g.avail || {}).filter(v => v === 'y').length;
    const st = statusOf(g);
    const du = daysBetween(day, g.date);
    const issues = [];
    const add = (level, kind, text) => { if (!issues.some(i => i.kind === kind && i.text === text)) issues.push({ level, kind, text }); };
    if (!g.cancelled) {
      if ((st === 'offen' || st === 'zustaendig') && du <= urgent)
        add('crit', 'betreuung', st === 'offen' ? `Noch niemand fährt oder betreut – in ${du} Tag(en)` : `${adult.get(g.respTeam)?.name || 'Zuständige Mannschaft'} hat noch keinen Betreuer eingetragen – in ${du} Tag(en)`);
      if (yes < min) add(yes === 0 && du > 21 ? 'info' : 'warn', 'zusagen', `${yes} Zusage(n) – mindestens ${min} nötig`);
      for (const a of adultByDate.get(g.date) || []) {
        const at = adult.get(a.team);
        if (g.respTeam && a.team === g.respTeam && !g.betreuer && !g.drivers)
          add(overlap(a.time, g.time) ? 'crit' : 'warn', 'zustaendig_spielt', `${at?.name || 'Zuständige Mannschaft'} spielt am selben Tag selbst${a.time ? ` (${a.time} Uhr)` : ''}`);
        if (!at || !overlap(a.time, g.time)) continue;
        const members = [at.captain, ...(at.members || [])].filter(Boolean).map(x => x.toLowerCase());
        if (personsOf(g.drivers || g.betreuer).some(p => members.some(m => sameFirstOrFull(m, p))))
          add('crit', 'fahrer_spielt', `Fahrer/Betreuer spielt zur selben Zeit mit ${at.name}`);
        const kids = new Set([...(g.lineupPlayers || []), ...Object.entries(g.avail || {}).filter(([, v]) => v === 'y').map(([k]) => k)]);
        const n = [...kids].filter(k => (at.members || []).includes(k)).length;
        if (n) add('crit', 'doppelt', `${n} Jugendliche(r) spielt zeitgleich mit ${at.name}`);
      }
    }
    out.push({ id: g.id, date: g.date, time: g.time || '', team: t.name, team_id: g.team, home: !!g.home, opponent: g.opponent || '',
      status: st, yes, min, days: du, issues });
  }
  return out;
}

/** Aufgaben für Spiele mit kritischen Hinweisen; erledigte Hinweise schließen ihre Aufgabe wieder. */
function syncTasks(games, areaId) {
  const created = [], closed = [];
  const office = q.get(`SELECT * FROM offices WHERE area_id = ? AND name = 'Jugendwart'`, areaId);
  const tpl = q.get(`SELECT id FROM process_templates WHERE key = 'VOR-14'`)?.id ?? null;
  const day = today();
  const seen = new Set();
  for (const g of games) {
    const crit = g.issues.filter(i => i.level === 'crit');
    const key = `jugendplaner:${g.id}`;
    const open = q.get(`SELECT * FROM tasks WHERE parent_source = ? AND status IN ('offen','in_arbeit','wartet')`, key);
    if (crit.length && g.status !== 'abgesagt') {
      seen.add(key);
      const desc = `Hinweise aus dem Jugendplaner (Stand ${formatDateDe(day)}):\n${g.issues.map(i => `• ${i.text}`).join('\n')}\n\nGelöst wird im Jugendplaner (Fahrer/Betreuer eintragen, Zusagen einholen). Beim nächsten Abgleich schließt die App diese Aufgabe von selbst.`;
      if (open) {
        if (open.description !== desc) q.run('UPDATE tasks SET description = ?, last_activity_at = ? WHERE id = ?', desc, nowIso(), open.id);
        continue;
      }
      if (q.get('SELECT 1 FROM tasks WHERE parent_source = ? AND completed_at >= ?', key, `${day}T00:00:00`)) continue; // heute schon einmal geschlossen
      const due = addDays(g.date, -2) < day ? g.date : addDays(g.date, -2);
      createTask(null, {
        area_id: areaId, office_id: office?.id || null, owner_id: office?.holder_id || null, template_id: tpl,
        title: `${g.team} ${g.home ? 'gegen' : 'bei'} ${g.opponent} am ${formatDateDe(g.date)}: ${crit[0].text.replace(/ – in \d+ Tag\(en\)$/, '')}`,
        description: desc, due_date: due, channel: 'automatisierung',
      }, { source: key });
      created.push(g.id);
    }
  }
  // Offene Abgleich-Aufgaben, deren Spiel keinen kritischen Hinweis mehr hat (oder vorbei/abgesagt ist), schließen
  for (const t of q.all(`SELECT * FROM tasks WHERE parent_source LIKE 'jugendplaner:%' AND status IN ('offen','in_arbeit','wartet')`)) {
    if (seen.has(t.parent_source)) continue;
    const g = games.find(x => `jugendplaner:${x.id}` === t.parent_source);
    const why = !g ? 'Spiel liegt in der Vergangenheit oder wurde entfernt' : g.status === 'abgesagt' ? 'Spiel wurde abgesagt' : 'im Jugendplaner gelöst';
    q.run('INSERT INTO comments (task_id, user_id, body, created_at) VALUES (?, NULL, ?, ?)', t.id, `Automatisch erledigt beim Abgleich mit dem Jugendplaner: ${why}.`, nowIso());
    updateTask(null, t, { status: 'erledigt' });
    closed.push(t.id);
  }
  return { created, closed };
}

/** Kompletter Abgleich. withTasks: Aufgaben anlegen/schließen (Katalog-Schalter). */
export async function sync({ user = null, withTasks = null } = {}) {
  const cfg = settings();
  let r;
  try { r = await jp.fetchState(); } catch (err) {
    setSetting('jugendplaner_stand', { ...(stand() || {}), at: nowIso(), error: err.message });
    audit(user, { entity: 'jugendplaner', action: 'fehler', summary: `Jugendplaner-Abgleich fehlgeschlagen: ${err.message}` });
    throw err;
  }
  const games = analyze(r.data);
  const counts = {
    spiele: games.length,
    naechste14: games.filter(g => g.days <= 14 && g.status !== 'abgesagt').length,
    kritisch: games.filter(g => g.issues.some(i => i.level === 'crit')).length,
    warnungen: games.filter(g => g.issues.some(i => i.level === 'warn')).length,
    teams: (r.data.youthTeams || []).length,
  };
  let tasks = { created: [], closed: [] };
  const doTasks = withTasks ?? (isOn('jugendplaner_abgleich') && param('jugendplaner_abgleich', 'aufgaben') !== false);
  if (doTasks && cfg.area_id) tasks = syncTasks(games, Number(cfg.area_id));
  const st = { at: nowIso(), error: null, rev: r.data.rev ?? null, season: r.data.season || '', club: r.data.settings?.club || '', version: r.version || '', icsKey: r.icsKey || '',
    teams: (r.data.youthTeams || []).map(t => ({ id: t.id, name: t.name })), counts, games: games.slice(0, 120) };
  setSetting('jugendplaner_stand', st);
  if (tasks.created.length || tasks.closed.length || user) {
    audit(user, { entity: 'jugendplaner', action: 'abgleich', areaId: cfg.area_id || null,
      summary: `Jugendplaner abgeglichen: ${counts.spiele} künftige Jugendspiele, ${counts.kritisch} mit kritischem Hinweis; ${tasks.created.length} Aufgabe(n) angelegt, ${tasks.closed.length} erledigt` });
  }
  return { counts, created: tasks.created.length, closed: tasks.closed.length, area: !!cfg.area_id };
}

/** Spielplan-Abo der Ehrenamt-App auf den Kalender des Jugendplaners anlegen (einmalig). */
export function createFeed(user, areaId) {
  const st = stand();
  if (!st?.icsKey) throw Object.assign(new Error('Bitte zuerst einmal abgleichen – dabei liefert der Jugendplaner die Kalender-Adresse.'), { status: 400 });
  const url = jp.icsUrl(st.icsKey);
  const ex = q.get('SELECT id FROM feeds WHERE url = ?', url);
  if (ex) return { id: ex.id, existed: true };
  const r = q.run(`INSERT INTO feeds (area_id, name, url, home_pattern, create_tasks, template_id, lead_days, owner_id, active, created_at) VALUES (?, ?, ?, ?, 0, NULL, 10, NULL, 1, ?)`,
    areaId, 'Jugendplaner: alle Jugendspiele', url, '', nowIso());
  audit(user, { entity: 'feed', entityId: Number(r.lastInsertRowid), areaId, action: 'angelegt', summary: 'Spielplan-Abo aus dem Jugendplaner angelegt (alle Jugendspiele)' });
  return { id: Number(r.lastInsertRowid), existed: false };
}
