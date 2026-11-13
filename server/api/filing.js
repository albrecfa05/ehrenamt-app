// Eingangs- und Ablageregeln: Pflege, Probelauf, nachträgliches Anwenden. Nur Admins ändern Regeln (ROL-2).

import { del, get, post, put } from '../http.js';
import { q, tx } from '../db.js';
import { requireAdmin } from '../access.js';
import { applyRules, cleanFilingRule, evaluate, listRules, MODES } from '../services/filing.js';
import { acceptInbox } from '../services/inbox.js';
import { audit, int, notFound, nowIso, str } from '../util.js';

get('/api/filing-rules', () => ({ rules: listRules(), modes: MODES }));

/** Legt eine geprüfte Regel an. Auch für KI-Vorschläge genutzt. */
export function insertFilingRule(user, d, origin = '') {
  const now = nowIso();
  const r = q.run(`INSERT INTO filing_rules (name, pos, active, area_id, sender_contains, subject_contains, filename_contains, file_types, target_area_id, folder, data_class,
                     occasion, tags, mode, template_id, office_id, mirror, dismiss_mail, origin, created_by, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    d.name, d.pos, d.active, d.area_id, d.sender_contains, d.subject_contains, d.filename_contains, d.file_types, d.target_area_id, d.folder, d.data_class,
    d.occasion, d.tags, d.mode, d.template_id, d.office_id, d.mirror, d.dismiss_mail, origin, user.id, now, now);
  const id = Number(r.lastInsertRowid);
  audit(user, { entity: 'filing_rule', entityId: id, action: 'angelegt', summary: `Ablageregel „${d.name}“ angelegt${origin ? ` (${origin})` : ''}: → ${d.folder || 'ohne Ordner'}, ${d.mode}` });
  q.run('INSERT INTO changelog (entity, entity_id, title, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)', 'filing_rule', id, `Neue Ablageregel „${d.name}“`, origin, now, user.id);
  return id;
}

post('/api/filing-rules', ({ user, body }) => {
  requireAdmin(user);
  return { id: insertFilingRule(user, cleanFilingRule(body)) };
});

put('/api/filing-rules/:id', ({ user, params, body }) => {
  requireAdmin(user);
  const r = q.get('SELECT * FROM filing_rules WHERE id = ?', int(params.id));
  if (!r) throw notFound();
  const d = cleanFilingRule({ ...r, ...body });
  q.run(`UPDATE filing_rules SET name = ?, pos = ?, active = ?, area_id = ?, sender_contains = ?, subject_contains = ?, filename_contains = ?, file_types = ?, target_area_id = ?,
         folder = ?, data_class = ?, occasion = ?, tags = ?, mode = ?, template_id = ?, office_id = ?, mirror = ?, dismiss_mail = ?, updated_at = ? WHERE id = ?`,
    d.name, d.pos, d.active, d.area_id, d.sender_contains, d.subject_contains, d.filename_contains, d.file_types, d.target_area_id, d.folder, d.data_class,
    d.occasion, d.tags, d.mode, d.template_id, d.office_id, d.mirror, d.dismiss_mail, nowIso(), r.id);
  audit(user, { entity: 'filing_rule', entityId: r.id, action: 'geändert', summary: `Ablageregel „${d.name}“ geändert${r.active !== d.active ? (d.active ? ' (aktiviert)' : ' (pausiert)') : ''}` });
  return { ok: true };
});

// Reihenfolge: Liste von IDs in gewünschter Reihenfolge
post('/api/filing-rules/order', ({ user, body }) => tx(() => {
  requireAdmin(user);
  (body.ids || []).map(Number).filter(Boolean).forEach((id, i) => q.run('UPDATE filing_rules SET pos = ? WHERE id = ?', (i + 1) * 10, id));
  audit(user, { entity: 'filing_rule', action: 'reihenfolge', summary: 'Reihenfolge der Ablageregeln geändert' });
  return { ok: true };
}));

del('/api/filing-rules/:id', ({ user, params }) => {
  requireAdmin(user);
  const r = q.get('SELECT * FROM filing_rules WHERE id = ?', int(params.id));
  if (!r) throw notFound();
  q.run('DELETE FROM filing_rules WHERE id = ?', r.id);
  audit(user, { entity: 'filing_rule', entityId: r.id, action: 'geloescht', summary: `Ablageregel „${r.name}“ gelöscht` });
});

// Probelauf: Welche Regel griffe bei diesem Absender, Betreff und diesen Dateinamen?
post('/api/filing-rules/test', ({ user, body }) => {
  requireAdmin(user);
  const raw = str(body.sender, { max: 200 });
  const mail = {
    area_id: int(body.area_id),
    sender: raw.replace(/<[^>]*>/, '').replace(/[^\s]+@[^\s]+/, '').trim(),
    sender_domain: (raw.match(/@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/)?.[1] || (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw) ? raw : '')).toLowerCase(),
    subject: str(body.subject, { max: 300 }),
  };
  const files = String(body.filenames || '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).slice(0, 20).map(name => ({ name }));
  const { mailRule, perAttachment } = evaluate(mail, files);
  const area = (id) => id ? q.get('SELECT name FROM areas WHERE id = ?', id)?.name : null;
  return {
    mail: { domain: mail.sender_domain },
    rule: mailRule ? { id: mailRule.id, name: mailRule.name, mode: mailRule.mode, area: area(mailRule.target_area_id || mail.area_id) } : null,
    files: files.map((f, i) => {
      const r = perAttachment[i];
      return { name: f.name, rule: r?.name || null, folder: r?.folder || '', data_class: r?.data_class || 'gelb', area: area(r?.target_area_id || mail.area_id) };
    }),
  };
});

// Regeln nachträglich auf alle offenen Eingänge anwenden
post('/api/filing-rules/apply-inbox', ({ user }) => {
  requireAdmin(user);
  const results = [];
  for (const i of q.all(`SELECT id FROM inbox WHERE status = 'neu' ORDER BY id`)) {
    const r = applyRules(user, i.id, acceptInbox);
    if (r) results.push({ id: i.id, ...r });
  }
  audit(user, { entity: 'filing_rule', action: 'nachtraeglich', summary: `Ablageregeln auf offene Eingänge angewendet: ${results.length} Treffer` });
  return { results };
});
