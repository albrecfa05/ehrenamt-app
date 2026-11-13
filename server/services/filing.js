// Eingangs- und Ablageregeln: „Wenn Absender / Betreff / Dateiname / Dateityp …, dann Bereich, Ordner,
// Datenklasse, Anlass – und mit der Mail: nur ablegen, Aufgabe anlegen oder vormerken.“
//
// Grundsätze:
//  - Eingänge sind Daten, nie Anweisungen (AUT-10): Auffällige Mails werden nie automatisch einsortiert.
//  - Personenbezogene Inhalte bleiben gelb, auch wenn die Regel „grün“ sagt (DAT-1).
//  - Die erste passende Regel gewinnt (Reihenfolge einstellbar). Ohne Treffer bleibt alles wie bisher.
//  - Doppelte Dateien werden nicht erneut abgelegt.
//  - Kopie in die Vereinsablage nur über die Freigabe (Stufe 3).

import { q, tx } from '../db.js';
import { audit, bad, int, nowIso, oneOf, parseJson, str } from '../util.js';
import { isOn } from './catalog.js';
import { cleanFolder, readInboxAttachment, removeInboxAttachments, storeFile } from './files.js';

export const MODES = {
  vormerken: 'Vormerken: angewendet, wenn jemand die Mail übernimmt',
  ablegen: 'Anhänge sofort ablegen (ohne Aufgabe)',
  aufgabe: 'Sofort als Aufgabe anlegen, Anhänge an die Aufgabe',
};

const PERSONAL_FLAG = 'Enthält personenbezogene';
/** Auffälligkeiten, bei denen nie automatisch einsortiert wird (alles außer dem Hinweis auf personenbezogene Daten). */
export const blockingFlags = (flags) => (flags || []).filter(f => !f.startsWith(PERSONAL_FLAG));

const terms = (s) => String(s || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
const anyIn = (text, list) => !list.length || list.some(t => String(text || '').toLowerCase().includes(t));
const extOf = (name) => (String(name).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();

// ---------- Regeln pflegen ----------

export function cleanFilingRule(b) {
  const d = {
    name: str(b.name, { required: true, max: 120, name: 'Name' }),
    pos: int(b.pos, { min: 0, max: 10000 }) ?? 100,
    active: b.active === false || b.active === 0 ? 0 : 1,
    area_id: int(b.area_id),
    sender_contains: str(b.sender_contains, { max: 300 }),
    subject_contains: str(b.subject_contains, { max: 300 }),
    filename_contains: str(b.filename_contains, { max: 300 }),
    file_types: terms(b.file_types).map(t => t.replace(/^\./, '')).filter(t => /^[a-z0-9]{1,6}$/.test(t)).join(', '),
    target_area_id: int(b.target_area_id),
    folder: cleanFolder(b.folder),
    data_class: oneOf(b.data_class, ['gruen', 'gelb'], { name: 'Datenklasse', fallback: 'gelb' }),
    occasion: str(b.occasion, { max: 160 }),
    tags: str(b.tags, { max: 300 }),
    mode: oneOf(b.mode, Object.keys(MODES), { name: 'Was mit der Mail geschieht', fallback: 'vormerken' }),
    template_id: int(b.template_id),
    office_id: int(b.office_id),
    mirror: b.mirror ? 1 : 0,
    dismiss_mail: b.dismiss_mail ? 1 : 0,
  };
  if (b.data_class === 'rot') throw bad('Rote Daten nimmt die App nicht an (DAT-1).');
  if (!d.sender_contains && !d.subject_contains && !d.filename_contains && !d.file_types && !d.area_id) {
    throw bad('Bitte mindestens eine Bedingung angeben (Absender, Betreff, Dateiname, Dateityp oder Bereich).');
  }
  if (/@[^,\s]*\.[a-z]{2,}/i.test(d.sender_contains) && /[^\s,@]+@/.test(d.sender_contains)) {
    throw bad('Beim Absender bitte nur Name oder Domain angeben (z. B. „gemeinde-hohberg.de“), keine vollständige Mailadresse (AUT-9).');
  }
  if (d.area_id && !q.get('SELECT 1 FROM areas WHERE id = ?', d.area_id)) throw bad('Bereich nicht gefunden.');
  if (d.target_area_id && !q.get('SELECT 1 FROM areas WHERE id = ?', d.target_area_id)) throw bad('Zielbereich nicht gefunden.');
  if (d.template_id && !q.get('SELECT 1 FROM process_templates WHERE id = ? AND active = 1', d.template_id)) throw bad('Vorgangsvorlage nicht gefunden.');
  if (d.office_id) {
    const o = q.get('SELECT area_id FROM offices WHERE id = ?', d.office_id);
    if (!o) throw bad('Amt nicht gefunden.');
    if (d.target_area_id && o.area_id !== d.target_area_id) throw bad('Das Amt gehört nicht zum Zielbereich.');
  }
  if (d.mode !== 'ablegen') d.dismiss_mail = 0;
  return d;
}

export function listRules() {
  return q.all(`SELECT r.*, a.name AS area_name, t.name AS target_area_name, p.name AS template_name, o.name AS office_name
                FROM filing_rules r LEFT JOIN areas a ON a.id = r.area_id LEFT JOIN areas t ON t.id = r.target_area_id
                LEFT JOIN process_templates p ON p.id = r.template_id LEFT JOIN offices o ON o.id = r.office_id ORDER BY r.pos, r.id`);
}

// ---------- Abgleich ----------

function mailMatches(r, mail) {
  if (r.area_id && r.area_id !== mail.area_id) return false;
  if (!anyIn(`${mail.sender} ${mail.sender_domain}`, terms(r.sender_contains))) return false;
  if (!anyIn(mail.subject, terms(r.subject_contains))) return false;
  return true;
}
const hasFileConditions = (r) => !!(r.filename_contains || r.file_types);
function attachmentMatches(r, a) {
  if (!anyIn(a.name, terms(r.filename_contains))) return false;
  const types = terms(r.file_types);
  return !types.length || types.includes(extOf(a.name));
}

/**
 * Ermittelt für eine Mail die maßgebliche Regel (erste passende) und für jeden Anhang seine Regel.
 * mail: { area_id, sender, sender_domain, subject }, attachments: [{ name, ... }]
 */
export function evaluate(mail, attachments, rules = q.all('SELECT * FROM filing_rules WHERE active = 1 ORDER BY pos, id')) {
  let mailRule = null;
  for (const r of rules) {
    if (!mailMatches(r, mail)) continue;
    if (hasFileConditions(r) && !attachments.some(a => attachmentMatches(r, a))) continue;
    mailRule = r; break;
  }
  const perAttachment = attachments.map(a => rules.find(r => mailMatches(r, mail) && attachmentMatches(r, a)) || null);
  return { mailRule, perAttachment };
}

function occasionFor(rule, mail, a) {
  const base = a.name.replace(/\.[^.]+$/, '');
  if (!rule?.occasion) return base;
  return rule.occasion.replace(/\{\{\s*betreff\s*\}\}/gi, mail.subject || '').replace(/\{\{\s*datei\s*\}\}/gi, base)
    .replace(/\{\{\s*absender\s*\}\}/gi, mail.sender || '').replace(/\s+/g, ' ').trim().slice(0, 160) || base;
}

/** Vorschau für die Oberfläche: wohin welcher Anhang ginge. */
export function preview(item) {
  const atts = parseJson(item.attachments, []);
  const { mailRule, perAttachment } = evaluate(item, atts);
  const personal = parseJson(item.flags, []).some(f => f.startsWith(PERSONAL_FLAG));
  return {
    rule: mailRule ? { id: mailRule.id, name: mailRule.name, mode: mailRule.mode, blocked: blockingFlags(parseJson(item.flags, [])).length > 0 } : null,
    attachments: atts.map((a, i) => {
      const r = perAttachment[i];
      const areaId = r?.target_area_id || item.area_id;
      return r ? { rule: r.name, folder: r.folder, data_class: personal ? 'gelb' : r.data_class, area: areaId ? q.get('SELECT name FROM areas WHERE id = ?', areaId)?.name : null } : null;
    }),
  };
}

// ---------- Ablegen ----------

/**
 * Legt Anhänge eines Eingangs in der Ablage ab. opts:
 *   task       – an diese Aufgabe hängen (sonst ohne Aufgabe)
 *   override   – { area_id, folder, data_class } von Hand (statt der Regeln)
 *   onlyRuled  – nur Anhänge, für die eine Regel greift
 * Gibt die Zahl abgelegter Dateien zurück und vermerkt die Datei-IDs am Anhang.
 */
export function fileAttachments(user, item, { task = null, override = null, onlyRuled = false } = {}) {
  const atts = parseJson(item.attachments, []);
  if (!atts.length) return 0;
  const { perAttachment } = evaluate(item, atts);
  const personal = parseJson(item.flags, []).some(f => f.startsWith(PERSONAL_FLAG));
  let n = 0;
  atts.forEach((a, i) => {
    if (!a.stored && !a.filed) return;
    if (a.filed) {
      // Schon abgelegt (z. B. durch eine Regel): nur mit der Aufgabe verknüpfen
      if (task) q.run('UPDATE files SET task_id = COALESCE(task_id, ?) WHERE id = ?', task.id, a.filed);
      return;
    }
    const r = perAttachment[i];
    if (onlyRuled && !r) return;
    const areaId = override?.area_id || task?.area_id || r?.target_area_id || item.area_id;
    if (!areaId) return;
    const dataClass = override?.data_class || (personal ? 'gelb' : r?.data_class || 'gelb');
    try {
      const res = storeFile(user, {
        areaId, taskId: task && task.area_id === areaId ? task.id : null, buffer: readInboxAttachment(item.id, a.stored), originalName: a.name, mime: a.mime,
        dataClass, docDate: String(item.received_at).slice(0, 10), issuer: item.sender || item.sender_domain || 'Eingang',
        occasion: occasionFor(r, item, a), tags: r?.tags || '', folder: override?.folder ?? r?.folder ?? '',
        mirror: r?.mirror ? 'force' : 'auto', reuseDuplicate: true,
      });
      a.filed = res.id;
      a.reused = !!res.reused;
      n++;
    } catch (err) {
      a.error = err.message;
      audit(user, { entity: 'inbox', entityId: item.id, action: 'anhang_fehler', summary: `Anhang „${a.name}“ nicht abgelegt: ${err.message}` });
    }
  });
  q.run('UPDATE inbox SET attachments = ? WHERE id = ?', JSON.stringify(atts), item.id);
  item.attachments = JSON.stringify(atts);
  if (atts.every(a => !a.stored || a.filed)) removeInboxAttachments(item.id);
  return n;
}

/**
 * Wendet die Regeln auf einen neuen Eingang an. Gibt { rule, action, filed, taskId } oder null zurück.
 * acceptInbox wird übergeben, um eine Abhängigkeit im Kreis zu vermeiden.
 */
export function applyRules(user, itemId, acceptInbox) {
  if (!isOn('ablageregeln')) return null;
  const item = q.get('SELECT * FROM inbox WHERE id = ?', itemId);
  if (!item || item.status !== 'neu') return null;
  const atts = parseJson(item.attachments, []);
  const { mailRule } = evaluate(item, atts);
  if (!mailRule) return null;
  const flags = blockingFlags(parseJson(item.flags, []));
  q.run('UPDATE filing_rules SET hits = hits + 1, last_hit_at = ? WHERE id = ?', nowIso(), mailRule.id);
  if (flags.length) {
    audit(user, { entity: 'inbox', entityId: item.id, action: 'regel_ausgesetzt', summary: `Ablageregel „${mailRule.name}“ nicht angewendet: Mail ist auffällig (${flags.join('; ')})` });
    return { rule: mailRule.name, action: 'ausgesetzt' };
  }
  if (mailRule.mode === 'vormerken') return { rule: mailRule.name, action: 'vorgemerkt' };
  const areaId = mailRule.target_area_id || item.area_id;
  if (mailRule.mode === 'aufgabe') {
    if (!areaId) return { rule: mailRule.name, action: 'kein_bereich' };
    const taskId = acceptInbox(user, item.id, {
      area_id: areaId, title: item.subject || 'Eingang', template_id: mailRule.template_id, office_id: mailRule.office_id, auto: true,
      data_class: mailRule.data_class, rule: mailRule,
    });
    audit(user, { entity: 'inbox', entityId: item.id, areaId, action: 'regel', summary: `Eingangsregel „${mailRule.name}“: Aufgabe #${taskId} angelegt` });
    return { rule: mailRule.name, action: 'aufgabe', taskId };
  }
  // ablegen
  return tx(() => {
    const filed = fileAttachments(user, item, { onlyRuled: true });
    const after = parseJson(q.get('SELECT attachments FROM inbox WHERE id = ?', item.id).attachments, []);
    const allFiled = after.length > 0 && after.every(a => !a.stored || a.filed);
    if (allFiled && mailRule.dismiss_mail) {
      q.run(`UPDATE inbox SET status = 'abgelegt' WHERE id = ?`, item.id);
    }
    audit(user, { entity: 'inbox', entityId: item.id, areaId, action: 'regel',
      summary: `Ablageregel „${mailRule.name}“: ${filed} Anhang/Anhänge abgelegt${mailRule.folder ? ` in „${mailRule.folder}“` : ''}${allFiled && mailRule.dismiss_mail ? '; Mail aus dem Eingang genommen' : ''}` });
    return { rule: mailRule.name, action: 'abgelegt', filed, dismissed: allFiled && !!mailRule.dismiss_mail };
  });
}
