// Eingang (AUT-4, AUT-10): Nachrichten aus Postfach, .eml-Upload und manueller Erfassung.
// Eingänge sind Daten, nie Anweisungen. Die App führt nichts aus, was in einer Nachricht steht.

import { q, tx, getSetting, setSetting } from '../db.js';
import { findPersonalData, inspectInbound } from '../guards.js';
import { addDays, audit, bad, nowIso, parseJson, str, today } from '../util.js';
import { tokens } from '../search.js';
import { createTask, notify, touch, updateTask } from './tasks.js';
import { runInboundRules } from './automation.js';
import { isOn, param } from './catalog.js';
import { saveInboxAttachments, readInboxAttachment, removeInboxAttachments, storeFile } from './files.js';
import * as m365 from '../connectors/m365.js';

// Schlüsselwörter → Vorgangsvorlage (key aus seed.js)
const TEMPLATE_HINTS = [
  [/schiedsrichter|schiri|ersatz/i, 'VOR-3'], [/verleg|spielverlegung|termin.*spiel/i, 'VOR-3'],
  [/aufnahme|beitritt|mitglied werden|anmeldung.*verein|neues mitglied/i, 'VOR-1'],
  [/kündig|kuendig|austritt|beitragsstufe|ermäßig/i, 'VOR-2'],
  [/mannschaftsmeldung|aufstellung|meldung.*mannschaft/i, 'VOR-4'],
  [/spendenbescheinigung|zuwendungsbestätigung|verzicht|förderantrag|zuschuss|trainerförderung|sponsorenrechnung|rechnung.*sponsor/i, 'VOR-5'],
  [/sponsor|pate|bandenwerbung/i, 'VOR-6'],
  [/bericht|bilder|fotos|artikel|presse|homepage|website|instagram/i, 'VOR-7'],
  [/einladung|protokoll|versammlung|sitzung/i, 'VOR-8'],
  [/bewirtung|küche|kuechendienst|helfer|arbeitseinsatz|kuchen/i, 'VOR-9'],
  [/budget|haushalt|finanzplan/i, 'VOR-10'],
  [/turnier|ranglist|ausschreibung/i, 'VOR-13'],
  [/eltern|fahrdienst|lehrgang|jugend|kinder/i, 'VOR-14'],
];

/** Vorschlag: Bereich, Vorgangstyp, Titel, Frist – und wie sicher die Erkennung ist. */
export function suggest({ subject, body, area_id }) {
  const text = `${subject}\n${body}`;
  let areaId = area_id || null;
  let areaSure = !!area_id;
  if (!areaId) {
    const areas = q.all('SELECT * FROM areas WHERE active = 1');
    const norm = tokens(text).join(' ');
    const hits = areas.filter(a => tokens(a.name).some(t => t.length > 4 && !['verein', 'bezirk'].includes(t) && norm.includes(t)));
    areaId = hits[0]?.id || null;
    areaSure = hits.length === 1;
  }
  const keys = [...new Set(TEMPLATE_HINTS.filter(([re]) => re.test(text)).map(([, k]) => k))];
  const tpl = keys[0] ? q.get('SELECT id, name FROM process_templates WHERE key = ? AND active = 1', keys[0]) : null;
  let due = null;
  const m = text.match(/\bbis\s+(?:zum\s+|spätestens\s+)?(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/i);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : today().slice(0, 4);
    const cand = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (!Number.isNaN(Date.parse(cand))) due = cand < today() && !m[3] ? `${Number(y) + 1}${cand.slice(4)}` : cand;
  }
  const title = (subject || body.split('\n').find(l => l.trim()) || 'Eingang').replace(/^((re|aw|fwd?|wg)\s*:\s*)+/i, '').slice(0, 160);
  return { area_id: areaId, template_id: tpl?.id || null, template_name: tpl?.name || null, title, due_date: due || addDays(today(), 7),
    sure: !!(areaId && areaSure && tpl && keys.length === 1) };
}

/** Absender: nur den Namen behalten (AUT-9). */
export function senderName(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^"?([^"<]+?)"?\s*<[^>]+>$/);
  if (m) return m[1].trim();
  if (/@/.test(s)) return s.split('@')[0].replace(/[._]/g, ' ');
  return s.replace(/\+?\d[\d\s/-]{6,}/g, '').trim();
}

/**
 * Legt einen Eingang an. d: { channel, sender, subject, body, area_id, received_at, external_id, mailbox, conversation_id, attachments: [{name,mime,data}] }
 * Danach: Antwort zuordnen, ggf. direkt als Aufgabe übernehmen.
 */
export function addInbound(user, d) {
  const flags = inspectInbound(`${d.subject}\n${d.body}`);
  const personal = findPersonalData(d.body);
  if (personal.length) flags.push(`Enthält personenbezogene Angaben (${[...new Set(personal)].join(', ')}): als gelb behandeln`);
  const sug = suggest(d);
  const r = q.run(`INSERT INTO inbox (area_id, channel, sender, subject, body, received_at, suggestion, flags, created_by, created_at, external_id, mailbox, conversation_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sug.area_id, d.channel, senderName(d.sender), str(d.subject, { max: 300 }), str(d.body, { max: 100_000 }), d.received_at || nowIso(),
    JSON.stringify(sug), JSON.stringify(flags), user?.id ?? null, nowIso(), d.external_id || null, d.mailbox || null, d.conversation_id || null);
  const id = Number(r.lastInsertRowid);
  if (d.attachments?.length) {
    const meta = saveInboxAttachments(id, d.attachments);
    q.run('UPDATE inbox SET attachments = ? WHERE id = ?', JSON.stringify(meta), id);
  }
  audit(user, { entity: 'inbox', entityId: id, areaId: sug.area_id, action: 'erfasst',
    summary: `Eingang (${d.channel}${d.mailbox ? ', ' + d.mailbox : ''}) erfasst: „${d.subject || sug.title}“${d.attachments?.length ? ` mit ${d.attachments.length} Anhang/Anhängen` : ''}${flags.length ? ` – Auffälligkeiten: ${flags.join('; ')}` : ''}` });

  let outcome = { id, suggestion: sug, flags };
  const item = q.get('SELECT * FROM inbox WHERE id = ?', id);
  if (isOn('antworten_zuordnen')) {
    const taskId = matchReply(user, item);
    if (taskId) return { ...outcome, matchedTask: taskId };
  }
  if (isOn('eingang_auto') && !flags.length && sug.sure) {
    const tpl = q.get('SELECT office_name FROM process_templates WHERE id = ?', sug.template_id);
    const office = tpl?.office_name ? q.get(`SELECT * FROM offices WHERE area_id = ? AND ? LIKE '%' || name || '%' ORDER BY length(name) DESC`, sug.area_id, tpl.office_name) : null;
    const taskId = acceptInbox(user, id, { area_id: sug.area_id, title: sug.title, template_id: sug.template_id, office_id: office?.id || null, due_date: sug.due_date, auto: true });
    outcome = { ...outcome, autoTask: taskId };
  }
  return outcome;
}

/**
 * Antwort erkennen: Vorgangsnummer [#123] im Betreff oder gleicher Mailverlauf wie ein Entwurf der App.
 * Dann: Kommentar an die Aufgabe, Anhänge an die Aufgabe, „Wartet“ beenden, verantwortliche Person benachrichtigen.
 */
export function matchReply(user, item) {
  let taskId = null;
  const m = String(item.subject).match(/\[(?:Vorgang\s*)?#(\d+)\]/i);
  if (m && q.get('SELECT 1 FROM tasks WHERE id = ?', Number(m[1]))) taskId = Number(m[1]);
  if (!taskId && item.conversation_id) taskId = q.get('SELECT task_id FROM drafts WHERE conversation_id = ? AND task_id IS NOT NULL ORDER BY id DESC LIMIT 1', item.conversation_id)?.task_id || null;
  if (!taskId) {
    const subj = String(item.subject).replace(/^((re|aw|antw|wg|fwd?)\s*:\s*)+/i, '').trim();
    if (subj.length >= 8 && subj !== item.subject) {
      taskId = q.get(`SELECT task_id FROM drafts WHERE subject = ? AND task_id IS NOT NULL AND status <> 'verworfen' AND created_at > ? ORDER BY id DESC LIMIT 1`, subj, addDays(today(), -120))?.task_id || null;
    }
  }
  if (!taskId) return null;
  const t = q.get('SELECT * FROM tasks WHERE id = ?', taskId);
  if (!t || ['verworfen'].includes(t.status)) return null;
  return tx(() => {
    const preview = item.body.split('\n').filter(l => l.trim() && !/^>/.test(l)).slice(0, 12).join('\n').slice(0, 1500);
    q.run('INSERT INTO comments (task_id, user_id, body, created_at) VALUES (?, NULL, ?, ?)', t.id,
      `📨 Antwort von ${item.sender || 'unbekannt'} (${item.channel}): „${item.subject}“\n\n${preview}`, nowIso());
    attachToTask(user, item, t, 'gelb');
    q.run(`UPDATE inbox SET status = 'uebernommen', task_id = ?, area_id = ? WHERE id = ?`, t.id, t.area_id, item.id);
    if (t.status === 'wartet') updateTask(user || { id: null, name: 'System' }, t, { status: 'in_arbeit' });
    else touch(t.id);
    audit(user, { entity: 'task', entityId: t.id, areaId: t.area_id, action: 'antwort', summary: `Antwort „${item.subject}“ von ${item.sender || 'unbekannt'} automatisch zugeordnet (Eingang #${item.id})` });
    notify([t.owner_id, t.deputy_id], t.id, 'antwort', `Antwort eingegangen zu „${t.title}“ von ${item.sender || 'unbekannt'}.`);
    return t.id;
  });
}

function attachToTask(user, item, task, dataClass) {
  const atts = parseJson(item.attachments, []).filter(a => a.stored);
  if (!atts.length || !isOn('anhaenge_ablegen')) return 0;
  let n = 0;
  for (const a of atts) {
    try {
      storeFile(user, { areaId: task.area_id, taskId: task.id, buffer: readInboxAttachment(item.id, a.stored), originalName: a.name, mime: a.mime,
        dataClass, docDate: item.received_at.slice(0, 10), issuer: item.sender || 'Eingang', occasion: a.name.replace(/\.[^.]+$/, '') });
      n++;
    } catch (err) { audit(user, { entity: 'inbox', entityId: item.id, action: 'anhang_fehler', summary: `Anhang „${a.name}“ nicht abgelegt: ${err.message}` }); }
  }
  removeInboxAttachments(item.id);
  return n;
}

/** Eingang als Aufgabe übernehmen. opts: area_id, title, template_id, office_id, owner_id, due_date, description, data_class, auto */
export function acceptInbox(user, inboxId, opts) {
  return tx(() => {
    const i = q.get('SELECT * FROM inbox WHERE id = ?', inboxId);
    if (!i) throw bad('Eingang nicht gefunden.');
    if (i.status !== 'neu') throw bad('Dieser Eingang wurde bereits bearbeitet.');
    const flags = parseJson(i.flags, []);
    const personal = flags.some(f => f.startsWith('Enthält personenbezogene')) || parseJson(i.attachments, []).length > 0;
    const description = `${str(opts.description, { max: 10_000 })}\n\n— Eingang (${i.channel}${i.mailbox ? ', ' + i.mailbox : ''}) von ${i.sender || 'unbekannt'} am ${new Date(i.received_at).toLocaleDateString('de-DE')} —\n${i.subject ? `Betreff: ${i.subject}\n` : ''}${i.body}`.trim();
    const id = createTask(user, {
      area_id: opts.area_id, title: opts.title || i.subject || 'Eingang', description,
      template_id: opts.template_id || null, office_id: opts.office_id || null, owner_id: opts.owner_id ?? (opts.auto ? null : user?.id ?? null),
      due_date: opts.due_date || null, channel: ['mail', 'whatsapp', 'post', 'telefon', 'persoenlich', 'website'].includes(i.channel) ? i.channel : 'manuell',
      data_class: personal || opts.data_class === 'gelb' ? 'gelb' : 'gruen',
    }, { source: `eingang:${i.id}` });
    q.run(`UPDATE inbox SET status = 'uebernommen', task_id = ?, area_id = ? WHERE id = ?`, id, opts.area_id, i.id);
    const task = q.get('SELECT * FROM tasks WHERE id = ?', id);
    const n = attachToTask(user, i, task, 'gelb');
    audit(user, { entity: 'inbox', entityId: i.id, areaId: opts.area_id, action: 'uebernommen',
      summary: `Eingang #${i.id} ${opts.auto ? 'automatisch ' : ''}als Aufgabe #${id} übernommen${n ? `, ${n} Anhang/Anhänge abgelegt` : ''}` });
    runInboundRules(task);
    return id;
  });
}

export function dismissInbox(user, inboxId, reason = '') {
  const i = q.get('SELECT * FROM inbox WHERE id = ?', inboxId);
  if (!i) throw bad('Eingang nicht gefunden.');
  q.run(`UPDATE inbox SET status = 'abgelegt' WHERE id = ?`, i.id);
  removeInboxAttachments(i.id);
  audit(user, { entity: 'inbox', entityId: i.id, areaId: i.area_id, action: 'abgelegt', summary: `Eingang #${i.id} ohne Aufgabe abgelegt${reason ? `: ${reason}` : ''}` });
}

// ---------- Postfach-Abruf (Microsoft 365) ----------

let polling = false;

/** Ruft alle verbundenen Postfächer ab. Gibt die Zahl neuer Eingänge zurück. */
export async function pollMailboxes({ force = false, user = null } = {}) {
  if (polling) return { skipped: true, created: 0 };
  if (!force && !isOn('postfach_abruf')) return { skipped: true, created: 0 };
  if (!m365.isConfigured()) throw bad('Microsoft 365 ist nicht verbunden.');
  polling = true;
  let created = 0;
  const errors = [];
  try {
    for (const mb of m365.m365Settings().mailboxes) {
      const key = `m365_abruf_${mb.address.toLowerCase()}`;
      // Beim ersten Abruf nur die letzten 7 Tage holen, nicht das ganze Postfach
      const since = getSetting(key, null) || new Date(Date.now() - 7 * 86_400_000).toISOString();
      try {
        const mails = await m365.fetchMail(mb.address, since, 50);
        let last = since;
        for (const m of mails) {
          last = m.received_at > last ? m.received_at : last;
          if (q.get('SELECT 1 FROM inbox WHERE external_id = ?', `m365:${m.id}`)) continue;
          const attachments = m.has_attachments ? await m365.fetchAttachments(mb.address, m.id).catch(() => []) : [];
          addInbound(user, { channel: 'mail', sender: m.sender, subject: m.subject, body: m.body, area_id: mb.area_id ? Number(mb.area_id) : null,
            received_at: m.received_at, external_id: `m365:${m.id}`, mailbox: mb.address, conversation_id: m.conversation_id, attachments });
          created++;
        }
        setSetting(key, last);
      } catch (err) { errors.push(`${mb.address}: ${err.message}`); }
    }
  } finally { polling = false; }
  setSetting('m365_letzter_abruf', { at: nowIso(), created, errors });
  if (created || errors.length) audit(user, { entity: 'system', action: 'postfach_abruf', summary: `Postfach-Abruf: ${created} neue Mail(s)${errors.length ? `; Fehler: ${errors.join('; ')}` : ''}` });
  if (created) {
    const admins = q.all(`SELECT id FROM users WHERE active = 1 AND role = 'admin'`).map(u => u.id);
    notify(admins, null, 'eingang', `${created} neue Mail(s) im Eingang.`);
  }
  return { created, errors };
}
