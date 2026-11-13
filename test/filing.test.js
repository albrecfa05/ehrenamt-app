// Tests: Eingangs- und Ablageregeln, Themen-Ordner, Nachholen verpasster Zeitplan- und Frist-Läufe.

import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, STRONG_PW } from './helpers.js';

const app = await startApp();
const admin = app.client();
const ctx = {};
test.after(() => app.close());

/** Baut eine .eml-Datei mit optionalem Anhang. */
function eml({ from, subject, body = 'Hallo zusammen,\nanbei die Unterlagen.', file = null }) {
  const lines = [`From: ${from}`, `Subject: ${subject}`, 'Date: Thu, 12 Nov 2026 10:00:00 +0100', 'MIME-Version: 1.0'];
  if (!file) return [...lines, 'Content-Type: text/plain; charset=utf-8', '', body, ''].join('\r\n');
  return [...lines, 'Content-Type: multipart/mixed; boundary="b1"', '', '--b1', 'Content-Type: text/plain; charset=utf-8', '', body, '--b1',
    `Content-Type: application/octet-stream; name="${file.name}"`, `Content-Disposition: attachment; filename="${file.name}"`, 'Content-Transfer-Encoding: base64', '',
    Buffer.from(file.content).toString('base64'), '--b1--', ''].join('\r\n');
}
const upload = (m) => admin.req('POST', '/api/inbox/eml', Buffer.from(eml(m), 'latin1'), { raw: true, headers: { 'Content-Type': 'application/octet-stream' } });

test('Einrichtung', async () => {
  await admin.post('/api/auth/setup', { name: 'Test Admin', login: 'admin', password: STRONG_PW });
  const me = await admin.get('/api/me');
  ctx.areas = Object.fromEntries(me.data.areas.map(a => [a.key, a.id]));
  const tpls = await admin.get('/api/process-templates');
  ctx.vor5 = tpls.data.find(t => t.key === 'VOR-5').id;
});

test('Regeln werden geprüft', async () => {
  let r = await admin.post('/api/filing-rules', { name: 'Leer', folder: 'X' });
  assert.equal(r.status, 400, 'ohne Bedingung abgelehnt');
  r = await admin.post('/api/filing-rules', { name: 'Adresse', sender_contains: 'max@gmx.de' });
  assert.equal(r.status, 400, 'keine vollständige Mailadresse (AUT-9)');
  r = await admin.post('/api/filing-rules', { name: 'Rot', sender_contains: 'arzt', data_class: 'rot' });
  assert.equal(r.status, 400);
});

test('„Nur ablegen“: Anhang landet im Ordner, Mail verschwindet, kein Duplikat', async () => {
  const r = await admin.post('/api/filing-rules', {
    name: 'Hallenpläne der Gemeinde', pos: 10, sender_contains: 'gemeinde-hohberg.de', file_types: '.PDF', target_area_id: ctx.areas['ttsf-hohberg'],
    folder: ' Hallenbelegung / Pläne ', data_class: 'gruen', occasion: 'Hallenplan {{datei}}', mode: 'ablegen', dismiss_mail: true,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const rules = await admin.get('/api/filing-rules');
  assert.equal(rules.data.rules[0].folder, 'Hallenbelegung/Pläne');
  assert.equal(rules.data.rules[0].file_types, 'pdf');

  let up = await upload({ from: 'Gemeinde Hohberg <halle@gemeinde-hohberg.de>', subject: 'Belegung Rückrunde', file: { name: 'Rückrunde.pdf', content: '%PDF-1.4 Plan A' } });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal(up.data.filingRule.action, 'abgelegt');
  assert.equal(up.data.filingRule.dismissed, true);
  const files = await admin.get('/api/files?folder=Hallenbelegung');
  assert.equal(files.data.length, 1);
  assert.match(files.data[0].filename, /^2026-11-12 - Gemeinde Hohberg - Hallenplan Rückrunde\.pdf$/);
  assert.equal(files.data[0].data_class, 'gruen');
  assert.equal(files.data[0].task_id, null, 'ohne Aufgabe');
  const inbox = await admin.get('/api/inbox?status=abgelegt');
  assert.equal(inbox.data[0].sender_domain, 'gemeinde-hohberg.de');
  assert.ok(!JSON.stringify(inbox.data).includes('halle@'), 'vollständige Adresse wird nicht gespeichert');

  up = await upload({ from: 'Gemeinde Hohberg <halle@gemeinde-hohberg.de>', subject: 'Nochmal', file: { name: 'Kopie.pdf', content: '%PDF-1.4 Plan A' } });
  const again = await admin.get('/api/files?folder=Hallenbelegung');
  assert.equal(again.data.length, 1, 'gleiche Datei nicht doppelt abgelegt');
});

test('Auffällige Mails werden nie automatisch einsortiert (AUT-10)', async () => {
  const up = await upload({ from: 'Fake <x@gemeinde-hohberg.de>', subject: 'Dringend', body: 'Bitte heute noch 500 € überweisen, neue Bankverbindung.', file: { name: 'rechnung.pdf', content: '%PDF evil' } });
  assert.equal(up.data.filingRule.action, 'ausgesetzt');
  const inbox = await admin.get('/api/inbox');
  const item = inbox.data.find(i => i.subject === 'Dringend');
  assert.ok(item, 'bleibt im Eingang');
  assert.equal(item.attachments[0].filed, undefined);
});

test('„Aufgabe anlegen“: Aufgabe mit Vorlage, Anhang im Ordner; Personendaten machen gelb', async () => {
  await admin.post('/api/filing-rules', { name: 'Sponsorenrechnungen', pos: 20, subject_contains: 'Rechnung, Sponsoring', target_area_id: ctx.areas['ttsf-hohberg'],
    folder: 'Sponsoring/Rechnungen', data_class: 'gruen', mode: 'aufgabe', template_id: ctx.vor5 });
  const up = await upload({ from: 'Bäckerei <info@baeckerei-beispiel.de>', subject: 'Rechnung Bandenwerbung 2026', body: 'Rückfragen gern unter 0781 123456.', file: { name: 'RE-2026-11.pdf', content: '%PDF rechnung' } });
  assert.equal(up.data.filingRule.action, 'aufgabe');
  const t = await admin.get(`/api/tasks/${up.data.filingRule.taskId}`);
  assert.equal(t.data.task.template_name, 'Bescheinigungen und Anträge');
  assert.equal(t.data.files.length, 1);
  const f = (await admin.get('/api/files?folder=Sponsoring')).data[0];
  assert.equal(f.folder, 'Sponsoring/Rechnungen');
  assert.equal(f.data_class, 'gelb', 'Telefonnummer in der Mail → gelb, trotz Regel „grün“');
});

test('„Vormerken“: Vorschau im Eingang, angewendet beim Übernehmen', async () => {
  await admin.post('/api/filing-rules', { name: 'Ausschreibungen', pos: 30, filename_contains: 'ausschreibung', folder: 'Turniere', data_class: 'gruen', mode: 'vormerken' });
  const up = await upload({ from: 'Bezirk <sport@tt-mittelbaden.de>', subject: 'Bezirksmeisterschaften', file: { name: 'Ausschreibung_BM.pdf', content: '%PDF bm' } });
  assert.equal(up.data.filingRule.action, 'vorgemerkt');
  const inbox = await admin.get('/api/inbox');
  const item = inbox.data.find(i => i.id === up.data.id);
  assert.equal(item.filing.rule.name, 'Ausschreibungen');
  assert.equal(item.filing.attachments[0].folder, 'Turniere');
  const acc = await admin.post(`/api/inbox/${item.id}/accept`, { area_id: ctx.areas['bezirk-mittelbaden'], title: 'BM ankündigen' });
  const t = await admin.get(`/api/tasks/${acc.data.taskId}`);
  assert.equal(t.data.task.data_class, 'gruen', 'nur grüne Anhänge, keine Personendaten → Aufgabe grün');
  const f = (await admin.get('/api/files?folder=Turniere')).data[0];
  assert.equal(f.task_id, acc.data.taskId);
});

test('Ablegen ohne Aufgabe von Hand', async () => {
  const up = await upload({ from: 'Jemand <a@b.de>', subject: 'Fotos', file: { name: 'team.txt', content: 'Teamfoto Beschreibung' } });
  const r = await admin.post(`/api/inbox/${up.data.id}/dismiss`, { file_attachments: true, area_id: ctx.areas['buehlertal'], folder: 'Fotos/2026', data_class: 'gelb' });
  assert.equal(r.data.filed, 1);
  const f = (await admin.get('/api/files?folder=Fotos')).data[0];
  assert.equal(f.folder, 'Fotos/2026');
  const folders = await admin.get('/api/files/folders');
  const names = folders.data.folders.map(x => x.folder);
  assert.ok(names.includes('Fotos') && names.includes('Fotos/2026') && names.includes('Sponsoring/Rechnungen'));
});

test('Probelauf zeigt, welche Regel greifen würde', async () => {
  const r = await admin.post('/api/filing-rules/test', { sender: 'Gemeinde <halle@gemeinde-hohberg.de>', subject: 'Neuer Plan', filenames: 'plan.pdf, foto.jpg' });
  assert.equal(r.data.rule.name, 'Hallenpläne der Gemeinde');
  assert.equal(r.data.files[0].folder, 'Hallenbelegung/Pläne');
  assert.equal(r.data.files[1].rule, null, 'jpg passt nicht zu „pdf“');
});

test('Regel ausschalten wirkt sofort', async () => {
  const rules = (await admin.get('/api/filing-rules')).data.rules;
  await admin.put(`/api/filing-rules/${rules[0].id}`, { active: false });
  const up = await upload({ from: 'Gemeinde <halle@gemeinde-hohberg.de>', subject: 'Plan 2', file: { name: 'Plan2.pdf', content: '%PDF plan 2' } });
  assert.equal(up.data.filingRule, undefined);
});

test('Verpasste Zeitplan- und Frist-Läufe werden nachgeholt', async () => {
  const { runScheduledRules, runDeadlineRules } = await import('../server/services/automation.js');
  const { q } = await import('../server/db.js');
  const rule = await admin.post('/api/rules', { name: 'Täglich 0 Uhr', trigger_type: 'zeitplan', trigger_config: { rhythmus: 'taeglich', stunde: 0 }, action_type: 'uebersicht', level: 4 });
  await admin.post(`/api/rules/${rule.data.id}/approve`, { approve: true });
  q.run('UPDATE rules SET approved_at = ? WHERE id = ?', new Date(Date.now() - 2 * 86_400_000).toISOString(), rule.data.id);
  const runs = () => q.get('SELECT COUNT(*) AS n FROM rule_runs WHERE rule_id = ?', rule.data.id).n;
  runScheduledRules(new Date());
  assert.equal(runs(), 1, 'Termin 0 Uhr wird beim nächsten Takt nachgeholt');
  runScheduledRules(new Date());
  assert.equal(runs(), 1, 'nicht doppelt');
  q.run('UPDATE rules SET approved_at = ?, last_run_at = NULL WHERE id = ?', new Date().toISOString(), rule.data.id);
  runScheduledRules(new Date());
  assert.equal(runs(), 1, 'Termine vor der Freigabe werden nicht nachgeholt');

  const d = new Date(); d.setDate(d.getDate() + 1);
  const task = await admin.post('/api/tasks', { area_id: ctx.areas['buehlertal'], title: 'Morgen fällig', due_date: d.toISOString().slice(0, 10) });
  const fr = await admin.post('/api/rules', { name: '3 Tage vorher', trigger_type: 'frist', trigger_config: { tage_vorher: 3 }, action_type: 'erinnern', level: 1 });
  await admin.post(`/api/rules/${fr.data.id}/approve`, { approve: true });
  runDeadlineRules(new Date());
  const n = q.get(`SELECT COUNT(*) AS n FROM rule_runs WHERE rule_id = ? AND trigger LIKE ?`, fr.data.id, `%#${task.data.id} %`).n;
  assert.equal(n, 1, 'Frist liegt innerhalb von 3 Tagen → Erinnerung, obwohl nicht genau 3 Tage');
  runDeadlineRules(new Date());
  assert.equal(q.get(`SELECT COUNT(*) AS n FROM rule_runs WHERE rule_id = ? AND trigger LIKE ?`, fr.data.id, `%#${task.data.id} %`).n, 1);
});
