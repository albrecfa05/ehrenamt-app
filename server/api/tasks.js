// Aufgaben sehen und bearbeiten (Kapitel 4: AUF-1 … AUF-14).

import { get, post, put, del } from '../http.js';
import { q, tx, getSetting } from '../db.js';
import { areaClause, assertArea, assertCanEditTask, isAdmin, loadTask } from '../access.js';
import { CALCULATORS, runCalculator } from '../calc.js';
import { renderDraft } from '../templating.js';
import { requestApproval } from '../services/automation.js';
import { CHANNEL_LABEL, createTask, experienceFor, learningsFor, notify, touch, updateTask } from '../services/tasks.js';
import { addDays, audit, bad, dateOrNull, formatDateDe, int, nowIso, parseJson, str, today } from '../util.js';
import { scrubPersonalData } from '../guards.js';
import { onAllStepsDone } from '../services/jobs.js';
import { isOn } from '../services/catalog.js';
import { clockNow, nowMs } from '../clock.js';

const TASK_COLUMNS = `t.*, a.name AS area_name, a.color AS area_color, a.type AS area_type, o.name AS office_name,
  u.name AS owner_name, d.name AS deputy_name, pt.name AS template_name,
  (SELECT COUNT(*) FROM task_steps s WHERE s.task_id = t.id) AS steps_total,
  (SELECT COUNT(*) FROM task_steps s WHERE s.task_id = t.id AND s.done = 1) AS steps_done,
  (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id) AS comments_count,
  (SELECT COUNT(*) FROM files f WHERE f.task_id = t.id AND f.deleted_at IS NULL) AS files_count,
  (SELECT COALESCE(SUM(minutes),0) FROM time_entries te WHERE te.task_id = t.id) AS minutes`;
const TASK_JOINS = `FROM tasks t JOIN areas a ON a.id = t.area_id LEFT JOIN offices o ON o.id = t.office_id
  LEFT JOIN users u ON u.id = t.owner_id LEFT JOIN users d ON d.id = t.deputy_id LEFT JOIN process_templates pt ON pt.id = t.template_id`;

/** Ergänzt berechnete Felder für die Anzeige (überfällig, liegt lange). */
export function decorate(t) {
  const d = today();
  const staleDays = getSetting('liegezeit_warnung_tage', 7);
  const open = ['offen', 'in_arbeit', 'wartet'].includes(t.status);
  const idle = (nowMs() - Date.parse(t.last_activity_at)) / 86_400_000;
  return {
    ...t,
    overdue: open && !!t.due_date && t.due_date < d,
    due_today: open && t.due_date === d,
    stale: open && idle > staleDays,
    idle_days: Math.floor(idle),
    age_days: Math.floor((nowMs() - Date.parse(t.created_at)) / 86_400_000),
  };
}

// AUF-1: zentrale Übersicht mit Filtern
get('/api/tasks', ({ user, query }) => {
  const ac = areaClause(user, 't.area_id');
  const where = [ac.sql];
  const params = [...ac.params];
  where.push('t.kind = ?'); params.push(query.kind === 'idee' ? 'idee' : 'aufgabe');
  if (query.area) { where.push('t.area_id = ?'); params.push(int(query.area)); }
  if (query.office) { where.push('t.office_id = ?'); params.push(int(query.office)); }
  if (query.owner === 'me') { where.push('(t.owner_id = ? OR t.deputy_id = ?)'); params.push(user.id, user.id); }
  else if (query.owner === 'none') where.push('t.owner_id IS NULL');
  else if (query.owner) { where.push('t.owner_id = ?'); params.push(int(query.owner)); }
  if (query.template) { where.push('t.template_id = ?'); params.push(int(query.template)); }
  const st = query.status || 'aktiv';
  if (st === 'aktiv') where.push(`t.status IN ('offen','in_arbeit','wartet')`);
  else if (st !== 'alle') {
    const list = st.split(',').filter(s => ['offen', 'in_arbeit', 'wartet', 'erledigt', 'verworfen'].includes(s));
    if (list.length) where.push(`t.status IN (${list.map(() => '?').join(',')})`), params.push(...list);
  }
  const d = today();
  switch (query.due) {
    case 'ueberfaellig': where.push('t.due_date < ?'); params.push(d); break;
    case 'heute': where.push('t.due_date = ?'); params.push(d); break;
    case 'woche': where.push('t.due_date BETWEEN ? AND ?'); params.push(d, addDays(d, 7)); break;
    case 'monat': where.push('t.due_date BETWEEN ? AND ?'); params.push(d, addDays(d, 31)); break;
    case 'ohne': where.push('t.due_date IS NULL'); break;
  }
  if (query.q) {
    where.push('(t.title LIKE ? OR t.description LIKE ? OR t.waiting_who LIKE ?)');
    const like = `%${query.q}%`; params.push(like, like, like);
  }
  if (query.stale === '1') {
    where.push('t.last_activity_at < ?'); params.push(new Date(nowMs() - getSetting('liegezeit_warnung_tage', 7) * 86_400_000).toISOString());
  }
  const order = {
    faelligkeit: 't.due_date IS NULL, t.due_date, t.priority DESC, t.id',
    neu: 't.created_at DESC',
    bewegung: 't.last_activity_at ASC',
    bereich: 'a.name, t.due_date IS NULL, t.due_date',
  }[query.sort] || 't.due_date IS NULL, t.due_date, t.priority DESC, t.id';
  const rows = q.all(`SELECT ${TASK_COLUMNS} ${TASK_JOINS} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 1000`, ...params);
  return rows.map(decorate);
});

post('/api/tasks', ({ user, body }) => {
  assertArea(user, int(body.area_id, { nullable: false, name: 'Bereich' }));
  const id = createTask(user, body);
  return { id };
});

// Vollständige Aufgabe mit Teilschritten, Verlauf, Anhängen, Entwürfen usw.
get('/api/tasks/:id', ({ user, params }) => {
  const base = loadTask(user, int(params.id));
  const t = decorate(q.get(`SELECT ${TASK_COLUMNS} ${TASK_JOINS} WHERE t.id = ?`, base.id));
  const tpl = t.template_id ? q.get('SELECT id, name, guide, max_level, never_execute, data_class, version, summary FROM process_templates WHERE id = ?', t.template_id) : null;
  const steps = q.all(`SELECT s.*, u.name AS done_by_name, tt.name AS text_template_name FROM task_steps s
                       LEFT JOIN users u ON u.id = s.done_by LEFT JOIN text_templates tt ON tt.id = s.text_template_id
                       WHERE s.task_id = ? ORDER BY s.pos`, t.id);
  const comments = q.all('SELECT c.*, u.name AS user_name FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.task_id = ? ORDER BY c.created_at', t.id);
  const files = q.all('SELECT id, filename, mime, size, data_class, created_at, uploaded_by FROM files WHERE task_id = ? AND deleted_at IS NULL ORDER BY created_at DESC', t.id);
  const drafts = q.all('SELECT d.*, tt.name AS template_name FROM drafts d LEFT JOIN text_templates tt ON tt.id = d.template_id WHERE d.task_id = ? ORDER BY d.created_at DESC', t.id)
    .map(d => ({ ...d, recipients: parseJson(d.recipients, []), warnings: parseJson(d.warnings, []) }));
  const time = q.all('SELECT te.*, u.name AS user_name FROM time_entries te LEFT JOIN users u ON u.id = te.user_id WHERE te.task_id = ? ORDER BY te.created_at DESC', t.id);
  const calcs = q.all('SELECT c.*, u.name AS user_name FROM calculations c LEFT JOIN users u ON u.id = c.user_id WHERE c.task_id = ? ORDER BY c.created_at DESC', t.id)
    .map(c => ({ ...c, input: parseJson(c.input, {}), result: parseJson(c.result, {}), steps: parseJson(c.steps, []) }));
  const history = q.all(`SELECT at, user_name, action, summary FROM audit_log WHERE entity = 'task' AND entity_id = ? ORDER BY id DESC`, t.id);
  const approvals = q.all('SELECT a.*, u.name AS decided_by_name FROM approvals a LEFT JOIN users u ON u.id = a.decided_by WHERE a.task_id = ? ORDER BY a.requested_at DESC', t.id);
  const events = q.all('SELECT * FROM events WHERE task_id = ? ORDER BY date', t.id);
  return {
    task: t, template: tpl, steps, comments, files, drafts, time, calcs, history, approvals, events,
    experience: experienceFor(t), learnings: learningsFor(t),
    canEdit: isAdmin(user) || [t.owner_id, t.deputy_id, t.created_by].includes(user.id),
  };
});

put('/api/tasks/:id', ({ user, params, body }) => {
  const t = loadTask(user, int(params.id));
  assertCanEditTask(user, t);
  if (body.area_id && Number(body.area_id) !== t.area_id) assertArea(user, Number(body.area_id));
  updateTask(user, t, body);
  return { ok: true };
});

// Sammelbearbeitung (AUF-9): mehrere Aufgaben auf einmal ändern, z. B. Status oder Zuständigkeit
post('/api/tasks/bulk', ({ user, body }) => tx(() => {
  const ids = (body.ids || []).map(Number).filter(Boolean).slice(0, 200);
  const changes = {};
  for (const k of ['status', 'owner_id', 'due_date', 'office_id']) if (Object.hasOwn(body.changes || {}, k)) changes[k] = body.changes[k];
  if (!ids.length || !Object.keys(changes).length) throw bad('Bitte Aufgaben und eine Änderung wählen.');
  if (changes.status === 'wartet') throw bad('„Wartet auf Zulieferung“ bitte einzeln setzen, damit klar ist, wer was schuldet.');
  let n = 0;
  for (const id of ids) {
    const t = loadTask(user, id);
    assertCanEditTask(user, t);
    updateTask(user, t, changes);
    n++;
  }
  return { updated: n };
}));

// Kommentare (Zuarbeitende dürfen auch bei fremden Aufgaben Material zuliefern)
post('/api/tasks/:id/comments', ({ user, params, body }) => {
  const t = loadTask(user, int(params.id));
  const text = str(body.body, { required: true, max: 10_000, name: 'Kommentar' });
  q.run('INSERT INTO comments (task_id, user_id, body, created_at) VALUES (?, ?, ?, ?)', t.id, user.id, text, nowIso());
  touch(t.id, { firstWork: [t.owner_id, t.deputy_id].includes(user.id) });
  audit(user, { entity: 'task', entityId: t.id, areaId: t.area_id, action: 'kommentar', summary: `Kommentar: ${text.slice(0, 140)}${text.length > 140 ? ' …' : ''}` });
  const others = [t.owner_id, t.deputy_id].filter(id => id && id !== user.id);
  notify(others, t.id, 'kommentar', `${user.name} hat „${t.title}“ kommentiert.`);
  return { ok: true };
});

// Teilschritte (AUF-3): abhaken, Notiz, neu, sortieren
put('/api/tasks/:id/steps/:stepId', ({ user, params, body }) => tx(() => {
  const t = loadTask(user, int(params.id));
  assertCanEditTask(user, t);
  const s = q.get('SELECT * FROM task_steps WHERE id = ? AND task_id = ?', int(params.stepId), t.id);
  if (!s) throw bad('Teilschritt nicht gefunden.');
  if (body.done !== undefined) {
    const done = body.done ? 1 : 0;
    q.run('UPDATE task_steps SET done = ?, done_by = ?, done_at = ? WHERE id = ?', done, done ? user.id : null, done ? nowIso() : null, s.id);
    audit(user, { entity: 'task', entityId: t.id, areaId: t.area_id, action: 'schritt', summary: `Schritt ${s.pos} „${s.title}“ ${done ? 'erledigt' : 'wieder geöffnet'}` });
    // Erster erledigter Schritt setzt die Aufgabe auf „In Arbeit“
    if (done && t.status === 'offen') updateTask(user, t, { status: 'in_arbeit' });
    if (done) onAllStepsDone(user, t, updateTask);
  }
  if (body.note !== undefined) {
    const note = str(body.note, { max: 5000 });
    q.run('UPDATE task_steps SET note = ? WHERE id = ?', note, s.id);
    audit(user, { entity: 'task', entityId: t.id, areaId: t.area_id, action: 'schritt', summary: `Notiz zu Schritt ${s.pos} „${s.title}“: ${note.slice(0, 120)}` });
  }
  if (body.title !== undefined) q.run('UPDATE task_steps SET title = ? WHERE id = ?', str(body.title, { required: true, max: 300, name: 'Titel' }), s.id);
  touch(t.id, { firstWork: true });
  return { ok: true };
}));

post('/api/tasks/:id/steps', ({ user, params, body }) => {
  const t = loadTask(user, int(params.id));
  assertCanEditTask(user, t);
  const title = str(body.title, { required: true, max: 300, name: 'Titel' });
  const pos = (q.get('SELECT MAX(pos) AS m FROM task_steps WHERE task_id = ?', t.id).m || 0) + 1;
  q.run('INSERT INTO task_steps (task_id, pos, title, description) VALUES (?, ?, ?, ?)', t.id, pos, title, str(body.description, { max: 5000 }));
  touch(t.id);
  audit(user, { entity: 'task', entityId: t.id, areaId: t.area_id, action: 'schritt', summary: `Schritt „${title}“ ergänzt` });
  return { ok: true };
});

del('/api/tasks/:id/steps/:stepId', ({ user, params }) => {
  const t = loadTask(user, int(params.id));
  assertCanEditTask(user, t);
  const s = q.get('SELECT * FROM task_steps WHERE id = ? AND task_id = ?', int(params.stepId), t.id);
  if (!s) throw bad('Teilschritt nicht gefunden.');
  q.run('DELETE FROM task_steps WHERE id = ?', s.id);
  audit(user, { entity: 'task', entityId: t.id, areaId: t.area_id, action: 'schritt', summary: `Schritt „${s.title}“ entfernt` });
});

// Zeiterfassung (AUF-10, ABN-4)
post('/api/tasks/:id/time', ({ user, params, body }) => {
  const t = loadTask(user, int(params.id));
  const minutes = int(body.minutes, { min: 1, max: 24 * 60, nullable: false, name: 'Minuten' });
  q.run('INSERT INTO time_entries (task_id, user_id, minutes, note, created_at) VALUES (?, ?, ?, ?, ?)', t.id, user.id, minutes, str(body.note, { max: 500 }), nowIso());
  touch(t.id, { firstWork: true });
  audit(user, { entity: 'task', entityId: t.id, areaId: t.area_id, action: 'zeit', summary: `${minutes} Minuten erfasst${body.note ? `: ${body.note}` : ''}` });
  return { ok: true };
});

// Berechnung mit Rechenweg im Protokoll (AUT-12)
get('/api/calculators', () => Object.entries(CALCULATORS).map(([key, c]) => ({
  key, label: c.label, description: c.description,
  fields: c.fields.map(f => ({ ...f, default: f.defaultFrom ? getSetting(f.defaultFrom, f.default ?? null) : f.default, options: f.optionsFrom === 'beitragsstufen' ? getSetting('beitragsstufen', []).map(s => s.name) : f.options })),
})));

post('/api/calculators/:key', ({ params, body }) => runCalculator(params.key, body));

post('/api/tasks/:id/calc', ({ user, params, body }) => {
  const t = loadTask(user, int(params.id));
  const key = str(body.calc, { required: true, name: 'Rechner' });
  const out = runCalculator(key, body.input);
  const input = Object.fromEntries(Object.entries(body.input || {}).map(([k, v]) => [k, scrubPersonalData(String(v)).text]));
  q.run('INSERT INTO calculations (task_id, calc, input, result, steps, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    t.id, key, JSON.stringify(input), JSON.stringify(out.result), JSON.stringify(out.steps), user.id, nowIso());
  touch(t.id, { firstWork: true });
  audit(user, { entity: 'task', entityId: t.id, areaId: t.area_id, action: 'berechnung', summary: `Berechnung „${CALCULATORS[key].label}“: ${out.summary}`, detail: { steps: out.steps } });
  return out;
});

// Entwurf aus Textvorlage (AUT-5, AUT-14). Empfänger: nur Namen (AUT-9).
post('/api/tasks/:id/drafts', ({ user, params, body }) => {
  const t = loadTask(user, int(params.id));
  const tpl = q.get('SELECT * FROM text_templates WHERE id = ? AND active = 1', int(body.template_id, { nullable: false, name: 'Vorlage' }));
  if (!tpl) throw bad('Vorlage nicht gefunden.');
  if (tpl.area_id && tpl.area_id !== t.area_id) throw bad('Diese Vorlage gehört zu einem anderen Bereich.');
  const area = q.get('SELECT * FROM areas WHERE id = ?', t.area_id);
  const out = renderDraft(tpl, body.values || {}, { areaName: area.name, areaType: area.type, userName: user.name, taskTitle: t.title, dueDate: t.due_date });
  const recipients = cleanRecipients(body.recipients);
  const r = q.run(`INSERT INTO drafts (task_id, area_id, template_id, template_version, kind, subject, body, recipients, warnings, created_by, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    t.id, t.area_id, tpl.id, tpl.version, tpl.kind, out.subject, out.body, JSON.stringify(recipients), JSON.stringify(out.warnings), user.id, nowIso());
  touch(t.id, { firstWork: true });
  audit(user, { entity: 'task', entityId: t.id, areaId: t.area_id, action: 'entwurf', summary: `Entwurf aus „${tpl.name}“ (v${tpl.version}) erzeugt${recipients.length ? ` für ${recipients.length} Empfänger` : ''}` });
  return { id: Number(r.lastInsertRowid), ...out };
});

export function cleanRecipients(list) {
  const arr = Array.isArray(list) ? list : String(list || '').split(/[\n,;]+/);
  const out = [];
  for (const raw of arr) {
    const name = String(raw).trim();
    if (!name) continue;
    const { text, warnings } = scrubPersonalData(name);
    if (warnings.length) throw bad(`Empfänger nur mit Namen angeben, ohne Adressen oder Nummern (AUT-9): „${name}“`);
    out.push(text.slice(0, 120));
  }
  return [...new Set(out)].slice(0, 500);
}

// Kalendereintrag zur Freigabe anfragen (Stufe 3)
post('/api/tasks/:id/event-request', ({ user, params, body }) => {
  const t = loadTask(user, int(params.id));
  if (t.level < 3 && !isAdmin(user)) throw bad('Die Aufgabe hat nicht Stufe 3 „Ausführung nach Freigabe“.');
  if (t.template_id) {
    const tpl = q.get('SELECT max_level, never_execute, name FROM process_templates WHERE id = ?', t.template_id);
    if (tpl.never_execute || tpl.max_level < 3) throw bad(`„${tpl.name}“ darf höchstens Stufe ${tpl.max_level}${tpl.never_execute ? ' und nie ausführen' : ''}. Bitte den Termin selbst eintragen.`);
  }
  const date = dateOrNull(body.date || t.due_date, 'Datum');
  if (!date) throw bad('Bitte ein Datum angeben.');
  const title = str(body.title || t.title, { required: true, max: 200, name: 'Titel' });
  const outlook = !!body.outlook && isOn('m365_kalender');
  const payload = { kind: 'kalendereintrag', area_id: t.area_id, title, date, time: str(body.time, { max: 5 }) || null, location: str(body.location, { max: 200 }), notes: '', outlook };
  const id = requestApproval({ actionType: 'kalendereintrag', payload, summary: `Kalendereintrag „${title}“ am ${formatDateDe(date)} anlegen${outlook ? ' (Kalender-Abo und Outlook-Kalender)' : ''}`, taskId: t.id, user });
  touch(t.id, { firstWork: true });
  audit(user, { entity: 'task', entityId: t.id, areaId: t.area_id, action: 'freigabe', summary: `Freigabe #${id} für Kalendereintrag angefragt` });
  return { approvalId: id };
});

// Korrektur oder Entscheidung ins Lernprotokoll übernehmen (AUT-15)
post('/api/tasks/:id/learning', ({ user, params, body }) => {
  const t = loadTask(user, int(params.id));
  const topic = str(body.topic, { required: true, max: 200, name: 'Thema' });
  const rule = str(body.rule, { required: true, max: 2000, name: 'Regel' });
  const r = q.run('INSERT INTO learnings (date, topic, rule, origin, template_id, area_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    today(), topic, rule, `Aufgabe #${t.id} „${t.title}“`, t.template_id, t.area_id, user.id, nowIso());
  audit(user, { entity: 'task', entityId: t.id, areaId: t.area_id, action: 'lernprotokoll', summary: `Ins Lernprotokoll: ${topic} – ${rule.slice(0, 120)}` });
  return { id: Number(r.lastInsertRowid) };
});

// ---------- Startseite ----------

get('/api/dashboard', ({ user }) => {
  const ac = areaClause(user, 't.area_id');
  const base = `SELECT ${TASK_COLUMNS} ${TASK_JOINS} WHERE ${ac.sql} AND t.kind = 'aufgabe' AND t.status IN ('offen','in_arbeit','wartet')`;
  const all = q.all(base + ' ORDER BY t.due_date IS NULL, t.due_date', ...ac.params).map(decorate);
  const mine = all.filter(t => t.owner_id === user.id || t.deputy_id === user.id);
  const d = today();
  const ideasDays = getSetting('idee_vorlage_tage', 60);
  const ideas = q.all(`SELECT t.id, t.title, t.last_activity_at, a.name AS area_name FROM tasks t JOIN areas a ON a.id = t.area_id
                       WHERE ${ac.sql} AND t.kind = 'idee' AND t.status IN ('offen','in_arbeit','wartet') AND t.last_activity_at < ?
                       ORDER BY t.last_activity_at`, ...ac.params, new Date(nowMs() - ideasDays * 86_400_000).toISOString());
  const upcoming = q.all(`SELECT e.*, a.name AS area_name, a.color AS area_color FROM events e JOIN areas a ON a.id = e.area_id
                          WHERE ${ac.sql.replace('t.area_id', 'e.area_id')} AND e.date BETWEEN ? AND ? ORDER BY e.date, e.time`, ...ac.params, d, addDays(d, 14));
  const report = q.get(`SELECT * FROM reports WHERE type = 'uebersicht' ORDER BY id DESC LIMIT 1`);
  return {
    totals: {
      offen: all.length,
      mine: mine.length,
      ueberfaellig: all.filter(t => t.overdue).length,
      heute: all.filter(t => t.due_today).length,
      wartet: all.filter(t => t.status === 'wartet').length,
      liegt_lange: all.filter(t => t.stale).length,
    },
    mine: mine.slice(0, 50),
    overdue: all.filter(t => t.overdue).slice(0, 50),
    week: all.filter(t => t.due_date && t.due_date >= d && t.due_date <= addDays(d, 7)).slice(0, 50),
    waiting: all.filter(t => t.status === 'wartet').slice(0, 50),
    stale: all.filter(t => t.stale && !t.overdue).sort((a, b) => b.idle_days - a.idle_days).slice(0, 30),
    unassigned: all.filter(t => !t.owner_id).slice(0, 30),
    ideas,
    upcoming,
    lastReport: report ? { id: report.id, title: report.title, created_at: report.created_at } : null,
    channels: CHANNEL_LABEL,
  };
});

// ---------- Benachrichtigungen ----------

get('/api/notifications', ({ user, query }) => q.all(
  `SELECT n.*, t.title AS task_title FROM notifications n LEFT JOIN tasks t ON t.id = n.task_id
   WHERE n.user_id = ? ${query.unread === '1' ? 'AND n.read_at IS NULL' : ''} ORDER BY n.id DESC LIMIT 100`, user.id));

post('/api/notifications/read', ({ user, body }) => {
  const now = nowIso();
  if (Array.isArray(body.ids) && body.ids.length) {
    for (const id of body.ids) q.run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL', now, int(id), user.id);
  } else q.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', now, user.id);
  return { ok: true };
});
