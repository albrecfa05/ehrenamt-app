// Automatisierungskatalog, Verbindungen (Microsoft 365, Spielpläne), Sponsoren, meinVerein-Prüfung,
// Datenschutz-Auskunft (NFA-12) und Sammelfreigaben.

import { del, get, post, put } from '../http.js';
import { q, tx, getSetting, setSetting } from '../db.js';
import { areaClause, assertArea, canSeeArea, requireAdmin } from '../access.js';
import { catalogView, isOn, updateCatalog } from '../services/catalog.js';
import * as m365 from '../connectors/m365.js';
import { fetchIcs, isHomeGame } from '../connectors/ics.js';
import { syncFeed, checkMembers, monthlyReport } from '../services/jobs.js';
import { createTask } from '../services/tasks.js';
import { decideApproval, requestApproval } from '../services/automation.js';
import { DEFAULT_STUFEN } from '../calc.js';
import { parseCsv } from './reports.js';
import { audit, bad, dateOrNull, formatDateDe, int, isDate, notFound, nowIso, oneOf, parseJson, str, today } from '../util.js';

// ---------- Automatisierungskatalog ----------

get('/api/catalog', () => catalogView());

put('/api/catalog', ({ user, body }) => {
  requireAdmin(user);
  let log;
  try { log = updateCatalog(body); } catch (err) { throw bad(err.message); }
  if (log.length) {
    audit(user, { entity: 'settings', action: 'katalog', summary: `Automatisierungskatalog geändert: ${log.join('; ')}` });
    q.run('INSERT INTO changelog (entity, title, note, created_at, created_by) VALUES (?, ?, ?, ?, ?)', 'settings', 'Automatisierungen geändert', log.join('\n'), nowIso(), user.id);
  }
  return { changes: log, catalog: catalogView() };
});

// ---------- Microsoft 365 ----------

get('/api/connections', ({ user }) => {
  requireAdmin(user);
  return {
    m365: m365.status(),
    lastPoll: getSetting('m365_letzter_abruf', null),
    feeds: q.all(`SELECT f.*, a.name AS area_name, p.name AS template_name, u.name AS owner_name,
                    (SELECT COUNT(*) FROM events e WHERE e.feed_id = f.id AND e.date >= ?) AS upcoming
                  FROM feeds f JOIN areas a ON a.id = f.area_id LEFT JOIN process_templates p ON p.id = f.template_id LEFT JOIN users u ON u.id = f.owner_id
                  ORDER BY a.name, f.name`, today()),
  };
});

const mailRe = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

put('/api/connections/m365', ({ user, body }) => {
  requireAdmin(user);
  const mailboxes = (body.mailboxes || []).map(m => ({ address: str(m.address, { max: 200 }).toLowerCase(), area_id: int(m.area_id) }))
    .filter(m => m.address);
  for (const m of mailboxes) if (!mailRe.test(m.address)) throw bad(`„${m.address}“ ist keine gültige Postfachadresse.`);
  const kal = str(body.kalender_postfach, { max: 200 }).toLowerCase();
  if (kal && !mailRe.test(kal)) throw bad('Das Kalender-Postfach ist keine gültige Adresse.');
  const ziel = str(body.ablage_ziel, { max: 300 }).replace(/^\/+|\/+$/g, '');
  if (ziel && !/^(users\/[^/]+\/drive|sites\/[^/]+\/drive|drives\/[^/]+|groups\/[^/]+\/drive)$/.test(ziel)) {
    throw bad('Ablageort bitte als „users/<postfach>/drive“, „sites/<site-id>/drive“, „groups/<gruppen-id>/drive“ oder „drives/<drive-id>“ angeben.');
  }
  const next = { mailboxes, kalender_postfach: kal, ablage_ziel: ziel, ablage_ordner: str(body.ablage_ordner, { max: 200 }).replace(/[\\:*?"<>|]/g, '') || 'Ehrenamt-App' };
  setSetting('m365', next);
  audit(user, { entity: 'settings', action: 'm365', summary: `Microsoft-365-Verbindung geändert: ${mailboxes.length} Postfach/Postfächer${kal ? ', Kalender ' + kal : ''}${ziel ? ', Ablage ' + ziel : ''}` });
  return m365.status();
});

post('/api/connections/m365/test', async ({ user }) => {
  requireAdmin(user);
  m365.resetTokenCache();
  try {
    const results = await m365.testConnection();
    audit(user, { entity: 'settings', action: 'm365_test', summary: `Verbindungstest Microsoft 365: ${results.map(r => `${r.address} ${r.ok ? 'ok' : 'Fehler'}`).join(', ') || 'Anmeldung ok'}` });
    return { ok: results.every(r => r.ok), results };
  } catch (err) {
    return { ok: false, results: [{ address: 'Anmeldung', ok: false, info: err.message }] };
  }
});

// ---------- Spielplan-Abos ----------

function cleanFeed(b) {
  const url = str(b.url, { required: true, max: 1000, name: 'Adresse' }).replace(/^webcal:/i, 'https:');
  if (!/^https?:\/\//i.test(url)) throw bad('Die Adresse muss mit https:// (oder webcal://) beginnen.');
  return {
    area_id: int(b.area_id, { nullable: false, name: 'Bereich' }),
    name: str(b.name, { required: true, max: 120, name: 'Name' }),
    url,
    home_pattern: str(b.home_pattern, { max: 80 }),
    create_tasks: b.create_tasks ? 1 : 0,
    template_id: int(b.template_id),
    lead_days: int(b.lead_days, { min: 0, max: 60, nullable: false, name: 'Vorlauf' }) ?? 10,
    owner_id: int(b.owner_id),
    active: b.active === false ? 0 : 1,
  };
}

post('/api/feeds/preview', async ({ user, body }) => {
  requireAdmin(user);
  const events = await fetchIcs(str(body.url, { required: true, max: 1000 }).replace(/^webcal:/i, 'https:')).catch(err => { throw bad(err.message); });
  const upcoming = events.filter(e => e.date >= today()).sort((a, b) => a.date.localeCompare(b.date));
  return { total: events.length, upcoming: upcoming.length,
    sample: upcoming.slice(0, 12).map(e => ({ ...e, home: isHomeGame(e, body.home_pattern) })) };
});

post('/api/feeds', ({ user, body }) => {
  requireAdmin(user);
  const d = cleanFeed(body);
  assertArea(user, d.area_id);
  const r = q.run(`INSERT INTO feeds (area_id, name, url, home_pattern, create_tasks, template_id, lead_days, owner_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    d.area_id, d.name, d.url, d.home_pattern, d.create_tasks, d.template_id, d.lead_days, d.owner_id, d.active, nowIso());
  audit(user, { entity: 'feed', entityId: Number(r.lastInsertRowid), areaId: d.area_id, action: 'angelegt', summary: `Spielplan-Abo „${d.name}“ angelegt` });
  return { id: Number(r.lastInsertRowid) };
});

put('/api/feeds/:id', ({ user, params, body }) => {
  requireAdmin(user);
  const f = q.get('SELECT * FROM feeds WHERE id = ?', int(params.id));
  if (!f) throw notFound();
  const d = cleanFeed({ ...f, ...body });
  q.run('UPDATE feeds SET area_id = ?, name = ?, url = ?, home_pattern = ?, create_tasks = ?, template_id = ?, lead_days = ?, owner_id = ?, active = ? WHERE id = ?',
    d.area_id, d.name, d.url, d.home_pattern, d.create_tasks, d.template_id, d.lead_days, d.owner_id, d.active, f.id);
  audit(user, { entity: 'feed', entityId: f.id, areaId: d.area_id, action: 'geändert', summary: `Spielplan-Abo „${d.name}“ geändert` });
  return { ok: true };
});

del('/api/feeds/:id', ({ user, params }) => {
  requireAdmin(user);
  const f = q.get('SELECT * FROM feeds WHERE id = ?', int(params.id));
  if (!f) throw notFound();
  tx(() => {
    q.run('DELETE FROM events WHERE feed_id = ? AND date >= ?', f.id, today());
    q.run('UPDATE events SET feed_id = NULL WHERE feed_id = ?', f.id);
    q.run('DELETE FROM feeds WHERE id = ?', f.id);
  });
  audit(user, { entity: 'feed', entityId: f.id, areaId: f.area_id, action: 'geloescht', summary: `Spielplan-Abo „${f.name}“ entfernt (künftige Spieltermine gelöscht)` });
});

post('/api/feeds/:id/sync', async ({ user, params }) => {
  requireAdmin(user);
  const f = q.get('SELECT * FROM feeds WHERE id = ?', int(params.id));
  if (!f) throw notFound();
  const r = await syncFeed(f, user);
  if (r.error) throw bad(r.error);
  return r;
});

// ---------- Sponsoren (VOR-6) ----------

get('/api/sponsors', ({ user }) => {
  const ac = areaClause(user, 's.area_id');
  return q.all(`SELECT s.*, a.name AS area_name, a.color AS area_color, u.name AS godparent_name FROM sponsors s JOIN areas a ON a.id = s.area_id
                LEFT JOIN users u ON u.id = s.godparent_id WHERE ${ac.sql} ORDER BY s.status = 'beendet', s.end_date IS NULL, s.end_date, s.company`, ...ac.params)
    .map(s => ({ ...s, days_left: s.end_date ? Math.round((Date.parse(s.end_date) - Date.parse(today())) / 86_400_000) : null,
      open_task: q.get(`SELECT id, title FROM tasks WHERE parent_source LIKE ? AND status IN ('offen','in_arbeit','wartet') ORDER BY id DESC LIMIT 1`, `sponsor:${s.id}:%`) || null }));
});

function cleanSponsor(b) {
  const d = {
    area_id: int(b.area_id, { nullable: false, name: 'Bereich' }),
    company: str(b.company, { required: true, max: 160, name: 'Firma' }),
    contact_name: str(b.contact_name, { max: 120 }),
    godparent_id: int(b.godparent_id),
    category: str(b.category, { max: 80 }),
    start_date: dateOrNull(b.start_date, 'Beginn'),
    end_date: dateOrNull(b.end_date, 'Laufzeitende'),
    status: oneOf(b.status, ['aktiv', 'verhandlung', 'beendet'], { name: 'Status', fallback: 'aktiv' }),
    notes: str(b.notes, { max: 5000 }),
  };
  if (/@|\d{4,}/.test(d.contact_name)) throw bad('Ansprechpartner bitte nur mit Namen, ohne Mail oder Telefonnummer (AUT-9).');
  return d;
}

post('/api/sponsors', ({ user, body }) => {
  const d = cleanSponsor(body);
  assertArea(user, d.area_id);
  const r = q.run(`INSERT INTO sponsors (area_id, company, contact_name, godparent_id, category, start_date, end_date, status, notes, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, d.area_id, d.company, d.contact_name, d.godparent_id, d.category, d.start_date, d.end_date, d.status, d.notes, nowIso(), nowIso());
  audit(user, { entity: 'sponsor', entityId: Number(r.lastInsertRowid), areaId: d.area_id, action: 'angelegt', summary: `Sponsor „${d.company}“ angelegt${d.end_date ? ` (Laufzeit bis ${formatDateDe(d.end_date)})` : ''}` });
  return { id: Number(r.lastInsertRowid) };
});

put('/api/sponsors/:id', ({ user, params, body }) => {
  const s = q.get('SELECT * FROM sponsors WHERE id = ?', int(params.id));
  if (!s || !canSeeArea(user, s.area_id)) throw notFound();
  const d = cleanSponsor({ ...s, ...body });
  q.run(`UPDATE sponsors SET area_id = ?, company = ?, contact_name = ?, godparent_id = ?, category = ?, start_date = ?, end_date = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?`,
    d.area_id, d.company, d.contact_name, d.godparent_id, d.category, d.start_date, d.end_date, d.status, d.notes, nowIso(), s.id);
  audit(user, { entity: 'sponsor', entityId: s.id, areaId: d.area_id, action: 'geändert', summary: `Sponsor „${d.company}“ geändert${s.end_date !== d.end_date ? `: Laufzeit ${s.end_date ? formatDateDe(s.end_date) : '—'} → ${d.end_date ? formatDateDe(d.end_date) : '—'}` : ''}` });
  return { ok: true };
});

post('/api/sponsors/:id/contact', ({ user, params, body }) => {
  const s = q.get('SELECT * FROM sponsors WHERE id = ?', int(params.id));
  if (!s || !canSeeArea(user, s.area_id)) throw notFound();
  const date = dateOrNull(body.date, 'Datum') || today();
  const note = str(body.note, { max: 1000 });
  q.run('UPDATE sponsors SET last_contact = ?, notes = ?, updated_at = ? WHERE id = ?', date,
    note ? `${s.notes ? s.notes + '\n' : ''}${formatDateDe(date)}: ${note}` : s.notes, nowIso(), s.id);
  audit(user, { entity: 'sponsor', entityId: s.id, areaId: s.area_id, action: 'kontakt', summary: `Kontakt mit „${s.company}“ am ${formatDateDe(date)}${note ? `: ${note.slice(0, 120)}` : ''}` });
  return { ok: true };
});

del('/api/sponsors/:id', ({ user, params }) => {
  requireAdmin(user);
  const s = q.get('SELECT * FROM sponsors WHERE id = ?', int(params.id));
  if (!s) throw notFound();
  q.run('DELETE FROM sponsors WHERE id = ?', s.id);
  audit(user, { entity: 'sponsor', entityId: s.id, areaId: s.area_id, action: 'geloescht', summary: `Sponsor „${s.company}“ gelöscht` });
});

// ---------- meinVerein-Export prüfen (VOR-2) ----------

post('/api/members/check', ({ user, body }) => {
  requireAdmin(user);
  if (!isOn('mitglieder_pruefung')) throw bad('Die Automatisierung „Beitragsstufen aus meinVerein-Export prüfen“ ist nicht eingeschaltet oder die Datenschutzfrage ist noch nicht geklärt (Einstellungen).');
  const stichtag = isDate(body.stichtag) ? body.stichtag : `${Number(today().slice(0, 4)) + 1}-01-01`;
  const r = checkMembers(parseCsv(body.csv), stichtag, getSetting('beitragsstufen', DEFAULT_STUFEN));
  // Der Export wird nicht gespeichert. Ins Protokoll kommt nur die Anzahl.
  audit(user, { entity: 'import', action: 'mitglieder_pruefung', summary: `meinVerein-Export geprüft (Stichtag ${formatDateDe(stichtag)}): ${r.checked} Personen, ${r.changes.length} Stufenwechsel. Export nicht gespeichert.` });
  return { ...r, stichtag };
});

post('/api/members/task', ({ user, body }) => {
  requireAdmin(user);
  if (!isOn('mitglieder_pruefung')) throw bad('Die Automatisierung ist nicht eingeschaltet.');
  const areaId = int(body.area_id, { nullable: false, name: 'Bereich' });
  assertArea(user, areaId);
  const changes = (body.changes || []).slice(0, 500);
  if (!changes.length) throw bad('Keine Stufenwechsel übergeben.');
  const vor2 = q.get(`SELECT id FROM process_templates WHERE key = 'VOR-2'`)?.id || null;
  const office = q.get(`SELECT id FROM offices WHERE area_id = ? AND name = 'Mitgliederverwaltung'`, areaId)?.id || null;
  const id = createTask(user, {
    area_id: areaId, office_id: office, template_id: vor2, data_class: 'gelb',
    title: `Beitragsstufen zum ${formatDateDe(body.stichtag || today())} umstellen (${changes.length} Personen)`,
    description: `Ergebnis der Prüfung des meinVerein-Exports. Umstellung in meinVerein von Hand, danach je Person abhaken.\n\nGrundlage: hinterlegte Beitragsstufen (Einstellungen).`,
    due_date: dateOrNull(body.stichtag) || null,
  });
  for (const [i, c] of changes.entries()) {
    q.run('INSERT INTO task_steps (task_id, pos, title, description, manual) VALUES (?, ?, ?, ?, 1)', id, 100 + i,
      `${str(c.name, { max: 120 })}: ${str(c.ist, { max: 80 })} → ${str(c.soll, { max: 80 })}`, `Alter im Stichjahr: ${int(c.alter) ?? '?'}`);
  }
  return { taskId: id };
});

// ---------- Monatsbericht auf Zuruf ----------

post('/api/reports/monthly', ({ user }) => {
  requireAdmin(user);
  return { id: monthlyReport(today(), true) };
});

// ---------- Sammelfreigabe ----------

post('/api/approvals/decide-batch', async ({ user, body }) => {
  requireAdmin(user);
  const ids = (body.ids || []).map(Number).filter(Boolean).slice(0, 100);
  const results = [];
  for (const id of ids) {
    try { results.push({ id, ...(await decideApproval(user, id, { approve: !!body.approve, note: str(body.note, { max: 1000 }) })) }); }
    catch (err) { results.push({ id, status: 'uebersprungen', result: err.message }); }
  }
  return { results };
});

// ---------- Termin in Outlook, Entwurf ins Postfach (Stufe 3) ----------

post('/api/events/:id/outlook', ({ user, params }) => {
  const e = q.get('SELECT * FROM events WHERE id = ?', int(params.id));
  if (!e || !canSeeArea(user, e.area_id)) throw notFound();
  if (!isOn('m365_kalender')) throw bad('„Termine in den Outlook-Kalender eintragen“ ist nicht eingeschaltet oder Microsoft 365 ist nicht verbunden.');
  if (e.remote_id) throw bad('Der Termin steht bereits im Outlook-Kalender.');
  const id = requestApproval({ actionType: 'm365_kalender', payload: { kind: 'm365_kalender', area_id: e.area_id, event_id: e.id, title: e.title, date: e.date },
    summary: `Termin „${e.title}“ am ${formatDateDe(e.date)} in den Outlook-Kalender eintragen`, taskId: e.task_id, user });
  return { approvalId: id };
});

post('/api/drafts/:id/mailbox', ({ user, params }) => {
  const d = q.get('SELECT * FROM drafts WHERE id = ?', int(params.id));
  if (!d || !canSeeArea(user, d.area_id)) throw notFound();
  if (!isOn('postfach_entwuerfe')) throw bad('„Entwürfe im Postfach ablegen“ ist nicht eingeschaltet oder Microsoft 365 ist nicht verbunden.');
  if (d.status !== 'entwurf') throw bad('Der Entwurf ist nicht mehr offen.');
  const mb = m365.mailboxForArea(d.area_id);
  const recipients = parseJson(d.recipients, []);
  const id = requestApproval({ actionType: 'postfach_entwurf', payload: { kind: 'postfach_entwurf', area_id: d.area_id, draft_id: d.id, mailbox: mb, subject: d.subject, body: d.body },
    summary: `Entwurf „${d.subject || '(ohne Betreff)'}“ im Postfach ${mb} ablegen (nicht versenden)`, recipients, taskId: d.task_id, user });
  return { approvalId: id };
});

// ---------- Datenschutz-Auskunft (NFA-12, Art. 15 DSGVO) ----------

function personHits(name) {
  const like = `%${name}%`;
  const hits = [];
  const add = (kind, rows, fmt) => rows.forEach(r => hits.push({ kind, ...fmt(r) }));
  add('Aufgabe', q.all(`SELECT t.id, t.title, t.area_id, a.name AS area, t.created_at, t.data_class FROM tasks t JOIN areas a ON a.id = t.area_id WHERE t.title LIKE ? OR t.description LIKE ? OR t.waiting_who LIKE ? OR t.lessons LIKE ?`, like, like, like, like),
    r => ({ id: r.id, title: r.title, area: r.area, date: r.created_at, link: `#/aufgabe/${r.id}`, data_class: r.data_class }));
  add('Teilschritt', q.all(`SELECT s.task_id, s.title, t.title AS task FROM task_steps s JOIN tasks t ON t.id = s.task_id WHERE s.title LIKE ? OR s.note LIKE ? OR s.description LIKE ?`, like, like, like),
    r => ({ id: r.task_id, title: `${r.title} (in „${r.task}“)`, link: `#/aufgabe/${r.task_id}` }));
  add('Kommentar', q.all(`SELECT c.task_id, c.body, c.created_at FROM comments c WHERE c.body LIKE ?`, like),
    r => ({ id: r.task_id, title: r.body.slice(0, 140), date: r.created_at, link: `#/aufgabe/${r.task_id}` }));
  add('Eingang', q.all(`SELECT id, subject, sender, received_at, status FROM inbox WHERE sender LIKE ? OR subject LIKE ? OR body LIKE ?`, like, like, like),
    r => ({ id: r.id, title: `${r.subject} (von ${r.sender}, ${r.status})`, date: r.received_at, link: '#/eingang' }));
  add('Entwurf', q.all(`SELECT id, task_id, subject, created_at FROM drafts WHERE subject LIKE ? OR body LIKE ? OR recipients LIKE ?`, like, like, like),
    r => ({ id: r.id, title: r.subject, date: r.created_at, link: r.task_id ? `#/aufgabe/${r.task_id}` : '#/entwuerfe' }));
  add('Datei', q.all(`SELECT id, filename, doc_date, data_class FROM files WHERE deleted_at IS NULL AND (filename LIKE ? OR issuer LIKE ? OR occasion LIKE ? OR text_content LIKE ?)`, like, like, like, like),
    r => ({ id: r.id, title: r.filename, date: r.doc_date, link: `/api/files/${r.id}/download`, data_class: r.data_class }));
  add('Sponsor', q.all(`SELECT id, company, contact_name FROM sponsors WHERE company LIKE ? OR contact_name LIKE ? OR notes LIKE ?`, like, like, like),
    r => ({ id: r.id, title: `${r.company}${r.contact_name ? ' – ' + r.contact_name : ''}`, link: '#/sponsoren' }));
  add('Termin', q.all(`SELECT id, title, date FROM events WHERE title LIKE ? OR notes LIKE ?`, like, like),
    r => ({ id: r.id, title: r.title, date: r.date, link: '#/kalender' }));
  add('Konto', q.all(`SELECT id, name, login, created_at FROM users WHERE name LIKE ?`, like),
    r => ({ id: r.id, title: `${r.name} (${r.login})`, date: r.created_at, link: '#/admin' }));
  add('Protokoll', q.all(`SELECT id, at, summary FROM audit_log WHERE summary LIKE ? ORDER BY id DESC LIMIT 200`, like),
    r => ({ id: r.id, title: r.summary.slice(0, 160), date: r.at, link: '#/protokoll' }));
  return hits;
}

get('/api/privacy/search', ({ user, query }) => {
  requireAdmin(user);
  const name = str(query.name, { required: true, max: 120, name: 'Name' });
  if (name.length < 3) throw bad('Bitte mindestens drei Zeichen angeben.');
  const hits = personHits(name);
  audit(user, { entity: 'datenschutz', action: 'auskunft', summary: `Datenschutz-Auskunft: Suche nach „${name}“ (${hits.length} Fundstellen)` });
  if (query.format === 'csv') {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Art', 'Nr', 'Inhalt', 'Datum', 'Datenklasse'].map(esc).join(';'), ...hits.map(h => [h.kind, h.id, h.title, h.date ? h.date.slice(0, 10) : '', h.data_class || ''].map(esc).join(';'))];
    return { __file: true, data: '﻿' + lines.join('\r\n'), filename: `Datenschutz-Auskunft ${name} ${today()}.csv`, mime: 'text/csv; charset=utf-8' };
  }
  return { name, hits };
});
