// Fachlogik rund um Aufgaben: Anlegen (auch aus Vorgangsvorlagen), Statuswechsel,
// Liegezeit/Durchlaufzeit, Erfahrungswerte und Benachrichtigungen.

import { q, tx } from '../db.js';
import { assertDataClass } from '../guards.js';
import { audit, bad, dateOrNull, int, nowIso, oneOf, str, STATUS_LABEL } from '../util.js';

export const STATUSES = ['offen', 'in_arbeit', 'wartet', 'erledigt', 'verworfen'];
export const CHANNELS = ['manuell', 'mail', 'whatsapp', 'post', 'telefon', 'persoenlich', 'website', 'automatisierung', 'asana', 'jahreskalender'];
export const CHANNEL_LABEL = {
  manuell: 'Manuell', mail: 'E-Mail', whatsapp: 'WhatsApp', post: 'Post', telefon: 'Telefon', persoenlich: 'Persönlich',
  website: 'Website', automatisierung: 'Automatisierung', asana: 'Asana-Import', jahreskalender: 'Jahreskalender',
};

function userExists(id) {
  return id == null || !!q.get('SELECT 1 FROM users WHERE id = ? AND active = 1', id);
}

/** Prüft und normalisiert Felder einer Aufgabe (für Anlegen und Ändern). */
export function cleanTaskInput(b, { partial = false } = {}) {
  const out = {};
  const has = (k) => Object.hasOwn(b, k);
  if (!partial || has('title')) out.title = str(b.title, { max: 300, required: true, name: 'Titel' });
  if (!partial || has('description')) out.description = str(b.description, { max: 20_000 });
  if (!partial || has('area_id')) out.area_id = int(b.area_id, { min: 1, name: 'Bereich', nullable: false });
  if (has('office_id')) out.office_id = int(b.office_id, { min: 1, name: 'Amt' });
  if (has('owner_id')) out.owner_id = int(b.owner_id, { min: 1, name: 'Verantwortliche Person' });
  if (has('deputy_id')) out.deputy_id = int(b.deputy_id, { min: 1, name: 'Vertretung' });
  if (has('due_date')) out.due_date = dateOrNull(b.due_date, 'Fälligkeit');
  if (has('status')) out.status = oneOf(b.status, STATUSES, { name: 'Status' });
  if (has('waiting_who')) out.waiting_who = str(b.waiting_who, { max: 200 }) || null;
  if (has('waiting_what')) out.waiting_what = str(b.waiting_what, { max: 1000 }) || null;
  if (!partial || has('channel')) out.channel = oneOf(b.channel, CHANNELS, { name: 'Eingangskanal', fallback: 'manuell' });
  if (!partial || has('data_class')) out.data_class = assertDataClass(b.data_class || 'gruen');
  if (has('level')) out.level = int(b.level, { min: 0, max: 4, name: 'Automatisierungsstufe', nullable: false });
  if (has('lessons')) out.lessons = str(b.lessons, { max: 10_000 });
  if (has('priority')) out.priority = int(b.priority, { min: 0, max: 2, nullable: false });
  if (has('kind')) out.kind = oneOf(b.kind, ['aufgabe', 'idee'], { name: 'Art' });
  for (const k of ['owner_id', 'deputy_id']) {
    if (out[k] != null && !userExists(out[k])) throw bad('Die gewählte Person gibt es nicht oder sie ist gesperrt.');
  }
  if (out.owner_id && out.deputy_id && out.owner_id === out.deputy_id) throw bad('Vertretung und verantwortliche Person müssen verschieden sein.');
  if (out.status === 'wartet' && has('waiting_who') && !out.waiting_who) throw bad('Bei „Wartet auf Zulieferung“ bitte angeben, wer etwas schuldet (AUF-6).');
  return out;
}

/**
 * Legt eine Aufgabe an. Mit template_id werden die Teilschritte der gültigen Vorlagenversion
 * übernommen (AUF-3) und Hinweise aus dem Lernprotokoll angehängt (AUT-15).
 */
export function createTask(user, input, { source = null } = {}) {
  return tx(() => {
    const d = cleanTaskInput(input);
    const area = q.get('SELECT * FROM areas WHERE id = ?', d.area_id);
    if (!area) throw bad('Bereich nicht gefunden.');
    if (d.office_id) {
      const o = q.get('SELECT * FROM offices WHERE id = ?', d.office_id);
      if (!o || o.area_id !== d.area_id) throw bad('Das Amt gehört nicht zu diesem Bereich.');
      if (!d.owner_id && o.holder_id) d.owner_id = o.holder_id;
      if (!d.deputy_id && o.deputy_id && o.deputy_id !== d.owner_id) d.deputy_id = o.deputy_id;
    }
    let tpl = null;
    const templateId = int(input.template_id, { min: 1, name: 'Vorgangsvorlage' });
    if (templateId) {
      tpl = q.get('SELECT * FROM process_templates WHERE id = ? AND active = 1', templateId);
      if (!tpl) throw bad('Vorgangsvorlage nicht gefunden.');
      if (tpl.scope !== 'beide' && tpl.scope !== area.type) throw bad(`Die Vorlage „${tpl.name}“ ist für ${tpl.scope === 'verein' ? 'Vereine' : 'den Bezirk'} gedacht.`);
      if (d.data_class === 'gruen' && tpl.data_class === 'gelb') d.data_class = 'gelb';
      if (input.level === undefined) d.level = Math.min(tpl.max_level, 1);
    }
    if (d.level != null && tpl && d.level > tpl.max_level) throw bad(`Die Stufe darf die Höchststufe der Vorlage (${tpl.max_level}) nicht überschreiten (AUT-1).`);

    const now = nowIso();
    const r = q.run(`INSERT INTO tasks (kind, area_id, office_id, title, description, owner_id, deputy_id, due_date, status,
        waiting_who, waiting_what, channel, data_class, level, template_id, template_version, recurring_id, parent_source,
        lessons, priority, created_at, created_by, last_activity_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      d.kind || 'aufgabe', d.area_id, d.office_id ?? null, d.title, d.description, d.owner_id ?? null, d.deputy_id ?? null,
      d.due_date ?? null, d.status || 'offen', d.waiting_who ?? null, d.waiting_what ?? null, d.channel, d.data_class,
      d.level ?? 0, tpl?.id ?? null, tpl?.version ?? null, int(input.recurring_id) ?? null, source,
      d.lessons || '', d.priority ?? 0, input.created_at || now, user?.id ?? null, now);
    const id = Number(r.lastInsertRowid);

    if (tpl) {
      const steps = q.all('SELECT * FROM process_steps WHERE template_id = ? ORDER BY pos', tpl.id);
      steps.forEach((s, i) => q.run(`INSERT INTO task_steps (task_id, pos, title, description, manual, text_template_id, calc)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, id, i + 1, s.title, s.description, s.manual, s.text_template_id, s.calc));
    } else if (Array.isArray(input.steps)) {
      input.steps.slice(0, 100).forEach((s, i) => {
        const title = str(typeof s === 'string' ? s : s.title, { max: 300 });
        if (title) q.run('INSERT INTO task_steps (task_id, pos, title, done, done_at) VALUES (?, ?, ?, ?, ?)', id, i + 1, title, s.done ? 1 : 0, s.done ? now : null);
      });
    }

    audit(user, {
      entity: 'task', entityId: id, areaId: d.area_id, action: 'angelegt',
      summary: `Aufgabe „${d.title}“ angelegt${tpl ? ` aus Vorlage „${tpl.name}“ v${tpl.version}` : ''}${source ? ` (Herkunft: ${source})` : ''}`,
      detail: { ...d, template_id: tpl?.id ?? null },
    });
    if (d.owner_id && d.owner_id !== user?.id) {
      notify([d.owner_id], id, 'zugewiesen', `Neue Aufgabe für dich: „${d.title}“`);
    }
    return id;
  });
}

/** Markiert Bewegung an einer Aufgabe. firstWork = echte Bearbeitung (beendet die Liegezeit). */
export function touch(taskId, { firstWork = false } = {}) {
  const now = nowIso();
  if (firstWork) q.run('UPDATE tasks SET last_activity_at = ?, started_at = COALESCE(started_at, ?) WHERE id = ?', now, now, taskId);
  else q.run('UPDATE tasks SET last_activity_at = ? WHERE id = ?', now, taskId);
}

/** Ändert eine Aufgabe und protokolliert jede Feldänderung (AUF-13). */
export function updateTask(user, task, input) {
  return tx(() => {
    const d = cleanTaskInput(input, { partial: true });
    if (d.area_id && d.area_id !== task.area_id) {
      // Wechsel des Bereichs: Amt passt dann nicht mehr
      if (!Object.hasOwn(d, 'office_id')) d.office_id = null;
    }
    if (d.office_id) {
      const o = q.get('SELECT area_id FROM offices WHERE id = ?', d.office_id);
      if (!o || o.area_id !== (d.area_id || task.area_id)) throw bad('Das Amt gehört nicht zu diesem Bereich.');
    }
    if (d.level != null && task.template_id) {
      const tpl = q.get('SELECT max_level, name FROM process_templates WHERE id = ?', task.template_id);
      if (tpl && d.level > tpl.max_level) throw bad(`Die Stufe darf die Höchststufe der Vorlage „${tpl.name}“ (${tpl.max_level}) nicht überschreiten (AUT-1).`);
    }
    const newStatus = d.status ?? task.status;
    if (newStatus === 'wartet' && !(d.waiting_who ?? task.waiting_who)) throw bad('Bei „Wartet auf Zulieferung“ bitte angeben, wer etwas schuldet (AUF-6).');
    if (newStatus !== 'wartet' && d.status) { d.waiting_who = null; d.waiting_what = null; }

    const changes = {};
    for (const [k, v] of Object.entries(d)) if (task[k] !== v && !(task[k] == null && (v == null || v === ''))) changes[k] = { von: task[k], zu: v };
    if (!Object.keys(changes).length) return task.id;

    const now = nowIso();
    const sets = Object.keys(d).map(k => `${k} = ?`);
    const vals = Object.values(d);
    sets.push('last_activity_at = ?'); vals.push(now);
    if (changes.status) {
      if (['in_arbeit', 'wartet', 'erledigt'].includes(d.status)) { sets.push('started_at = COALESCE(started_at, ?)'); vals.push(now); }
      if (d.status === 'erledigt' || d.status === 'verworfen') { sets.push('completed_at = ?'); vals.push(now); }
      else { sets.push('completed_at = NULL'); }
    }
    q.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, ...vals, task.id);

    const parts = Object.entries(changes).map(([k, c]) => describeChange(k, c));
    audit(user, { entity: 'task', entityId: task.id, areaId: d.area_id || task.area_id, action: changes.status ? 'status' : 'geändert', summary: parts.join('; '), detail: changes });

    if (changes.owner_id && d.owner_id && d.owner_id !== user.id) notify([d.owner_id], task.id, 'zugewiesen', `Dir wurde „${task.title}“ zugewiesen.`);
    if (changes.status) onStatusChange(user, { ...task, ...d }, task.status, d.status);
    return task.id;
  });
}

function describeChange(k, c) {
  const names = { title: 'Titel', description: 'Beschreibung', area_id: 'Bereich', office_id: 'Amt', owner_id: 'Verantwortlich', deputy_id: 'Vertretung',
    due_date: 'Fälligkeit', status: 'Status', waiting_who: 'Wartet auf', waiting_what: 'Was fehlt', channel: 'Eingangskanal',
    data_class: 'Datenklasse', level: 'Automatisierungsstufe', lessons: 'Erfahrungen', priority: 'Priorität', kind: 'Art' };
  const fmt = (v) => {
    if (v == null || v === '') return '—';
    if (k === 'status') return STATUS_LABEL[v] || v;
    if (k === 'owner_id' || k === 'deputy_id') return q.get('SELECT name FROM users WHERE id = ?', v)?.name || v;
    if (k === 'area_id') return q.get('SELECT name FROM areas WHERE id = ?', v)?.name || v;
    if (k === 'office_id') return q.get('SELECT name FROM offices WHERE id = ?', v)?.name || v;
    if (k === 'description' || k === 'lessons') return '(Text geändert)';
    return String(v);
  };
  if (k === 'description' || k === 'lessons') return `${names[k]} geändert`;
  return `${names[k] || k}: ${fmt(c.von)} → ${fmt(c.zu)}`;
}

// Hook für Regeln mit Auslöser „Statuswechsel“ (wird von automation.js gesetzt)
let statusHook = null;
export function setStatusHook(fn) { statusHook = fn; }
function onStatusChange(user, task, from, to) {
  if (statusHook) statusHook(user, task, from, to);
}

/** Legt Benachrichtigungen an (In-App-Erinnerungen, AUF-7). */
export function notify(userIds, taskId, type, message) {
  const now = nowIso();
  for (const uid of new Set(userIds.filter(Boolean))) {
    q.run('INSERT INTO notifications (user_id, task_id, type, message, created_at) VALUES (?, ?, ?, ?, ?)', uid, taskId, type, message, now);
  }
}

/** Erfahrungswerte aus dem letzten abgeschlossenen Durchlauf (AUF-5). */
export function experienceFor(task) {
  let prev = null;
  if (task.recurring_id) {
    prev = q.get(`SELECT * FROM tasks WHERE recurring_id = ? AND id <> ? AND status = 'erledigt' ORDER BY completed_at DESC LIMIT 1`, task.recurring_id, task.id);
  }
  if (!prev && task.template_id) {
    prev = q.get(`SELECT * FROM tasks WHERE template_id = ? AND area_id = ? AND id <> ? AND status = 'erledigt' ORDER BY completed_at DESC LIMIT 1`, task.template_id, task.area_id, task.id);
  }
  if (!prev) return null;
  const minutes = q.get('SELECT COALESCE(SUM(minutes),0) AS m FROM time_entries WHERE task_id = ?', prev.id).m;
  const days = prev.completed_at ? Math.round((Date.parse(prev.completed_at) - Date.parse(prev.created_at)) / 86_400_000 * 10) / 10 : null;
  return { task_id: prev.id, title: prev.title, completed_at: prev.completed_at, minutes, days, lessons: prev.lessons };
}

/** Lernprotokoll-Einträge, die für eine Aufgabe gelten (AUT-15). */
export function learningsFor(task) {
  return q.all(`SELECT * FROM learnings WHERE active = 1 AND (template_id = ? OR (template_id IS NULL AND area_id = ?))
                ORDER BY date DESC`, task.template_id ?? -1, task.area_id);
}
