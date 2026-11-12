// Vorgangsvorlagen (AUF-3, AUF-14, AUT-1, VOR-*), Textvorlagen (ABL-3) und Entwürfe (AUT-14).
// Je Regel und Vorlage gibt es genau eine gültige Version (ABL-4); ältere Stände liegen in "versions".
// Jede Änderung erscheint im Update-Fenster (ABL-5).

import { get, post, put } from '../http.js';
import { q, tx } from '../db.js';
import { canSeeArea, requireAdmin } from '../access.js';
import { extractVariables, renderDraft, validateTemplate } from '../templating.js';
import { MANY_RECIPIENTS } from '../services/automation.js';
import { CALCULATORS } from '../calc.js';
import { audit, bad, forbidden, int, notFound, nowIso, oneOf, parseJson, str } from '../util.js';
import { cleanRecipients } from './tasks.js';
import { touch } from '../services/tasks.js';

/** Legt den alten Stand ab, erhöht die Version und schreibt ins Update-Fenster. */
export function newVersion(user, entity, row, note, title) {
  q.run('INSERT INTO versions (entity, entity_id, version, snapshot, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    entity, row.id, row.version, JSON.stringify(row), note, nowIso(), user.id);
  q.run('INSERT INTO changelog (entity, entity_id, title, note, version, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    entity, row.id, title, note, row.version + 1, nowIso(), user.id);
  return row.version + 1;
}

// ---------- Vorgangsvorlagen ----------

get('/api/process-templates', ({ query }) => {
  const rows = q.all(`SELECT p.*, (SELECT COUNT(*) FROM process_steps s WHERE s.template_id = p.id) AS steps_count,
                        (SELECT COUNT(*) FROM tasks t WHERE t.template_id = p.id AND t.status IN ('offen','in_arbeit','wartet')) AS open_tasks,
                        (SELECT COUNT(*) FROM tasks t WHERE t.template_id = p.id AND t.status = 'erledigt') AS done_tasks
                      FROM process_templates p ${query.all === '1' ? '' : 'WHERE p.active = 1'} ORDER BY p.key IS NULL, CAST(substr(p.key, 5) AS INTEGER), p.name`);
  return rows;
});

get('/api/process-templates/:id', ({ params }) => {
  const p = q.get('SELECT p.*, u.name AS updated_by_name FROM process_templates p LEFT JOIN users u ON u.id = p.updated_by WHERE p.id = ?', int(params.id));
  if (!p) throw notFound('Vorgangsvorlage nicht gefunden.');
  const steps = q.all('SELECT s.*, tt.name AS text_template_name FROM process_steps s LEFT JOIN text_templates tt ON tt.id = s.text_template_id WHERE s.template_id = ? ORDER BY s.pos', p.id);
  const versions = q.all('SELECT v.id, v.version, v.note, v.created_at, u.name AS created_by_name FROM versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.entity = ? AND v.entity_id = ? ORDER BY v.version DESC', 'process_template', p.id);
  const learnings = q.all('SELECT * FROM learnings WHERE template_id = ? ORDER BY date DESC', p.id);
  const rules = q.all('SELECT id, name, level, active, approved FROM rules WHERE template_id = ?', p.id);
  return { template: p, steps, versions, learnings, rules };
});

function cleanProcessTemplate(b) {
  const steps = (b.steps || []).map((s, i) => ({
    title: str(s.title, { required: true, max: 300, name: `Schritt ${i + 1}` }),
    description: str(s.description, { max: 5000 }),
    manual: s.manual ? 1 : 0,
    text_template_id: int(s.text_template_id),
    calc: s.calc && CALCULATORS[s.calc] ? s.calc : null,
  }));
  return {
    name: str(b.name, { required: true, max: 200, name: 'Name' }),
    scope: oneOf(b.scope, ['verein', 'bezirk', 'beide'], { name: 'Ebene', fallback: 'verein' }),
    office_name: str(b.office_name, { max: 120 }) || null,
    summary: str(b.summary, { max: 2000 }),
    guide: str(b.guide, { max: 50_000 }),
    max_level: int(b.max_level, { min: 0, max: 4, nullable: false, name: 'Höchststufe' }),
    never_execute: b.never_execute ? 1 : 0,
    data_class: oneOf(b.data_class, ['gruen', 'gelb'], { name: 'Datenklasse', fallback: 'gruen' }),
    minors: b.minors ? 1 : 0,
    baseline_minutes: int(b.baseline_minutes, { min: 0, max: 100_000 }),
    source_ref: str(b.source_ref, { max: 200 }) || null,
    steps,
  };
}

function writeSteps(id, steps) {
  q.run('DELETE FROM process_steps WHERE template_id = ?', id);
  steps.forEach((s, i) => q.run('INSERT INTO process_steps (template_id, pos, title, description, manual, text_template_id, calc) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, i + 1, s.title, s.description, s.manual, s.text_template_id, s.calc));
}

// Neue Vorgangstypen legen Admins selbst an (7.8)
post('/api/process-templates', ({ user, body }) => tx(() => {
  requireAdmin(user);
  const d = cleanProcessTemplate(body);
  if (d.never_execute && d.max_level > 2) d.max_level = 2;
  const r = q.run(`INSERT INTO process_templates (name, scope, office_name, summary, guide, max_level, never_execute, data_class, minors, baseline_minutes, source_ref, updated_at, updated_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    d.name, d.scope, d.office_name, d.summary, d.guide, d.max_level, d.never_execute, d.data_class, d.minors, d.baseline_minutes, d.source_ref, nowIso(), user.id);
  const id = Number(r.lastInsertRowid);
  writeSteps(id, d.steps);
  q.run('INSERT INTO changelog (entity, entity_id, title, note, version, created_at, created_by) VALUES (?, ?, ?, ?, 1, ?, ?)',
    'process_template', id, `Neuer Vorgangstyp „${d.name}“`, str(body.note, { max: 1000 }), nowIso(), user.id);
  audit(user, { entity: 'process_template', entityId: id, action: 'angelegt', summary: `Vorgangsvorlage „${d.name}“ angelegt` });
  return { id };
}));

put('/api/process-templates/:id', ({ user, params, body }) => tx(() => {
  requireAdmin(user);
  const p = q.get('SELECT * FROM process_templates WHERE id = ?', int(params.id));
  if (!p) throw notFound();
  if (body.active !== undefined && Object.keys(body).length <= 2) {
    q.run('UPDATE process_templates SET active = ? WHERE id = ?', body.active ? 1 : 0, p.id);
    audit(user, { entity: 'process_template', entityId: p.id, action: body.active ? 'aktiviert' : 'archiviert', summary: `Vorgangsvorlage „${p.name}“ ${body.active ? 'aktiviert' : 'archiviert'}` });
    return { ok: true };
  }
  const note = str(body.note, { required: true, max: 1000, name: 'Änderungsnotiz' });
  const d = cleanProcessTemplate(body);
  if (d.never_execute && d.max_level > 2) d.max_level = 2;
  // Regeln dürfen die neue Höchststufe nicht überschreiten (AUT-1)
  const tooHigh = q.all('SELECT name, level FROM rules WHERE template_id = ? AND level > ?', p.id, d.max_level);
  if (tooHigh.length) throw bad(`Diese Regeln liegen über der neuen Höchststufe und müssen zuerst angepasst werden: ${tooHigh.map(r => `${r.name} (Stufe ${r.level})`).join(', ')}`);
  const snapshot = { ...p, steps: q.all('SELECT * FROM process_steps WHERE template_id = ? ORDER BY pos', p.id) };
  const version = newVersion(user, 'process_template', snapshot, note, `Vorgang „${d.name}“ geändert`);
  q.run(`UPDATE process_templates SET name = ?, scope = ?, office_name = ?, summary = ?, guide = ?, max_level = ?, never_execute = ?, data_class = ?,
         minors = ?, baseline_minutes = ?, source_ref = ?, version = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
    d.name, d.scope, d.office_name, d.summary, d.guide, d.max_level, d.never_execute, d.data_class, d.minors, d.baseline_minutes, d.source_ref,
    version, nowIso(), user.id, p.id);
  writeSteps(p.id, d.steps);
  audit(user, { entity: 'process_template', entityId: p.id, action: 'version', summary: `Vorgangsvorlage „${d.name}“ → Version ${version}: ${note}` });
  return { ok: true, version };
}));

get('/api/versions/:id', ({ params }) => {
  const v = q.get('SELECT * FROM versions WHERE id = ?', int(params.id));
  if (!v) throw notFound();
  return { ...v, snapshot: parseJson(v.snapshot, {}) };
});

// ---------- Textvorlagen ----------

get('/api/text-templates', ({ user, query }) => {
  const rows = q.all(`SELECT t.*, a.name AS area_name, u.name AS updated_by_name FROM text_templates t LEFT JOIN areas a ON a.id = t.area_id
                      LEFT JOIN users u ON u.id = t.updated_by ${query.all === '1' ? '' : 'WHERE t.active = 1'} ORDER BY t.category, t.name`);
  return rows.filter(r => canSeeArea(user, r.area_id)).map(r => ({ ...r, variables: extractVariables(r.subject, r.body) }));
});

get('/api/text-templates/:id', ({ user, params }) => {
  const t = q.get('SELECT * FROM text_templates WHERE id = ?', int(params.id));
  if (!t || !canSeeArea(user, t.area_id)) throw notFound('Vorlage nicht gefunden.');
  const versions = q.all('SELECT v.id, v.version, v.note, v.created_at, u.name AS created_by_name FROM versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.entity = ? AND v.entity_id = ? ORDER BY v.version DESC', 'text_template', t.id);
  return { template: { ...t, variables: extractVariables(t.subject, t.body) }, versions };
});

function cleanTextTemplate(b) {
  const d = {
    name: str(b.name, { required: true, max: 200, name: 'Name' }),
    category: str(b.category, { max: 80 }) || 'Allgemein',
    kind: oneOf(b.kind, ['mail', 'dokument', 'text'], { name: 'Art', fallback: 'mail' }),
    subject: str(b.subject, { max: 500 }),
    body: str(b.body, { required: true, max: 50_000, name: 'Text' }),
    notes: str(b.notes, { max: 5000 }),
    area_id: int(b.area_id),
  };
  validateTemplate(d.subject, d.body);
  return d;
}

post('/api/text-templates', ({ user, body }) => {
  requireAdmin(user);
  const d = cleanTextTemplate(body);
  const r = q.run(`INSERT INTO text_templates (area_id, name, category, kind, subject, body, notes, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    d.area_id, d.name, d.category, d.kind, d.subject, d.body, d.notes, nowIso(), user.id);
  const id = Number(r.lastInsertRowid);
  q.run('INSERT INTO changelog (entity, entity_id, title, note, version, created_at, created_by) VALUES (?, ?, ?, ?, 1, ?, ?)',
    'text_template', id, `Neue Textvorlage „${d.name}“`, '', nowIso(), user.id);
  audit(user, { entity: 'text_template', entityId: id, areaId: d.area_id, action: 'angelegt', summary: `Textvorlage „${d.name}“ angelegt` });
  return { id };
});

put('/api/text-templates/:id', ({ user, params, body }) => tx(() => {
  requireAdmin(user);
  const t = q.get('SELECT * FROM text_templates WHERE id = ?', int(params.id));
  if (!t) throw notFound();
  if (body.active !== undefined && Object.keys(body).length <= 2) {
    q.run('UPDATE text_templates SET active = ? WHERE id = ?', body.active ? 1 : 0, t.id);
    audit(user, { entity: 'text_template', entityId: t.id, action: body.active ? 'aktiviert' : 'archiviert', summary: `Textvorlage „${t.name}“ ${body.active ? 'aktiviert' : 'archiviert'}` });
    return { ok: true };
  }
  const note = str(body.note, { required: true, max: 1000, name: 'Änderungsnotiz' });
  const d = cleanTextTemplate(body);
  const version = newVersion(user, 'text_template', t, note, `Textvorlage „${d.name}“ geändert`);
  q.run(`UPDATE text_templates SET area_id = ?, name = ?, category = ?, kind = ?, subject = ?, body = ?, notes = ?, version = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
    d.area_id, d.name, d.category, d.kind, d.subject, d.body, d.notes, version, nowIso(), user.id, t.id);
  audit(user, { entity: 'text_template', entityId: t.id, areaId: d.area_id, action: 'version', summary: `Textvorlage „${d.name}“ → Version ${version}: ${note}` });
  return { ok: true, version };
}));

// Vorschau ohne Speichern
post('/api/text-templates/:id/preview', ({ user, params, body }) => {
  const t = q.get('SELECT * FROM text_templates WHERE id = ?', int(params.id));
  if (!t || !canSeeArea(user, t.area_id)) throw notFound();
  const area = body.area_id ? q.get('SELECT * FROM areas WHERE id = ?', int(body.area_id)) : null;
  return renderDraft(t, body.values || {}, { areaName: area?.name, areaType: area?.type, userName: user.name });
});

// ---------- Entwürfe ----------

get('/api/drafts', ({ user, query }) => {
  const status = ['entwurf', 'uebernommen', 'verworfen'].includes(query.status) ? query.status : 'entwurf';
  return q.all(`SELECT d.*, t.title AS task_title, a.name AS area_name, tt.name AS template_name, u.name AS created_by_name, r.name AS rule_name
                FROM drafts d JOIN areas a ON a.id = d.area_id LEFT JOIN tasks t ON t.id = d.task_id
                LEFT JOIN text_templates tt ON tt.id = d.template_id LEFT JOIN users u ON u.id = d.created_by LEFT JOIN rules r ON r.id = d.created_by_rule
                WHERE d.status = ? ORDER BY d.created_at DESC LIMIT 300`, status)
    .filter(d => canSeeArea(user, d.area_id))
    .map(d => ({ ...d, recipients: parseJson(d.recipients, []), warnings: parseJson(d.warnings, []) }));
});

function loadDraft(user, id) {
  const d = q.get('SELECT * FROM drafts WHERE id = ?', id);
  if (!d || !canSeeArea(user, d.area_id)) throw notFound('Entwurf nicht gefunden.');
  return d;
}

put('/api/drafts/:id', ({ user, params, body }) => {
  const d = loadDraft(user, int(params.id));
  if (d.status !== 'entwurf') throw bad('Nur offene Entwürfe lassen sich bearbeiten.');
  const subject = str(body.subject ?? d.subject, { max: 500 });
  const text = str(body.body ?? d.body, { max: 50_000 });
  const recipients = body.recipients !== undefined ? cleanRecipients(body.recipients) : parseJson(d.recipients, []);
  q.run('UPDATE drafts SET subject = ?, body = ?, recipients = ? WHERE id = ?', subject, text, JSON.stringify(recipients), d.id);
  if (d.task_id) { touch(d.task_id, { firstWork: true }); audit(user, { entity: 'task', entityId: d.task_id, areaId: d.area_id, action: 'entwurf', summary: `Entwurf #${d.id} bearbeitet` }); }
  return { ok: true };
});

// Ein Mensch übernimmt den Entwurf und verschickt ihn selbst (AUT-14).
// Bei vielen Empfängern ist eine eigene Bestätigung mit sichtbarer Liste nötig (AUT-7).
post('/api/drafts/:id/take', ({ user, params, body }) => {
  const d = loadDraft(user, int(params.id));
  if (d.status !== 'entwurf') throw bad('Dieser Entwurf wurde bereits übernommen oder verworfen.');
  const recipients = parseJson(d.recipients, []);
  if (recipients.length >= MANY_RECIPIENTS && !(body.confirmRecipients === true && body.recipientCount === recipients.length)) {
    throw bad(`Dieser Entwurf geht an ${recipients.length} Empfänger. Bitte die Empfängerliste ausdrücklich bestätigen (AUT-7).`, { needsRecipientConfirmation: true, recipients });
  }
  if (d.task_id) {
    const t = q.get('SELECT * FROM tasks WHERE id = ?', d.task_id);
    if (t && user.role !== 'admin' && ![t.owner_id, t.deputy_id].includes(user.id)) throw forbidden('Nur die verantwortliche Person oder ein Admin übernimmt den Entwurf.');
  }
  const now = nowIso();
  q.run(`UPDATE drafts SET status = 'uebernommen', taken_at = ?, taken_by = ? WHERE id = ?`, now, user.id, d.id);
  const summary = `Entwurf #${d.id} „${d.subject || '(ohne Betreff)'}“ von ${user.name} übernommen; Versand durch einen Menschen außerhalb der App${recipients.length ? ` an ${recipients.length} Empfänger: ${recipients.join(', ')}` : ''}`;
  audit(user, { entity: d.task_id ? 'task' : 'draft', entityId: d.task_id || d.id, areaId: d.area_id, action: 'entwurf_uebernommen', summary, detail: { draft_id: d.id, recipients } });
  if (d.task_id) touch(d.task_id, { firstWork: true });
  return { ok: true };
});

post('/api/drafts/:id/discard', ({ user, params }) => {
  const d = loadDraft(user, int(params.id));
  if (d.status !== 'entwurf') throw bad('Dieser Entwurf ist nicht mehr offen.');
  q.run(`UPDATE drafts SET status = 'verworfen' WHERE id = ?`, d.id);
  audit(user, { entity: d.task_id ? 'task' : 'draft', entityId: d.task_id || d.id, areaId: d.area_id, action: 'entwurf_verworfen', summary: `Entwurf #${d.id} verworfen` });
  return { ok: true };
});

// ---------- Update-Fenster (ABL-5) ----------

get('/api/changelog', () => q.all('SELECT c.*, u.name AS created_by_name FROM changelog c LEFT JOIN users u ON u.id = c.created_by ORDER BY c.id DESC LIMIT 200'));

post('/api/changelog/seen', ({ user }) => {
  const max = q.get('SELECT MAX(id) AS m FROM changelog').m || 0;
  q.run('UPDATE users SET seen_changelog_id = ? WHERE id = ?', max, user.id);
  return { ok: true };
});
