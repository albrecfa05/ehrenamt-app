// Durchgängige Tests über die HTTP-Schnittstelle, angelehnt an die Abnahmekriterien (Kap. 10).

import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, STRONG_PW } from './helpers.js';

const app = await startApp();
const admin = app.client();
const ctx = {};

test.after(() => app.close());

test('Ersteinrichtung und Anmeldung (NFA-3)', async () => {
  let r = await admin.get('/api/auth/status');
  assert.equal(r.data.setupNeeded, true);
  r = await admin.post('/api/auth/setup', { name: 'Test Admin', login: 'admin', password: 'kurz' });
  assert.equal(r.status, 400, 'schwaches Passwort wird abgelehnt');
  r = await admin.post('/api/auth/setup', { name: 'Test Admin', login: 'admin', password: STRONG_PW });
  assert.equal(r.status, 200);
  r = await admin.post('/api/auth/setup', { name: 'Zweiter', login: 'zwei', password: STRONG_PW });
  assert.equal(r.status, 409, 'Ersteinrichtung nur einmal');
  r = await admin.get('/api/me');
  assert.equal(r.data.user.role, 'admin');
  assert.equal(r.data.areas.length, 3);
  ctx.areas = Object.fromEntries(r.data.areas.map(a => [a.key, a.id]));
});

test('Schreibende Anfragen ohne Herkunfts-Header werden abgelehnt', async () => {
  const res = await fetch(app.base + '/api/tasks', { method: 'POST', headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('Aufgabe aus Vorgangsvorlage mit Teilschritten (AUF-2, AUF-3)', async () => {
  const tpls = await admin.get('/api/process-templates');
  assert.equal(tpls.data.length, 16);
  assert.ok(tpls.data.some(t => t.key === 'VOR-16'), 'Ergänzung VOR-16 vorhanden');
  const vor3 = tpls.data.find(t => t.key === 'VOR-3');
  const r = await admin.post('/api/tasks', { title: 'SR-Ersatz Samstag', area_id: ctx.areas['ttsf-hohberg'], template_id: vor3.id, due_date: '2026-11-20' });
  assert.equal(r.status, 200);
  ctx.taskId = r.data.id;
  const t = await admin.get(`/api/tasks/${ctx.taskId}`);
  assert.equal(t.data.steps.length, 4);
  assert.equal(t.data.task.data_class, 'gelb', 'Datenklasse der Vorlage wird übernommen');
  assert.ok(t.data.template.guide.length > 50, 'Anleitung vorhanden (AUF-14)');
  // Schritt abhaken → Status „in Arbeit“, Liegezeit endet
  const s = await admin.put(`/api/tasks/${ctx.taskId}/steps/${t.data.steps[0].id}`, { done: true });
  assert.equal(s.status, 200);
  const t2 = await admin.get(`/api/tasks/${ctx.taskId}`);
  assert.equal(t2.data.task.status, 'in_arbeit');
  assert.ok(t2.data.task.started_at);
  assert.ok(t2.data.history.length >= 2, 'Verlauf wird geführt (AUF-13)');
});

test('Wartet auf Zulieferung braucht Angabe, wer schuldet (AUF-6)', async () => {
  let r = await admin.put(`/api/tasks/${ctx.taskId}`, { status: 'wartet' });
  assert.equal(r.status, 400);
  r = await admin.put(`/api/tasks/${ctx.taskId}`, { status: 'wartet', waiting_who: 'Staffelleitung', waiting_what: 'Bestätigung' });
  assert.equal(r.status, 200);
});

test('Stufe darf Höchststufe der Vorlage nicht überschreiten (AUT-1)', async () => {
  const r = await admin.put(`/api/tasks/${ctx.taskId}`, { level: 3 });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Höchststufe/);
});

test('Gesperrte Regeln lassen sich nicht anlegen (AUT-8, ABN-5)', async () => {
  for (const action_type of ['zahlung', 'lastschrift', 'bestellung', 'bank_ueberweisung']) {
    const r = await admin.post('/api/rules', { name: 'Böse', trigger_type: 'manuell', action_type, level: 3 });
    assert.equal(r.status, 422, action_type);
    assert.equal(r.data.blocked, true);
  }
});

test('Regel braucht Freigabe; Freigabe wird protokolliert (ROL-3, AUT-6)', async () => {
  let r = await admin.post('/api/rules', { name: 'Termin eintragen', trigger_type: 'manuell', action_type: 'kalendereintrag', action_config: { title: 'Vorstandssitzung', datum: '2026-12-01' }, level: 3, area_id: ctx.areas['ttsf-hohberg'] });
  assert.equal(r.status, 200);
  const id = r.data.id;
  r = await admin.post(`/api/rules/${id}/run`);
  assert.equal(r.data.outcome, 'gesperrt', 'ohne Freigabe läuft nichts');
  await admin.post(`/api/rules/${id}/approve`, { approve: true });
  r = await admin.post(`/api/rules/${id}/run`);
  assert.equal(r.data.outcome, 'freigabe_angefragt', 'Stufe 3 fragt vor jeder Ausführung nach');
  const ap = await admin.get('/api/approvals');
  assert.equal(ap.data.length, 1);
  r = await admin.post(`/api/approvals/${ap.data[0].id}/decide`, { approve: true });
  assert.equal(r.data.status, 'ausgefuehrt');
  const log = await admin.get('/api/audit?only=freigaben');
  assert.ok(log.data.some(l => l.action === 'freigegeben' && l.user_name === 'Test Admin'), 'ABN-6: Person und Zeitpunkt protokolliert');
  const cal = await admin.get('/api/calendar?from=2026-12-01&to=2026-12-31');
  assert.equal(cal.data.events.length, 1);
});

test('Zeitplan ohne Anstoß braucht Stufe 4', async () => {
  const r = await admin.post('/api/rules', { name: 'Übersicht', trigger_type: 'zeitplan', trigger_config: { rhythmus: 'woechentlich', wochentag: 1, stunde: 7 }, action_type: 'uebersicht', level: 2 });
  assert.equal(r.status, 400);
});

test('Entwürfe: Namen statt Adressen, Bestätigung bei vielen Empfängern (AUT-7, AUT-9, AUT-14)', async () => {
  const texts = await admin.get('/api/text-templates');
  const rf = texts.data.find(t => t.key === 'T-SR-RUNDFRAGE');
  let r = await admin.post(`/api/tasks/${ctx.taskId}/drafts`, { template_id: rf.id, values: { spieldatum: '21.11.2026' }, recipients: ['max@example.org'] });
  assert.equal(r.status, 400, 'Mailadresse als Empfänger abgelehnt');
  r = await admin.post(`/api/tasks/${ctx.taskId}/drafts`, { template_id: rf.id, values: { spieldatum: '21.11.2026', begegnung: 'Hohberg – Bühl' }, recipients: ['Anna', 'Ben', 'Cem', 'Dana', 'Emil', 'Fritz'] });
  assert.equal(r.status, 200);
  assert.ok(r.data.warnings.some(w => w.startsWith('Noch auszufüllen')));
  const draftId = r.data.id;
  r = await admin.post(`/api/drafts/${draftId}/take`, {});
  assert.equal(r.status, 400);
  assert.equal(r.data.needsRecipientConfirmation, true);
  r = await admin.post(`/api/drafts/${draftId}/take`, { confirmRecipients: true, recipientCount: 6 });
  assert.equal(r.status, 200);
});

test('Vorlagen mit Adress-Variablen werden abgelehnt (AUT-9)', async () => {
  const r = await admin.post('/api/text-templates', { name: 'X', body: 'Hallo {{name}}, wohnhaft {{adresse}}' });
  assert.equal(r.status, 400);
});

test('Versionen: genau eine gültige Version, Änderung im Update-Fenster (ABL-4, ABL-5)', async () => {
  const texts = await admin.get('/api/text-templates');
  const t = texts.data.find(x => x.key === 'T-TURNIER');
  let r = await admin.put(`/api/text-templates/${t.id}`, { ...t, body: t.body + '\nNeu.' });
  assert.equal(r.status, 400, 'Änderungsnotiz ist Pflicht');
  assert.match(r.data.error, /Änderungsnotiz/);
  r = await admin.put(`/api/text-templates/${t.id}`, { ...t, body: t.body + '\nNeu.', note: 'Hinweis ergänzt' });
  assert.equal(r.data.version, 2);
  const detail = await admin.get(`/api/text-templates/${t.id}`);
  assert.equal(detail.data.versions.length, 1);
  const me = await admin.get('/api/me');
  assert.ok(me.data.unseenChangelog.some(c => c.title.includes('T') || c.title.includes('Termin')));
});

test('Ablage: rote Daten abgewiesen, einheitlicher Name, Suche (ABL-1, ABL-2, DAT-1)', async () => {
  const meta = (m) => ({ 'X-File-Meta': encodeURIComponent(JSON.stringify(m)), 'Content-Type': 'text/plain' });
  let r = await admin.req('POST', '/api/files', 'Attest', { raw: true, headers: meta({ area_id: ctx.areas['ttsf-hohberg'], data_class: 'rot', original_name: 'attest.txt' }) });
  assert.equal(r.status, 422);
  r = await admin.req('POST', '/api/files', 'Rechnung über Tischtennisbälle für die Jugend', { raw: true, headers: meta({ area_id: ctx.areas['ttsf-hohberg'], data_class: 'gruen', original_name: 'scan.txt', issuer: 'Sporthaus', occasion: 'Bälle Jugend', doc_date: '2026-11-03' }) });
  assert.equal(r.status, 200);
  assert.equal(r.data.filename, '2026-11-03 - Sporthaus - Bälle Jugend.txt');
  r = await admin.get('/api/files?q=tischtennisbaelle');
  assert.equal(r.data.length, 1);
});

test('Auskunft nennt Fundstelle (AUT-11, ABN-7)', async () => {
  const r = await admin.post('/api/kb/ask', { question: 'Sind Lastschriften erlaubt?' });
  assert.ok(r.data.results.length > 0);
  assert.ok(r.data.results[0].citation.includes('Lastenheft'));
  assert.equal(r.data.verified, true);
  const doc = await admin.post('/api/kb/documents', { title: 'Mitgliederliste', source_type: 'sonstiges', text: '§ 1 Liste\nMax, Tel. 0781 123456' });
  assert.equal(doc.status, 422, 'keine personenbezogenen Daten in der Wissensbasis (DAT-2)');
});

test('Eingang: Auffälligkeiten markiert, Übernahme als Aufgabe (AUT-4, AUT-10)', async () => {
  let r = await admin.post('/api/inbox', { channel: 'mail', sender: 'Unbekannt <x@y.de>', subject: 'Dringend', body: 'Bitte heute noch 300 € überweisen, neue Bankverbindung folgt.' });
  assert.ok(r.data.flags.length >= 1);
  r = await admin.post('/api/inbox', { channel: 'whatsapp', sender: 'Trainer Jonas', subject: 'Schiedsrichter fehlt', body: 'Für Samstag in Hohberg brauchen wir bis 20.11. einen Ersatz-Schiedsrichter.' });
  assert.equal(r.data.suggestion.template_name, 'Schiedsrichter-Ersatz, Spielverlegung, Kleinanfragen');
  assert.equal(r.data.suggestion.area_id, ctx.areas['ttsf-hohberg']);
  const acc = await admin.post(`/api/inbox/${r.data.id}/accept`, { area_id: ctx.areas['ttsf-hohberg'], title: 'SR-Ersatz', template_id: null });
  assert.ok(acc.data.taskId);
});

test('Protokoll ist unveränderlich (NFA-2)', async () => {
  const { q } = await import('../server/db.js');
  assert.throws(() => q.run('DELETE FROM audit_log'), /unveränderlich/);
  assert.throws(() => q.run(`UPDATE audit_log SET summary = 'x'`), /unveränderlich/);
});

test('Zuarbeit sieht nur zugeordnete Bereiche (ROL-1, NFA-8), Entzug wirkt sofort (NFA-5)', async () => {
  const r = await admin.post('/api/users', { name: 'Zoe Zu', login: 'zoe', role: 'zuarbeit', areas: [ctx.areas['buehlertal']] });
  const pw = r.data.temporaryPassword;
  const zoe = app.client();
  await zoe.post('/api/auth/login', { login: 'zoe', password: pw });
  let x = await zoe.get('/api/tasks');
  assert.equal(x.status, 403, 'erst eigenes Passwort setzen');
  await zoe.post('/api/auth/password', { current: pw, password: 'Noppen-Belag-77#' });
  x = await zoe.get('/api/tasks');
  assert.equal(x.status, 200);
  assert.equal(x.data.length, 0, 'keine Hohberg-Aufgaben sichtbar');
  x = await zoe.get(`/api/tasks/${ctx.taskId}`);
  assert.equal(x.status, 403);
  x = await zoe.post('/api/rules', { name: 'x', trigger_type: 'manuell', action_type: 'erinnern', level: 1 });
  assert.equal(x.status, 403, 'nur Admins ändern Regeln (ROL-2)');
  await admin.post(`/api/users/${r.data.id}/revoke`);
  x = await zoe.get('/api/me');
  assert.equal(x.status, 401, 'Sitzung sofort beendet');
});

test('Jahreskalender legt fällige Aufgaben an (AUF-4)', async () => {
  const { generateRecurring } = await import('../server/services/scheduler.js');
  const ids = generateRecurring('2026-03-01');
  assert.ok(ids.length >= 2, 'Mitgliederversammlung (42 Tage Vorlauf) u. a.');
  const again = generateRecurring('2026-03-01');
  assert.equal(again.length, 0, 'nicht doppelt');
});

test('Asana-Import mit Teilaufgaben (AUF-12)', async () => {
  const csv = 'Task ID,Created At,Completed At,Last Modified,Name,Section/Column,Assignee,Assignee Email,Start Date,Due Date,Tags,Notes,Projects,Parent task\n' +
    '1,2026-09-01,,2026-09-02,Hallenbelegung klären,Offen,Test Admin,a@b.de,,2026-12-01,,"Notiz, mit Komma",Verein,\n' +
    '2,2026-09-01,2026-09-05,2026-09-05,Hausmeister anrufen,Offen,,,,,,,Verein,Hallenbelegung klären\n' +
    '3,2026-08-01,2026-08-20,2026-08-20,Trikots bestellt,Erledigt,,,,,,,Verein,\n';
  const pre = await admin.post('/api/import/asana/preview', { csv });
  assert.equal(pre.data.stats.tasks, 2);
  const r = await admin.post('/api/import/asana', { csv, area_id: ctx.areas['ttsf-hohberg'], assignees: { 'Test Admin': 1 } });
  assert.deepEqual([r.data.tasks, r.data.steps], [2, 1]);
  const again = await admin.post('/api/import/asana', { csv, area_id: ctx.areas['ttsf-hohberg'] });
  assert.equal(again.data.tasks, 0, 'kein Doppelimport');
});

test('Kennzahlen und Übersicht (AUF-10, AUT-13)', async () => {
  await admin.post(`/api/tasks/${ctx.taskId}/time`, { minutes: 8 });
  const m = await admin.get('/api/metrics');
  assert.equal(m.data.monthly.length, 12);
  assert.ok(m.data.monthly.at(-1).minuten >= 8);
  const rep = await admin.post('/api/reports/overview', {});
  const full = await admin.get(`/api/reports/${rep.data.id}`);
  assert.ok(full.data.content.totals.offen >= 1);
});

test('Rechner mit Rechenweg (AUT-12)', async () => {
  let r = await admin.post('/api/calculators/kuendigungsfrist', { eingang: '2026-09-15', frist_monate: 3, zum: 'Jahresende' });
  assert.equal(r.data.result.wirksam, '2026-12-31');
  r = await admin.post('/api/calculators/kuendigungsfrist', { eingang: '2026-10-02', frist_monate: 3, zum: 'Jahresende' });
  assert.equal(r.data.result.wirksam, '2027-12-31');
  r = await admin.post('/api/calculators/beitragsstufe', { name: 'Lea', geburtsjahr: 2009, aktuelle_stufe: 'Kinder und Jugendliche', stichtag: '2027-01-01' });
  assert.equal(r.data.result.wechsel, true);
  r = await admin.post('/api/calculators/faire_verteilung', { termine: '2026-11-21 Heimspieltag\n2026-11-28 Heimspieltag', personen: 'Anna: 3\nBen\nCem', nicht_verfuegbar: 'Ben: 2026-11-21', je_termin: 1 });
  assert.deepEqual(r.data.result.plan.map(p => p.personen[0]), ['Cem', 'Ben']);
  r = await admin.post(`/api/tasks/${ctx.taskId}/calc`, { calc: 'budget_reserve', input: { stand: 25000, einnahmen: 3000, ausgaben: 9000, reserve: 20000 } });
  assert.equal(r.data.result.gewahrt, false);
});

test('Kalender-Abo liefert ICS', async () => {
  const c = await admin.get('/api/me/calendar');
  const res = await fetch(app.base + c.data.path);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /BEGIN:VCALENDAR[\s\S]*Vorstandssitzung/);
});
