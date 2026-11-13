// Automatisierungen (Kapitel 6 des Lastenhefts).
//
// Grundsätze:
//  - Jede Regel hat eine Stufe (0–4) und darf die Höchststufe ihres Vorgangstyps nie überschreiten (AUT-1).
//  - Eine Regel läuft erst, wenn ein Admin sie freigegeben hat (ROL-3).
//  - Alles, was die App verlässt (Stufe 3, z. B. Kalendereintrag), braucht vor JEDER Ausführung
//    ein ausdrückliches Ja eines Admins; Person und Zeitpunkt werden protokolliert (AUT-6, ABN-6).
//  - Nachrichten an viele Empfänger brauchen eine eigene Bestätigung mit Empfängerliste (AUT-7).
//  - Zahlungen, Lastschriften, Bankvorgänge und Bestellungen sind gesperrt (AUT-8, guards.js).
//  - Mails entstehen nur als Entwurf; den Versand löst ein Mensch aus (AUT-14).
//  - Vorgänge mit gelben Daten laufen nicht automatisch, solange die Datenschutzfrage offen ist (Kap. 9).

import { q, tx, getSetting } from '../db.js';
import { ALLOWED_ACTIONS, assertActionAllowed, BlockedError, scrubPersonalData } from '../guards.js';
import { renderDraft } from '../templating.js';
import { addDays, audit, bad, berlinClock, forbidden, nowIso, parseJson, today, formatDateDe, STATUS_LABEL, LEVEL_LABEL } from '../util.js';
import { createTask, notify, setStatusHook } from './tasks.js';
import { isOn, param } from './catalog.js';
import * as m365 from '../connectors/m365.js';

export const TRIGGERS = {
  zeitplan: 'Zeitplan',
  frist: 'Frist',
  eingang: 'Eingang',
  statuswechsel: 'Statuswechsel',
  manuell: 'Nur auf Zuruf',
};

/** Ab dieser Empfängerzahl ist eine eigene Bestätigung nötig (AUT-7). */
export const MANY_RECIPIENTS = 5;

// ---------- Regeln prüfen ----------

export function validateRule(r) {
  if (!TRIGGERS[r.trigger_type]) throw bad('Unbekannter Auslöser.');
  const action = assertActionAllowed(r.action_type, r.action_config);
  if (action.ruleable === false) throw bad(`„${action.label}“ lässt sich nicht als Regel anlegen, sondern nur über die Schaltflächen bzw. den Automatisierungskatalog.`);
  if (r.level < action.minLevel) {
    throw bad(`Die Aktion „${action.label}“ braucht mindestens Stufe ${action.minLevel} (${LEVEL_LABEL[action.minLevel]}).`);
  }
  if (r.trigger_type === 'zeitplan' && r.level < 4 && r.action_type !== 'kalendereintrag') {
    // Regelmäßig ohne Anstoß zu arbeiten ist Stufe 4 (Stufenmodell Kap. 8)
    throw bad('Ein Zeitplan ohne Anstoß entspricht Stufe 4 „Selbstständig nach Plan“. Bitte Stufe 4 wählen oder den Auslöser „Nur auf Zuruf“ nehmen.');
  }
  if (r.template_id) {
    const tpl = q.get('SELECT * FROM process_templates WHERE id = ?', r.template_id);
    if (!tpl) throw bad('Vorgangstyp nicht gefunden.');
    if (r.level > tpl.max_level) {
      throw bad(`Stufe ${r.level} überschreitet die Höchststufe ${tpl.max_level} des Vorgangstyps „${tpl.name}“ (AUT-1).`);
    }
    if (tpl.never_execute && action.external) {
      throw bad(`„${tpl.name}“ ist als „nie ausführen“ eingestuft. Erlaubt sind nur Entwürfe und Vorbereitung.`);
    }
  }
  const cfg = r.trigger_config || {};
  if (r.trigger_type === 'zeitplan') {
    if (!['taeglich', 'woechentlich', 'monatlich'].includes(cfg.rhythmus)) throw bad('Bitte einen Rhythmus wählen.');
    if (cfg.stunde == null || cfg.stunde < 0 || cfg.stunde > 23) throw bad('Bitte eine Uhrzeit (Stunde) angeben.');
  }
  if (r.trigger_type === 'frist' && !(Number(cfg.tage_vorher) >= 0)) throw bad('Bitte angeben, wie viele Tage vor der Frist die Regel greift.');
  const ac = r.action_config || {};
  if (r.action_type === 'entwurf_erzeugen' && !ac.text_template_id) throw bad('Bitte eine Textvorlage wählen.');
  if (r.action_type === 'aufgabe_anlegen' && !ac.title && !ac.template_id) throw bad('Bitte einen Titel oder eine Vorgangsvorlage angeben.');
  if (r.action_type === 'kalendereintrag' && !ac.title) throw bad('Bitte einen Titel für den Kalendereintrag angeben.');
  return action;
}

function yellowBlocked(rule) {
  if (getSetting('datenschutz_gelb_freigegeben', false)) return false;
  if (rule.template_id) {
    const tpl = q.get('SELECT data_class FROM process_templates WHERE id = ?', rule.template_id);
    if (tpl?.data_class === 'gelb') return true;
  }
  return false;
}

// ---------- Ausführen ----------

/**
 * Führt eine Regel aus. trigger beschreibt den Anlass (z. B. "auf Zuruf", "Zeitplan", "Frist: Aufgabe 12").
 * context kann { task } enthalten, wenn die Regel sich auf eine Aufgabe bezieht.
 */
export function runRule(rule, { user = null, trigger = 'auf Zuruf', context = {} } = {}) {
  const started = nowIso();
  const log = (outcome, detail) => {
    q.run('INSERT INTO rule_runs (rule_id, started_at, trigger, outcome, detail, started_by) VALUES (?, ?, ?, ?, ?, ?)',
      rule.id, started, trigger, outcome, detail, user?.id ?? null);
    q.run('UPDATE rules SET last_run_at = ? WHERE id = ?', started, rule.id);
    audit(user, { entity: 'rule', entityId: rule.id, areaId: rule.area_id, action: `lauf:${outcome}`, summary: `Regel „${rule.name}“ (${trigger}): ${detail}` });
    return { outcome, detail };
  };

  try {
    if (!rule.approved) return log('gesperrt', 'Die Regel ist noch nicht von einem Admin freigegeben.');
    if (yellowBlocked(rule)) return log('gesperrt', 'Vorgang mit gelben Daten: Automatisierung wartet auf die Antwort zur Datenschutzfrage (Einstellungen).');
    const ac = parseJson(rule.action_config, {});
    validateRule({ ...rule, trigger_config: parseJson(rule.trigger_config, {}), action_config: ac });
    const action = ALLOWED_ACTIONS[rule.action_type];

    // Stufe 3: nie direkt ausführen, sondern Freigabe anfragen (AUT-6)
    if (action.external) {
      const payload = buildExternalPayload(rule, ac, context);
      const id = requestApproval({ rule, actionType: rule.action_type, payload, summary: payload.summary, recipients: [], taskId: context.task?.id ?? null, user });
      return log('freigabe_angefragt', `Freigabe #${id} angefragt: ${payload.summary}`);
    }

    const result = tx(() => executeInternal(rule, ac, context, user));
    return log(result.nothing ? 'nichts_zu_tun' : 'ok', result.detail);
  } catch (err) {
    if (err instanceof BlockedError) return log('gesperrt', err.message);
    return log('fehler', err.message);
  }
}

function areaOf(rule, context) {
  return context.task?.area_id || rule.area_id || ac_area(rule);
}
function ac_area(rule) {
  return parseJson(rule.action_config, {}).area_id || null;
}

function executeInternal(rule, ac, context, user) {
  const areaId = areaOf(rule, context);
  switch (rule.action_type) {
    case 'aufgabe_anlegen': {
      if (!areaId) throw bad('Die Regel hat keinen Bereich.');
      const due = ac.faellig_in_tagen != null ? addDays(today(), Number(ac.faellig_in_tagen)) : null;
      const title = scrubPersonalData(fillPlaceholders(ac.title || '', context)).text
        || q.get('SELECT name FROM process_templates WHERE id = ?', ac.template_id)?.name;
      const id = createTask(user, {
        area_id: areaId, title, description: scrubPersonalData(fillPlaceholders(ac.description || '', context)).text,
        office_id: ac.office_id || null, owner_id: ac.owner_id || null, due_date: due, template_id: ac.template_id || null,
        channel: 'automatisierung', level: Math.min(rule.level, 2), data_class: 'gruen',
      }, { source: `regel:${rule.id}` });
      return { detail: `Aufgabe #${id} „${title}“ angelegt` };
    }
    case 'entwurf_erzeugen': {
      const tpl = q.get('SELECT * FROM text_templates WHERE id = ? AND active = 1', ac.text_template_id);
      if (!tpl) throw bad('Die Textvorlage gibt es nicht mehr.');
      const task = context.task || null;
      const area = q.get('SELECT * FROM areas WHERE id = ?', task?.area_id || areaId);
      if (!area) throw bad('Die Regel hat keinen Bereich.');
      const out = renderDraft(tpl, ac.values || {}, { areaName: area.name, areaType: area.type, taskTitle: task?.title, dueDate: task?.due_date, userName: '' });
      const r = q.run(`INSERT INTO drafts (task_id, area_id, template_id, template_version, kind, subject, body, recipients, warnings, created_by, created_by_rule, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, NULL, ?, ?)`,
        task?.id ?? null, area.id, tpl.id, tpl.version, tpl.kind, out.subject, out.body, JSON.stringify(out.warnings), rule.id, nowIso());
      const owner = task?.owner_id;
      if (owner) notify([owner], task.id, 'entwurf', `Entwurf „${out.subject || tpl.name}“ liegt bereit.`);
      return { detail: `Entwurf #${r.lastInsertRowid} aus „${tpl.name}“ erzeugt` };
    }
    case 'erinnern': {
      const task = context.task;
      const msg = ac.message ? fillPlaceholders(ac.message, context) : (task ? `Erinnerung: „${task.title}“${task.due_date ? ` ist am ${formatDateDe(task.due_date)} fällig` : ''}.` : rule.name);
      let targets = [];
      if (task) targets = [task.owner_id, ac.auch_vertretung ? task.deputy_id : null];
      else if (ac.user_ids?.length) targets = ac.user_ids;
      else targets = q.all(`SELECT id FROM users WHERE active = 1 AND role = 'admin'`).map(u => u.id);
      targets = targets.filter(Boolean);
      if (!targets.length) return { nothing: true, detail: 'Niemand zu erinnern (keine verantwortliche Person).' };
      notify(targets, task?.id ?? null, 'erinnerung', scrubPersonalData(msg).text);
      return { detail: `${targets.length} Erinnerung(en) angelegt` };
    }
    case 'uebersicht': {
      const report = buildOverview(areaId ? [areaId] : null, rule.name);
      const r = q.run('INSERT INTO reports (type, title, content, rule_id, created_at) VALUES (?, ?, ?, ?, ?)',
        'uebersicht', report.title, JSON.stringify(report), rule.id, nowIso());
      const admins = q.all(`SELECT id FROM users WHERE active = 1 AND role = 'admin'`).map(u => u.id);
      notify(admins, null, 'bericht', `${report.title} liegt bereit: ${report.totals.offen} offen, ${report.totals.ueberfaellig} überfällig.`);
      return { detail: `Übersicht #${r.lastInsertRowid} erstellt` };
    }
    default:
      throw new BlockedError(`Aktion „${rule.action_type}“ ist nicht ausführbar.`);
  }
}

function fillPlaceholders(text, context) {
  const t = context.task;
  return String(text)
    .replace(/\{\{\s*aufgabe\s*\}\}/g, t?.title || '')
    .replace(/\{\{\s*frist\s*\}\}/g, t?.due_date ? formatDateDe(t.due_date) : '')
    .replace(/\{\{\s*heute\s*\}\}/g, formatDateDe(today()));
}

function buildExternalPayload(rule, ac, context) {
  if (rule.action_type === 'kalendereintrag') {
    const date = ac.datum || context.task?.due_date || addDays(today(), Number(ac.in_tagen || 0));
    const areaId = areaOf(rule, context);
    const title = scrubPersonalData(fillPlaceholders(ac.title, context)).text;
    return { kind: 'kalendereintrag', area_id: areaId, title, date, time: ac.uhrzeit || null, location: ac.ort || '', notes: ac.notiz || '',
      summary: `Kalendereintrag „${title}“ am ${formatDateDe(date)}${ac.uhrzeit ? ' um ' + ac.uhrzeit : ''} anlegen` };
  }
  throw new BlockedError('Unbekannte Ausführung.');
}

// ---------- Freigaben ----------

export function requestApproval({ rule = null, actionType, payload, summary, recipients = [], taskId = null, user = null, areaId = null }) {
  assertActionAllowed(actionType, payload);
  const r = q.run(`INSERT INTO approvals (rule_id, task_id, area_id, action_type, payload, summary, recipients, requested_at, requested_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    rule?.id ?? null, taskId, payload.area_id ?? areaId, actionType, JSON.stringify(payload), summary, JSON.stringify(recipients), nowIso(), user?.id ?? null);
  const id = Number(r.lastInsertRowid);
  audit(user, { entity: 'approval', entityId: id, areaId: payload.area_id ?? areaId, action: 'angefragt', summary: `Freigabe angefragt: ${summary}` });
  const admins = q.all(`SELECT id FROM users WHERE active = 1 AND role = 'admin'`).map(u => u.id);
  notify(admins, taskId, 'freigabe', `Freigabe nötig: ${summary}`);
  return id;
}

/**
 * Entscheidet über eine Freigabe. Nur Admins (ROL-3). Bei vielen Empfängern muss die
 * Empfängerliste ausdrücklich bestätigt werden (AUT-7). Die Ausführung kann Microsoft 365
 * aufrufen und läuft daher asynchron; das Ergebnis (oder der Fehler) steht im Protokoll.
 */
export async function decideApproval(user, approvalId, { approve, note = '', confirmRecipients = false }) {
  if (user.role !== 'admin') throw forbidden('Nur Admins geben Ausführungen frei (ROL-3).');
  const decided = tx(() => {
    const a = q.get('SELECT * FROM approvals WHERE id = ?', approvalId);
    if (!a) throw bad('Freigabe nicht gefunden.');
    if (a.status !== 'offen') throw bad('Über diese Freigabe wurde bereits entschieden.');
    const recipients = parseJson(a.recipients, []);
    const now = nowIso();
    if (!approve) {
      q.run(`UPDATE approvals SET status = 'abgelehnt', decided_at = ?, decided_by = ?, decision_note = ? WHERE id = ?`, now, user.id, note, a.id);
      audit(user, { entity: 'approval', entityId: a.id, areaId: a.area_id, action: 'abgelehnt', summary: `Abgelehnt: ${a.summary}${note ? ` – ${note}` : ''}` });
      return { a, status: 'abgelehnt' };
    }
    if (recipients.length >= MANY_RECIPIENTS && !confirmRecipients) {
      throw bad(`Diese Nachricht geht an ${recipients.length} Empfänger. Bitte die Empfängerliste ausdrücklich bestätigen (AUT-7).`, { needsRecipientConfirmation: true, recipients });
    }
    const payload = parseJson(a.payload, {});
    assertActionAllowed(a.action_type, payload); // erneut prüfen: zwischen Anfrage und Freigabe kann sich die Sperrliste geändert haben
    q.run(`UPDATE approvals SET status = 'freigegeben', decided_at = ?, decided_by = ?, decision_note = ? WHERE id = ?`, now, user.id, note, a.id);
    audit(user, { entity: 'approval', entityId: a.id, areaId: a.area_id, action: 'freigegeben',
      summary: `Freigegeben von ${user.name} am ${formatDateDe(now.slice(0, 10))} um ${new Date(now).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })}: ${a.summary}`,
      detail: { recipients_confirmed: recipients.length >= MANY_RECIPIENTS ? recipients : undefined } });
    return { a, payload, status: 'freigegeben' };
  });
  if (decided.status === 'abgelehnt') return { status: 'abgelehnt' };
  const { a, payload } = decided;
  try {
    const result = await executeApproved(user, a, payload);
    q.run(`UPDATE approvals SET status = 'ausgefuehrt', result = ? WHERE id = ?`, result, a.id);
    audit(user, { entity: 'approval', entityId: a.id, areaId: a.area_id, action: 'ausgefuehrt', summary: `Ausgeführt: ${result}` });
    return { status: 'ausgefuehrt', result };
  } catch (err) {
    q.run(`UPDATE approvals SET status = 'fehler', result = ? WHERE id = ?`, err.message, a.id);
    audit(user, { entity: 'approval', entityId: a.id, areaId: a.area_id, action: 'fehler', summary: `Ausführung fehlgeschlagen: ${a.summary} – ${err.message}` });
    return { status: 'fehler', result: err.message };
  }
}

async function executeApproved(user, a, payload) {
  switch (a.action_type) {
    case 'kalendereintrag': {
      const r = q.run(`INSERT INTO events (area_id, task_id, title, date, time, location, notes, in_feed, approval_id, created_by, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        payload.area_id, a.task_id, payload.title, payload.date, payload.time, payload.location || '', payload.notes || '', a.id, user.id, nowIso());
      const id = Number(r.lastInsertRowid);
      let extra = '';
      // Zusätzlich im Outlook-Kalender, wenn eingeschaltet – die Freigabe deckt beides ab (steht in der Zusammenfassung)
      if (payload.outlook && isOn('m365_kalender')) {
        const mb = m365.m365Settings().kalender_postfach || m365.mailboxForArea(payload.area_id);
        const ev = await m365.createEvent(mb, payload);
        q.run('UPDATE events SET remote_id = ? WHERE id = ?', ev.id, id);
        extra = ` und im Outlook-Kalender von ${mb}`;
      }
      return `Termin #${id} „${payload.title}“ am ${formatDateDe(payload.date)} im Kalender-Abo${extra} eingetragen`;
    }
    case 'm365_kalender': {
      const e = q.get('SELECT * FROM events WHERE id = ?', payload.event_id);
      if (!e) throw bad('Der Termin existiert nicht mehr.');
      const mb = m365.m365Settings().kalender_postfach || m365.mailboxForArea(e.area_id);
      if (!mb) throw bad('Kein Kalender-Postfach eingestellt.');
      const ev = await m365.createEvent(mb, e);
      q.run('UPDATE events SET remote_id = ? WHERE id = ?', ev.id, e.id);
      return `Termin „${e.title}“ am ${formatDateDe(e.date)} im Outlook-Kalender von ${mb} eingetragen`;
    }
    case 'postfach_entwurf': {
      const d = q.get('SELECT * FROM drafts WHERE id = ?', payload.draft_id);
      if (!d) throw bad('Der Entwurf existiert nicht mehr.');
      if (d.status !== 'entwurf') throw bad('Der Entwurf ist nicht mehr offen.');
      const mb = payload.mailbox || m365.mailboxForArea(d.area_id);
      if (!mb) throw bad('Kein Postfach für diesen Bereich verbunden.');
      // Erneut prüfen, was tatsächlich hinausgeht (AUT-8, AUT-9)
      assertActionAllowed('postfach_entwurf', { subject: d.subject, body: d.body });
      const subject = d.task_id && param('antworten_zuordnen', 'nummer_im_betreff') && !/\[#\d+\]/.test(d.subject) ? `${d.subject} [#${d.task_id}]` : d.subject;
      const recipients = parseJson(d.recipients, []);
      const body = recipients.length ? `${d.body}\n\n— Empfänger laut App (Adressen in Outlook ergänzen): ${recipients.join(', ')} —` : d.body;
      const r = await m365.createDraft(mb, { subject, body });
      q.run(`UPDATE drafts SET remote_id = ?, conversation_id = ?, mailbox = ?, subject = ?, status = 'uebernommen', taken_at = ?, taken_by = ? WHERE id = ?`,
        r.id, r.conversation_id, mb, subject, nowIso(), user.id, d.id);
      if (d.task_id) audit(user, { entity: 'task', entityId: d.task_id, areaId: d.area_id, action: 'entwurf_postfach', summary: `Entwurf „${subject}“ im Postfach ${mb} abgelegt – Versand durch einen Menschen in Outlook` });
      return `Entwurf „${subject}“ im Postfach ${mb} abgelegt (nicht versendet)`;
    }
    case 'ablage_hochladen': {
      const f = q.get('SELECT * FROM files WHERE id = ? AND deleted_at IS NULL', payload.file_id);
      if (!f) throw bad('Die Datei existiert nicht mehr.');
      const { readStoredFile } = await import('./files.js');
      const folder = (m365.m365Settings().ablage_ordner || '').replace(/^\/+|\/+$/g, '');
      const rel = [folder, payload.path].filter(Boolean).join('/');
      const up = await m365.uploadFile(rel, readStoredFile(f));
      q.run('UPDATE files SET remote_url = ?, remote_synced_at = ? WHERE id = ?', up.webUrl || rel, nowIso(), f.id);
      return `Datei „${f.filename}“ nach ${rel} kopiert`;
    }
    default:
      throw new BlockedError('Unbekannte Ausführung.');
  }
}

// ---------- Übersicht (AUT-13) ----------

export function buildOverview(areaIds = null, title = 'Wöchentliche Übersicht') {
  const where = areaIds?.length ? `AND t.area_id IN (${areaIds.map(() => '?').join(',')})` : '';
  const params = areaIds?.length ? areaIds : [];
  const d = today();
  const open = q.all(`SELECT t.id, t.title, t.status, t.due_date, t.waiting_who, t.last_activity_at, t.created_at, a.name AS area, u.name AS owner
                      FROM tasks t JOIN areas a ON a.id = t.area_id LEFT JOIN users u ON u.id = t.owner_id
                      WHERE t.kind = 'aufgabe' AND t.status IN ('offen','in_arbeit','wartet') ${where}
                      ORDER BY t.due_date IS NULL, t.due_date`, ...params);
  const staleDays = getSetting('liegezeit_warnung_tage', 7);
  const overdue = open.filter(t => t.due_date && t.due_date < d);
  const soon = open.filter(t => t.due_date && t.due_date >= d && t.due_date <= addDays(d, 7));
  const waiting = open.filter(t => t.status === 'wartet');
  const stale = open.filter(t => (Date.now() - Date.parse(t.last_activity_at)) / 86_400_000 > staleDays);
  const inbox = q.get(`SELECT COUNT(*) AS n FROM inbox WHERE status = 'neu'`).n;
  const approvals = q.get(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'offen'`).n;
  const pick = (t) => ({ id: t.id, title: t.title, area: t.area, owner: t.owner, due_date: t.due_date, status: STATUS_LABEL[t.status], waiting_who: t.waiting_who });
  return {
    title: `${title} vom ${formatDateDe(d)}`,
    created: nowIso(),
    totals: { offen: open.length, ueberfaellig: overdue.length, diese_woche: soon.length, wartet: waiting.length, liegt_lange: stale.length, eingang: inbox, freigaben: approvals },
    sections: [
      { title: 'Überfällig', items: overdue.map(pick) },
      { title: 'In den nächsten 7 Tagen fällig', items: soon.map(pick) },
      { title: 'Wartet auf Zulieferung', items: waiting.map(pick) },
      { title: `Ohne Bewegung seit über ${staleDays} Tagen`, items: stale.map(pick) },
    ],
  };
}

// ---------- Auslöser ----------

/** Zeitplan-Regeln: prüft minütlich, ob eine Regel jetzt fällig ist. */
const berlinStamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
/** Zeitpunkt als „JJJJ-MM-TT HH“ in Berliner Zeit – vergleichbar als Text. */
const stamp = (d) => berlinStamp.format(d);

/**
 * Letzter planmäßiger Zeitpunkt einer Zeitplan-Regel vor oder gleich „now“, als „JJJJ-MM-TT HH“.
 * Täglich: heute bzw. gestern zur Stunde; wöchentlich: letzter passender Wochentag; monatlich: letzter passender Tag.
 */
export function lastDueSlot(c, now = new Date()) {
  const { hour, weekday } = berlinClock(now);
  const day = today(now);
  const h = Math.min(23, Math.max(0, Number(c.stunde ?? 7)));
  const hh = String(h).padStart(2, '0');
  if (c.rhythmus === 'woechentlich') {
    const wd = Number(c.wochentag || 1);
    let back = (weekday - wd + 7) % 7;
    if (back === 0 && hour < h) back = 7;
    return `${addDays(day, -back)} ${hh}`;
  }
  if (c.rhythmus === 'monatlich') {
    const tag = Math.min(28, Math.max(1, Number(c.tag || 1)));
    let [y, m] = day.split('-').map(Number);
    let cand = `${y}-${String(m).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
    if (cand > day || (cand === day && hour < h)) { m -= 1; if (m === 0) { m = 12; y -= 1; } cand = `${y}-${String(m).padStart(2, '0')}-${String(tag).padStart(2, '0')}`; }
    return `${cand} ${hh}`;
  }
  return `${hour < h ? addDays(day, -1) : day} ${hh}`;
}

/**
 * Zeitplan-Regeln: laufen zum planmäßigen Zeitpunkt – oder beim nächsten Takt, wenn der Server zu dieser
 * Zeit aus war (höchstens 3 Tage rückwirkend, nie für Zeitpunkte vor der Freigabe).
 */
export function runScheduledRules(now = new Date()) {
  const rules = q.all(`SELECT * FROM rules WHERE active = 1 AND approved = 1 AND trigger_type = 'zeitplan'`);
  const limit = stamp(new Date(now.getTime() - 3 * 86_400_000));
  for (const r of rules) {
    const c = parseJson(r.trigger_config, {});
    const due = lastDueSlot(c, now);
    if (due < limit) continue;                                              // zu lange her – auf den nächsten Termin warten
    if (r.approved_at && stamp(new Date(r.approved_at)) > due) continue;   // Termin lag vor der Freigabe
    if (r.last_run_at && stamp(new Date(r.last_run_at)) >= due) continue;   // für diesen Termin schon gelaufen
    const late = stamp(now) > due;
    runRule(r, { trigger: `Zeitplan (${c.rhythmus})${late ? ` – nachgeholt für ${due.slice(8, 10)}.${due.slice(5, 7)}. ${due.slice(11)} Uhr` : ''}` });
  }
}

/** Frist-Regeln: X Tage vor Fälligkeit passender Aufgaben (je Aufgabe und Frist genau einmal). */
export function runDeadlineRules(now = new Date()) {
  const day = today(now);
  const rules = q.all(`SELECT * FROM rules WHERE active = 1 AND approved = 1 AND trigger_type = 'frist'`);
  for (const r of rules) {
    const c = parseJson(r.trigger_config, {});
    const target = addDays(day, Number(c.tage_vorher || 0));
    const params = [day, target];
    // Alles, was bis zu X Tage vor der Frist liegt – so werden auch Tage nachgeholt, an denen der Server aus war
    let sql = `SELECT * FROM tasks WHERE kind = 'aufgabe' AND status IN ('offen','in_arbeit','wartet') AND due_date >= ? AND due_date <= ?`;
    if (r.area_id) { sql += ' AND area_id = ?'; params.push(r.area_id); }
    if (r.template_id) { sql += ' AND template_id = ?'; params.push(r.template_id); }
    for (const t of q.all(sql, ...params)) {
      const key = `Frist: Aufgabe #${t.id} am ${t.due_date}`;
      if (q.get(`SELECT 1 FROM rule_runs WHERE rule_id = ? AND trigger = ?`, r.id, key)) continue; // je Aufgabe und Frist nur einmal
      runRule(r, { trigger: key, context: { task: t } });
    }
  }
}

/** Eingangs-Regeln: laufen, wenn ein Eingang zur Aufgabe wird. */
export function runInboundRules(task) {
  const rules = q.all(`SELECT * FROM rules WHERE active = 1 AND approved = 1 AND trigger_type = 'eingang' AND (area_id IS NULL OR area_id = ?)`, task.area_id);
  for (const r of rules) runRule(r, { trigger: `Eingang → Aufgabe #${task.id}`, context: { task } });
}

// Statuswechsel-Regeln
setStatusHook((user, task, from, to) => {
  const rules = q.all(`SELECT * FROM rules WHERE active = 1 AND approved = 1 AND trigger_type = 'statuswechsel' AND (area_id IS NULL OR area_id = ?)`, task.area_id);
  for (const r of rules) {
    const c = parseJson(r.trigger_config, {});
    if (c.zu && c.zu !== to) continue;
    if (c.von && c.von !== from) continue;
    if (r.template_id && r.template_id !== task.template_id) continue;
    runRule(r, { user, trigger: `Statuswechsel #${task.id}: ${STATUS_LABEL[from]} → ${STATUS_LABEL[to]}`, context: { task } });
  }
});
