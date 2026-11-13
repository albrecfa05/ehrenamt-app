// Protokoll (NFA-2), Kennzahlen (AUF-10, ABN-3, ABN-4), Handbuch je Amt (VOR-15),
// Asana-Import (AUF-12) und globale Suche.

import { get, post } from '../http.js';
import { q, tx, getSetting } from '../db.js';
import { areaClause, canSeeArea, isAdmin, requireAdmin } from '../access.js';
import { rank } from '../search.js';
import { createTask } from '../services/tasks.js';
import { audit, bad, int, isDate, nowIso, parseJson, str, today, addDays, formatDateDe } from '../util.js';
import { decorate } from './tasks.js';
import { clockNow, nowMs } from '../clock.js';

// ---------- Protokoll ----------

function auditQuery(user, query) {
  const where = ['1 = 1'];
  const params = [];
  if (!isAdmin(user)) {
    const ac = areaClause(user, 'l.area_id');
    where.push(`(l.area_id IS NULL OR ${ac.sql})`); params.push(...ac.params);
  }
  if (query.entity) { where.push('l.entity = ?'); params.push(String(query.entity)); }
  if (query.entity_id) { where.push('l.entity_id = ?'); params.push(int(query.entity_id)); }
  if (query.area) { where.push('l.area_id = ?'); params.push(int(query.area)); }
  if (query.user) { where.push('l.user_id = ?'); params.push(int(query.user)); }
  if (isDate(query.from)) { where.push('l.at >= ?'); params.push(query.from); }
  if (isDate(query.to)) { where.push('l.at < ?'); params.push(addDays(query.to, 1)); }
  if (query.action) { where.push('l.action LIKE ?'); params.push(`%${query.action}%`); }
  if (query.q) { where.push('l.summary LIKE ?'); params.push(`%${query.q}%`); }
  if (query.only === 'freigaben') where.push(`(l.entity = 'approval' OR l.action IN ('freigegeben','freigabe_entzogen','entwurf_uebernommen'))`);
  return { sql: `SELECT l.*, a.name AS area_name FROM audit_log l LEFT JOIN areas a ON a.id = l.area_id WHERE ${where.join(' AND ')} ORDER BY l.id DESC`, params };
}

get('/api/audit', ({ user, query }) => {
  const { sql, params } = auditQuery(user, query);
  const limit = Math.min(int(query.limit) || 200, 1000);
  const offset = int(query.offset) || 0;
  return q.all(`${sql} LIMIT ${limit} OFFSET ${offset}`, ...params);
});

// Export für Kassenprüfung und Entlastung (NFA-2)
get('/api/audit.csv', ({ user, query }) => {
  const { sql, params } = auditQuery(user, query);
  const rows = q.all(sql, ...params);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Nr', 'Zeitpunkt', 'Person', 'Bereich', 'Objekt', 'Objekt-Nr', 'Aktion', 'Beschreibung'].map(esc).join(';')];
  for (const r of rows) {
    const at = new Date(r.at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
    lines.push([r.id, at, r.user_name, r.area_name, r.entity, r.entity_id, r.action, r.summary].map(esc).join(';'));
  }
  audit(user, { entity: 'audit', action: 'export', summary: `Protokoll exportiert (${rows.length} Einträge)` });
  return { __file: true, data: '﻿' + lines.join('\r\n'), filename: `Protokoll ${today()}.csv`, mime: 'text/csv; charset=utf-8' };
});

// ---------- Kennzahlen ----------

const mean = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : null;
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
};
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

get('/api/metrics', ({ user, query }) => {
  const ac = areaClause(user, 't.area_id');
  const areaFilter = query.area ? ` AND t.area_id = ${int(query.area)}` : '';
  const months = Math.min(Math.max(int(query.months) || 12, 1), 36);
  const now = clockNow();
  const list = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    list.push(d.toISOString().slice(0, 7));
  }
  const tasks = q.all(`SELECT t.id, t.created_at, t.started_at, t.completed_at, t.status, t.template_id, t.parent_source, t.area_id
                       FROM tasks t WHERE ${ac.sql}${areaFilter} AND t.kind = 'aufgabe'`, ...ac.params);
  const minutes = q.all(`SELECT te.minutes, te.created_at, te.task_id, t.template_id FROM time_entries te JOIN tasks t ON t.id = te.task_id
                         WHERE ${ac.sql}${areaFilter}`, ...ac.params);
  const live = tasks.filter(t => !String(t.parent_source || '').startsWith('asana:'));
  const monthly = list.map(m => {
    const created = live.filter(t => t.created_at.startsWith(m));
    const started = live.filter(t => t.started_at && t.started_at.startsWith(m));
    const done = live.filter(t => t.completed_at && t.completed_at.startsWith(m) && t.status === 'erledigt');
    const lieg = started.map(t => days(t.created_at, t.started_at));
    const durch = done.map(t => days(t.created_at, t.completed_at));
    const mins = minutes.filter(x => x.created_at.startsWith(m)).reduce((a, b) => a + b.minutes, 0);
    return { month: m, created: created.length, started: started.length, done: done.length,
      liegezeit_mittel: mean(lieg), liegezeit_median: median(lieg), durchlaufzeit_mittel: mean(durch), minuten: mins, stunden: Math.round(mins / 6) / 10 };
  });
  // Laufend: noch nicht begonnene Aufgaben (Liegezeit läuft noch)
  const waitingStart = live.filter(t => !t.started_at && ['offen', 'wartet'].includes(t.status)).map(t => days(t.created_at, nowIso()));
  // Ziel-Kennzahl (ABN-3): mittlere Liegezeit im Zeitraum der letzten 6 Wochen
  const since = addDays(today(), -42);
  const recent = live.filter(t => t.started_at && t.started_at >= since).map(t => days(t.created_at, t.started_at));
  // Vorher-Wert aus dem Asana-Import (Durchlaufzeit, da Bearbeitungsbeginn unbekannt)
  const asana = tasks.filter(t => String(t.parent_source || '').startsWith('asana:') && t.completed_at).map(t => days(t.created_at, t.completed_at));
  // Zeitersparnis je Vorgangstyp (ABN-4): Vorher-Minuten aus der Vorlage vs. gemessene Minuten je erledigtem Durchlauf
  const byTemplate = q.all('SELECT id, name, baseline_minutes FROM process_templates WHERE active = 1').map(p => {
    const doneIds = new Set(live.filter(t => t.template_id === p.id && t.status === 'erledigt').map(t => t.id));
    if (!doneIds.size) return null;
    const total = minutes.filter(x => doneIds.has(x.task_id)).reduce((a, b) => a + b.minutes, 0);
    const per = Math.round(total / doneIds.size);
    return { id: p.id, name: p.name, durchlaeufe: doneIds.size, minuten_je_durchlauf: per, vorher_minuten: p.baseline_minutes,
      ersparnis_minuten: p.baseline_minutes != null ? p.baseline_minutes - per : null };
  }).filter(Boolean);
  const target = getSetting('liegezeit_ziel_tage', 6);
  const recentMean = mean(recent);
  return {
    monthly, target,
    current: { liegezeit_6_wochen: recentMean, anzahl: recent.length, ziel_erreicht: recentMean != null ? recentMean <= target : null,
      noch_nicht_begonnen: waitingStart.length, warten_seit_mittel: mean(waitingStart) },
    baseline: { asana_durchlaufzeit_mittel: mean(asana), asana_anzahl: asana.length },
    byTemplate,
  };
});

// ---------- Handbuch je Amt (VOR-15, AUF-14, NFA-6) ----------

get('/api/handbook', ({ user, query }) => {
  const areaId = int(query.area, { nullable: false, name: 'Bereich' });
  if (!canSeeArea(user, areaId)) throw bad('Kein Zugriff auf diesen Bereich.');
  const area = q.get('SELECT * FROM areas WHERE id = ?', areaId);
  const offices = q.all(`SELECT o.*, h.name AS holder_name, d.name AS deputy_name FROM offices o LEFT JOIN users h ON h.id = o.holder_id
                         LEFT JOIN users d ON d.id = o.deputy_id WHERE o.area_id = ? ${query.office ? 'AND o.id = ' + int(query.office) : ''} ORDER BY o.name`, areaId);
  const allTemplates = q.all(`SELECT * FROM process_templates WHERE active = 1 AND (scope = ? OR scope = 'beide') ORDER BY CAST(substr(key, 5) AS INTEGER)`, area.type);
  const out = offices.map(o => {
    const usedIds = new Set(q.all('SELECT DISTINCT template_id FROM tasks WHERE office_id = ? AND template_id IS NOT NULL', o.id).map(r => r.template_id));
    q.all('SELECT DISTINCT template_id FROM recurring WHERE office_id = ? AND template_id IS NOT NULL', o.id).forEach(r => usedIds.add(r.template_id));
    const templates = allTemplates.filter(t => usedIds.has(t.id) || (t.office_name && t.office_name.split(/[,/]/).map(s => s.trim().toLowerCase()).includes(o.name.toLowerCase())))
      .map(t => ({
        ...t,
        steps: q.all('SELECT s.*, tt.name AS text_template_name FROM process_steps s LEFT JOIN text_templates tt ON tt.id = s.text_template_id WHERE s.template_id = ? ORDER BY s.pos', t.id),
        learnings: q.all('SELECT * FROM learnings WHERE template_id = ? AND active = 1 ORDER BY date DESC', t.id),
      }));
    const recurring = q.all(`SELECT r.*, p.name AS template_name FROM recurring r LEFT JOIN process_templates p ON p.id = r.template_id
                             WHERE r.office_id = ? AND r.active = 1 ORDER BY r.month, r.day`, o.id);
    const open = q.all(`SELECT id, title, status, due_date FROM tasks WHERE office_id = ? AND status IN ('offen','in_arbeit','wartet') ORDER BY due_date`, o.id);
    return { office: o, templates, recurring, open };
  });
  const learningsArea = q.all('SELECT * FROM learnings WHERE area_id = ? AND template_id IS NULL AND active = 1 ORDER BY date DESC', areaId);
  return { area, generated: nowIso(), offices: out, learnings: learningsArea, systems: q.all('SELECT * FROM systems ORDER BY pos') };
});

// ---------- Asana-Import (AUF-12): einmal importieren, dann ablösen ----------

/** CSV-Leser mit Anführungszeichen, Kommas und Zeilenumbrüchen in Feldern. */
export function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const delim = (src.split('\n')[0].match(/;/g) || []).length > (src.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const header = (rows.shift() || []).map(h => h.trim());
  return rows.filter(r => r.some(v => v.trim())).map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const col = (row, ...names) => { for (const n of names) if (row[n] !== undefined && row[n] !== '') return row[n]; return ''; };
const asanaDate = (s) => { const m = String(s || '').match(/(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; };

function analyseAsana(csv) {
  const rows = parseCsv(csv);
  if (!rows.length) throw bad('Die Datei enthält keine Zeilen.');
  if (!('Name' in rows[0])) throw bad('Das sieht nicht nach einem Asana-Export aus (Spalte „Name“ fehlt). In Asana: Projekt → Exportieren → CSV.');
  const users = q.all('SELECT id, name FROM users WHERE active = 1');
  const assignees = [...new Set(rows.map(r => col(r, 'Assignee', 'Zugewiesen an')).filter(Boolean))].map(name => {
    const match = users.find(u => u.name.toLowerCase() === name.toLowerCase()) || users.find(u => name.toLowerCase().includes(u.name.split(' ').pop().toLowerCase()));
    return { name, user_id: match?.id || null };
  });
  const parents = rows.filter(r => !col(r, 'Parent task', 'Übergeordnete Aufgabe'));
  const subtasks = rows.filter(r => col(r, 'Parent task', 'Übergeordnete Aufgabe'));
  return {
    rows, assignees,
    stats: { total: rows.length, tasks: parents.length, subtasks: subtasks.length, completed: parents.filter(r => col(r, 'Completed At', 'Abgeschlossen am')).length,
      projects: [...new Set(rows.map(r => col(r, 'Projects', 'Projekte')).filter(Boolean))], sections: [...new Set(rows.map(r => col(r, 'Section/Column', 'Abschnitt/Spalte')).filter(Boolean))] },
    sample: parents.slice(0, 15).map(r => ({ name: r.Name, assignee: col(r, 'Assignee'), due: asanaDate(col(r, 'Due Date')), completed: !!col(r, 'Completed At'), section: col(r, 'Section/Column') })),
  };
}

post('/api/import/asana/preview', ({ user, body }) => {
  requireAdmin(user);
  const a = analyseAsana(body.csv);
  return { stats: a.stats, assignees: a.assignees, sample: a.sample };
});

post('/api/import/asana', ({ user, body }) => tx(() => {
  requireAdmin(user);
  const areaId = int(body.area_id, { nullable: false, name: 'Bereich' });
  const a = analyseAsana(body.csv);
  const map = body.assignees || {};
  const includeCompleted = body.include_completed !== false;
  const created = new Map();
  let nTasks = 0, nSteps = 0, skipped = 0;
  for (const r of a.rows.filter(r => !col(r, 'Parent task', 'Übergeordnete Aufgabe'))) {
    const completed = asanaDate(col(r, 'Completed At', 'Abgeschlossen am'));
    if (completed && !includeCompleted) { skipped++; continue; }
    const asanaId = col(r, 'Task ID', 'Aufgaben-ID') || r.Name;
    if (q.get('SELECT 1 FROM tasks WHERE parent_source = ?', `asana:${asanaId}`)) { skipped++; continue; }
    const notes = col(r, 'Notes', 'Notizen');
    const section = col(r, 'Section/Column', 'Abschnitt/Spalte');
    const project = col(r, 'Projects', 'Projekte');
    const tags = col(r, 'Tags');
    const ownerName = col(r, 'Assignee', 'Zugewiesen an');
    const desc = [notes, '', `— Aus Asana übernommen${project ? ` (Projekt: ${project}` : ''}${section ? `${project ? ', ' : ' ('}Abschnitt: ${section}` : ''}${project || section ? ')' : ''}${tags ? `, Schlagwörter: ${tags}` : ''} —`].join('\n').trim();
    const createdAt = asanaDate(col(r, 'Created At', 'Erstellt am'));
    const id = createTask(user, {
      area_id: areaId, title: r.Name || 'Ohne Titel', description: desc, owner_id: map[ownerName] || null,
      due_date: asanaDate(col(r, 'Due Date', 'Fälligkeitsdatum')), channel: 'asana', data_class: body.data_class === 'gelb' ? 'gelb' : 'gruen',
      kind: /idee/i.test(section + ' ' + tags) ? 'idee' : 'aufgabe',
      created_at: createdAt ? `${createdAt}T12:00:00.000Z` : undefined,
    }, { source: `asana:${asanaId}` });
    if (completed) q.run(`UPDATE tasks SET status = 'erledigt', completed_at = ?, started_at = NULL WHERE id = ?`, `${completed}T12:00:00.000Z`, id);
    created.set(r.Name, id);
    nTasks++;
  }
  for (const r of a.rows.filter(r => col(r, 'Parent task', 'Übergeordnete Aufgabe'))) {
    const parentId = created.get(col(r, 'Parent task', 'Übergeordnete Aufgabe'));
    if (!parentId) { skipped++; continue; }
    const done = !!asanaDate(col(r, 'Completed At'));
    const pos = (q.get('SELECT MAX(pos) AS m FROM task_steps WHERE task_id = ?', parentId).m || 0) + 1;
    q.run('INSERT INTO task_steps (task_id, pos, title, description, done, done_at) VALUES (?, ?, ?, ?, ?, ?)', parentId, pos, r.Name, col(r, 'Notes'), done ? 1 : 0, done ? nowIso() : null);
    nSteps++;
  }
  audit(user, { entity: 'import', action: 'asana', areaId, summary: `Asana-Import: ${nTasks} Aufgabe(n), ${nSteps} Teilschritt(e) übernommen, ${skipped} übersprungen` });
  return { tasks: nTasks, steps: nSteps, skipped };
}));

// ---------- Globale Suche ----------

get('/api/search', ({ user, query }) => {
  const term = str(query.q, { max: 200 });
  if (term.length < 2) return { tasks: [], files: [], knowledge: [], templates: [] };
  const ac = areaClause(user, 't.area_id');
  const tasks = q.all(`SELECT t.*, a.name AS area_name, a.color AS area_color, u.name AS owner_name FROM tasks t JOIN areas a ON a.id = t.area_id LEFT JOIN users u ON u.id = t.owner_id WHERE ${ac.sql}`, ...ac.params);
  const tHits = rank(tasks.map(t => ({ id: t.id, text: `${t.title} ${t.title} ${t.description} ${t.waiting_who || ''}`, boost: ['erledigt', 'verworfen'].includes(t.status) ? 0.7 : 1 })), term, { limit: 15 });
  const tMap = new Map(tasks.map(t => [t.id, t]));
  const fac = areaClause(user, 'f.area_id');
  const files = q.all(`SELECT f.id, f.filename, f.issuer, f.occasion, f.tags, f.text_content, f.doc_date, a.name AS area_name FROM files f JOIN areas a ON a.id = f.area_id WHERE f.deleted_at IS NULL AND ${fac.sql}`, ...fac.params);
  const fHits = rank(files.map(f => ({ id: f.id, text: `${f.filename} ${f.issuer} ${f.occasion} ${f.tags} ${f.text_content}` })), term, { limit: 10 });
  const fMap = new Map(files.map(f => [f.id, f]));
  const kac = areaClause(user, 'd.area_id');
  const secs = q.all(`SELECT s.id, s.reference, s.heading, s.body, d.title, d.id AS document_id FROM kb_sections s JOIN kb_documents d ON d.id = s.document_id WHERE d.active = 1 AND (d.area_id IS NULL OR ${kac.sql})`, ...kac.params);
  const kHits = rank(secs.map(s => ({ id: s.id, text: `${s.heading} ${s.heading} ${s.body}` })), term, { limit: 8 });
  const kMap = new Map(secs.map(s => [s.id, s]));
  const tpls = q.all('SELECT id, name, summary, guide FROM process_templates WHERE active = 1');
  const pHits = rank(tpls.map(p => ({ id: p.id, text: `${p.name} ${p.name} ${p.summary} ${p.guide}` })), term, { limit: 6 });
  const pMap = new Map(tpls.map(p => [p.id, p]));
  return {
    tasks: tHits.map(h => decorate(tMap.get(h.id))),
    files: fHits.map(h => { const f = fMap.get(h.id); return { id: f.id, filename: f.filename, area_name: f.area_name, doc_date: f.doc_date }; }),
    knowledge: kHits.map(h => { const s = kMap.get(h.id); return { id: s.id, document_id: s.document_id, title: s.title, reference: s.reference, heading: s.heading }; }),
    templates: pHits.map(h => { const p = pMap.get(h.id); return { id: p.id, name: p.name, summary: p.summary }; }),
  };
});
