// Tests der Verbindungen und neuen Automatisierungen gegen einen simulierten Microsoft-Graph- und ICS-Server.
// Prüft nebenbei, dass die App nie eine Mail versendet (kein Aufruf von /sendMail oder /send).

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// ---------- Simulierter Microsoft- und Kalender-Server ----------
const calls = [];
const mails = [];
let icsText = '';
const fake = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = decodeURIComponent(req.url);
  calls.push(`${req.method} ${url}`);
  const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (url.includes('/oauth2/v2.0/token')) return json({ access_token: 'testtoken', expires_in: 3600 });
  if (req.headers.authorization !== 'Bearer testtoken' && url.startsWith('/graph')) return json({ error: { message: 'unauthorized' } }, 401);
  if (url.endsWith('/ics/team.ics')) { res.writeHead(200, { 'Content-Type': 'text/calendar' }); return res.end(icsText); }
  if (/\/mailFolders\/inbox\?/.test(url)) return json({ displayName: 'Posteingang', totalItemCount: mails.length });
  if (/\/mailFolders\/inbox\/messages/.test(url)) return json({ value: mails.filter(m => !m.taken).map(m => { m.taken = true; return m.msg; }) });
  if (/\/messages\/[^/]+\/attachments/.test(url)) return json({ value: [{ '@odata.type': '#microsoft.graph.fileAttachment', name: 'Spielbericht.txt', contentType: 'text/plain', contentBytes: Buffer.from('Ergebnis 9:5').toString('base64') }] });
  if (req.method === 'POST' && /\/users\/[^/]+\/messages$/.test(url)) return json({ id: 'draft-1', conversationId: 'conv-42', webLink: 'https://outlook/draft-1' }, 201);
  if (req.method === 'POST' && /\/events$/.test(url)) return json({ id: 'event-1' }, 201);
  if (req.method === 'PUT' && /\/content$/.test(url)) return json({ id: 'file-1', webUrl: `https://sharepoint/${url}`, size: body.length }, 201);
  if (/\/drive\?/.test(url)) return json({ name: 'Dokumente' });
  json({ error: { message: `unbekannt: ${url}` } }, 404);
});
await new Promise(r => fake.listen(0, '127.0.0.1', r));
const fakeBase = `http://127.0.0.1:${fake.address().port}`;
process.env.M365_TENANT_ID = 'tenant-test';
process.env.M365_CLIENT_ID = 'client-test';
process.env.M365_CLIENT_SECRET = 'secret-test';
process.env.M365_LOGIN_URL = fakeBase;
process.env.M365_GRAPH_URL = `${fakeBase}/graph`;

const { startApp, STRONG_PW } = await import('./helpers.js');
const app = await startApp();
const admin = app.client();
const ctx = {};
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

test.after(async () => { await app.close(); fake.close(); });

test('Einrichtung, Katalog und Microsoft-365-Verbindung', async () => {
  await admin.post('/api/auth/setup', { name: 'Test Admin', login: 'admin', password: STRONG_PW });
  const me = await admin.get('/api/me');
  ctx.areas = Object.fromEntries(me.data.areas.map(a => [a.key, a.id]));
  let cat = await admin.get('/api/catalog');
  assert.ok(cat.data.length >= 15);
  const pf = cat.data.find(c => c.key === 'postfach_abruf');
  assert.equal(pf.active, false);
  assert.ok(pf.missing.some(m => m.includes('Microsoft 365')), 'Voraussetzung wird angezeigt');
  let r = await admin.put('/api/connections/m365', { mailboxes: [{ address: 'info@ttsf-test.de', area_id: ctx.areas['ttsf-hohberg'] }], kalender_postfach: 'info@ttsf-test.de', ablage_ziel: 'users/info@ttsf-test.de/drive', ablage_ordner: 'App' });
  assert.equal(r.data.configured, true);
  r = await admin.put('/api/connections/m365', { mailboxes: [{ address: 'keine-adresse' }] });
  assert.equal(r.status, 400);
  await admin.put('/api/connections/m365', { mailboxes: [{ address: 'info@ttsf-test.de', area_id: ctx.areas['ttsf-hohberg'] }], kalender_postfach: 'info@ttsf-test.de', ablage_ziel: 'users/info@ttsf-test.de/drive', ablage_ordner: 'App' });
  r = await admin.put('/api/catalog', { postfach_abruf: { enabled: true }, postfach_entwuerfe: { enabled: true }, m365_kalender: { enabled: true }, ablage_spiegeln: { enabled: true, params: { nur_gruen: true } } });
  assert.ok(r.data.changes.length >= 4);
  cat = await admin.get('/api/catalog');
  assert.equal(cat.data.find(c => c.key === 'postfach_abruf').active, true);
  const t = await admin.post('/api/connections/m365/test');
  assert.equal(t.data.ok, true, JSON.stringify(t.data));
});

test('Rechte der App-Registrierung: Zugangsdaten nie in der Oberfläche', async () => {
  const r = await admin.get('/api/connections');
  const text = JSON.stringify(r.data);
  assert.ok(!text.includes('secret-test'));
  assert.equal(r.data.m365.credentials, true);
});

test('Postfach-Abruf mit Anhang, Übernahme legt Anhang ab (AUT-4, ABL-1)', async () => {
  mails.push({ msg: { id: 'm1', subject: 'Bilder und Bericht vom Heimspiel Hohberg', from: { emailAddress: { name: 'Jonas Trainer', address: 'jonas@example.org' } },
    receivedDateTime: new Date().toISOString(), body: { content: 'Anbei der Bericht.' }, hasAttachments: true, conversationId: 'conv-other' } });
  const r = await admin.post('/api/inbox/poll');
  assert.equal(r.data.created, 1);
  const again = await admin.post('/api/inbox/poll');
  assert.equal(again.data.created, 0, 'kein doppelter Eingang');
  const inbox = await admin.get('/api/inbox');
  const item = inbox.data.find(i => i.subject.startsWith('Bilder'));
  assert.equal(item.sender, 'Jonas Trainer', 'nur der Name, keine Mailadresse (AUT-9)');
  assert.equal(item.attachments.length, 1);
  const acc = await admin.post(`/api/inbox/${item.id}/accept`, { area_id: ctx.areas['ttsf-hohberg'], title: 'Spielbericht Heimspiel' });
  const task = await admin.get(`/api/tasks/${acc.data.taskId}`);
  assert.equal(task.data.files.length, 1);
  assert.match(task.data.files[0].filename, /Jonas Trainer - Spielbericht\.txt$/);
  assert.equal(task.data.task.data_class, 'gelb');
  ctx.taskId = acc.data.taskId;
});

test('Entwurf ins Postfach nur nach Freigabe, Vorgangsnummer im Betreff, kein Versand (AUT-14)', async () => {
  const texts = await admin.get('/api/text-templates');
  const tpl = texts.data.find(t => t.key === 'T-SPIELBERICHT');
  const d = await admin.post(`/api/tasks/${ctx.taskId}/drafts`, { template_id: tpl.id, values: { mannschaft: 'Herren I' } });
  const before = calls.length;
  const req = await admin.post(`/api/drafts/${d.data.id}/mailbox`);
  assert.ok(req.data.approvalId);
  assert.equal(calls.slice(before).filter(c => c.startsWith('POST') && c.includes('/messages')).length, 0, 'vor der Freigabe passiert nichts');
  const dec = await admin.post(`/api/approvals/${req.data.approvalId}/decide`, { approve: true });
  assert.equal(dec.data.status, 'ausgefuehrt', JSON.stringify(dec.data));
  const draft = (await admin.get(`/api/tasks/${ctx.taskId}`)).data.drafts.find(x => x.id === d.data.id);
  assert.match(draft.subject, new RegExp(`\\[#${ctx.taskId}\\]$`));
  assert.equal(draft.status, 'uebernommen');
  assert.ok(!calls.some(c => /sendMail|\/send\b/.test(c)), 'nie versendet');
});

test('Antwort wird der Aufgabe zugeordnet und beendet „Wartet“', async () => {
  await admin.put(`/api/tasks/${ctx.taskId}`, { status: 'wartet', waiting_who: 'Pressewart' });
  mails.push({ msg: { id: 'm2', subject: `AW: Herren I: [[ergebnis]] gegen [[gegner]] [#${ctx.taskId}]`, from: { emailAddress: { name: 'Presse Wart' } },
    receivedDateTime: new Date(Date.now() + 1000).toISOString(), body: { content: 'Danke, ist online.\n> alter Text' }, hasAttachments: false, conversationId: 'conv-42' } });
  const r = await admin.post('/api/inbox/poll');
  assert.equal(r.data.created, 1);
  const t = await admin.get(`/api/tasks/${ctx.taskId}`);
  assert.equal(t.data.task.status, 'in_arbeit');
  assert.ok(t.data.comments.some(c => c.body.includes('Antwort von Presse Wart') && !c.body.includes('alter Text')));
});

test('Termin in Outlook und Datei nach SharePoint nur nach Freigabe (Stufe 3)', async () => {
  const ev = await admin.post('/api/events', { area_id: ctx.areas['ttsf-hohberg'], title: 'Vorstandssitzung', date: day(10), time: '19:30' });
  const a = await admin.post(`/api/events/${ev.data.id}/outlook`);
  let r = await admin.post(`/api/approvals/${a.data.approvalId}/decide`, { approve: true });
  assert.equal(r.data.status, 'ausgefuehrt');
  assert.ok(calls.some(c => c.startsWith('POST') && c.endsWith('/users/info@ttsf-test.de/events')));
  // Grüne Datei → Kopie wird automatisch zur Freigabe vorgeschlagen
  const meta = { area_id: ctx.areas['ttsf-hohberg'], data_class: 'gruen', original_name: 'plan.txt', issuer: 'Gemeinde', occasion: 'Hallenplan' };
  await admin.req('POST', '/api/files', 'Hallenplan', { raw: true, headers: { 'X-File-Meta': encodeURIComponent(JSON.stringify(meta)), 'Content-Type': 'text/plain' } });
  const open = await admin.get('/api/approvals');
  const mirror = open.data.find(x => x.action_type === 'ablage_hochladen');
  assert.ok(mirror, 'Kopie vorgeschlagen');
  r = await admin.post('/api/approvals/decide-batch', { ids: [mirror.id], approve: true });
  assert.equal(r.data.results[0].status, 'ausgefuehrt', JSON.stringify(r.data));
  assert.ok(calls.some(c => c.startsWith('PUT') && c.includes('/App/TTSF Hohberg/')));
});

test('Postfach-Aktionen sind keine frei anlegbaren Regeln', async () => {
  const r = await admin.post('/api/rules', { name: 'x', trigger_type: 'manuell', action_type: 'postfach_entwurf', level: 3 });
  assert.equal(r.status, 400);
});

test('Spielplan-Abo: Termine, Heimspiel-Aufgabe, Verlegung (VOR-16)', async () => {
  const ics = (homeDate) => ['BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:spiel-1@click-tt', `DTSTART;TZID=Europe/Berlin:${homeDate.replace(/-/g, '')}T193000`, 'SUMMARY:TTSF Hohberg - TV Offenburg', 'LOCATION:Halle Hohberg', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:spiel-2@click-tt', `DTSTART:${day(12).replace(/-/g, '')}T170000Z`, 'SUMMARY:TTC Lahr - TTSF Hohberg', 'LOCATION:Lahr', 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');
  icsText = ics(day(5));
  const tpls = await admin.get('/api/process-templates');
  const vor16 = tpls.data.find(t => t.key === 'VOR-16');
  const pre = await admin.post('/api/feeds/preview', { url: `${fakeBase}/ics/team.ics`, home_pattern: 'Hohberg' });
  assert.equal(pre.data.upcoming, 2);
  assert.deepEqual(pre.data.sample.map(s => s.home), [true, false]);
  const f = await admin.post('/api/feeds', { area_id: ctx.areas['ttsf-hohberg'], name: 'Herren I', url: `${fakeBase}/ics/team.ics`, home_pattern: 'Hohberg', create_tasks: true, template_id: vor16.id, lead_days: 10 });
  let s = await admin.post(`/api/feeds/${f.data.id}/sync`);
  assert.equal(s.data.added, 2);
  assert.equal(s.data.tasks, 1, 'nur das Heimspiel bekommt eine Aufgabe');
  icsText = ics(day(6));
  s = await admin.post(`/api/feeds/${f.data.id}/sync`);
  assert.equal(s.data.changed, 1);
  const tasks = await admin.get('/api/tasks?q=Heimspiel');
  const t = tasks.data.find(x => x.title.includes('TV Offenburg'));
  assert.equal(t.due_date, day(6), 'Verlegung zieht die Frist nach');
  assert.equal(t.steps_total, 5);
});

test('Sponsor: Verlängerungsaufgabe vor Laufzeitende, nur einmal (VOR-6)', async () => {
  const r = await admin.post('/api/sponsors', { area_id: ctx.areas['ttsf-hohberg'], company: 'Bäckerei Beispiel', contact_name: 'Frau Muster', end_date: day(60), category: 'Bande' });
  assert.equal(r.status, 200);
  const bad = await admin.post('/api/sponsors', { area_id: ctx.areas['ttsf-hohberg'], company: 'X', contact_name: 'max@x.de' });
  assert.equal(bad.status, 400, 'nur Namen beim Ansprechpartner');
  const { sponsorJobs } = await import('../server/services/jobs.js');
  assert.equal(sponsorJobs(), 1);
  assert.equal(sponsorJobs(), 0);
  const list = await admin.get('/api/sponsors');
  assert.ok(list.data[0].open_task);
});

test('Katalog schaltet Abläufe wirklich ab', async () => {
  await admin.post('/api/tasks', { area_id: ctx.areas['buehlertal'], title: 'Überfällig', due_date: day(-10) });
  const { sendReminders } = await import('../server/services/scheduler.js');
  const { escalate } = await import('../server/services/jobs.js');
  await admin.put('/api/catalog', { erinnerungen: { enabled: false }, nachfassen: { enabled: false } });
  assert.equal(sendReminders(), 0);
  await admin.put('/api/catalog', { erinnerungen: { enabled: true } });
  assert.ok(sendReminders() >= 1);
  assert.ok(escalate() >= 1, 'Eskalation nach 5 Tagen');
  assert.equal(escalate(), 0, 'nur einmal');
});

test('meinVerein-Prüfung wartet auf die Datenschutzfrage, speichert den Export nicht', async () => {
  const csv = 'Vorname;Nachname;Geburtsdatum;Beitragsart\nLea;Klein;03.05.2009;Kinder und Jugendliche\nTom;Groß;01.01.1980;Aktive\n';
  let r = await admin.post('/api/members/check', { csv, stichtag: '2027-01-01' });
  assert.equal(r.status, 400);
  await admin.put('/api/settings', { datenschutz_gelb_freigegeben: true });
  await admin.put('/api/catalog', { mitglieder_pruefung: { enabled: true } });
  r = await admin.post('/api/members/check', { csv, stichtag: '2027-01-01' });
  assert.equal(r.data.checked, 2);
  assert.deepEqual(r.data.changes.map(c => [c.name, c.soll]), [['Lea Klein', 'Aktive']]);
  const t = await admin.post('/api/members/task', { area_id: ctx.areas['ttsf-hohberg'], stichtag: '2027-01-01', changes: r.data.changes });
  const task = await admin.get(`/api/tasks/${t.data.taskId}`);
  assert.ok(task.data.steps.some(s => s.title.startsWith('Lea Klein:')));
  assert.ok(!JSON.stringify(task.data).includes('03.05.2009'), 'Geburtsdatum wird nicht gespeichert');
});

test('Datenschutz-Auskunft findet alle Fundstellen (NFA-12)', async () => {
  const r = await admin.get('/api/privacy/search?name=Jonas');
  assert.ok(r.data.hits.some(h => h.kind === 'Eingang'));
  assert.ok(r.data.hits.some(h => h.kind === 'Datei'));
  const csv = await fetch(`${app.base}/api/privacy/search?name=Jonas&format=csv`, { headers: { Cookie: admin.cookie } });
  assert.match(await csv.text(), /Eingang/);
});

test('.eml mit Anhang wird gelesen', async () => {
  const eml = ['From: "Max Mustermann" <max@example.org>', 'Subject: =?utf-8?Q?Verlegungsanfrage_K=C3=BCrzell?=', 'Date: Tue, 10 Nov 2026 10:00:00 +0100',
    'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="b1"', '', '--b1', 'Content-Type: text/plain; charset=utf-8', '', 'Können wir das Spiel verlegen?', '--b1',
    'Content-Type: application/pdf; name="antrag.pdf"', 'Content-Disposition: attachment; filename="antrag.pdf"', 'Content-Transfer-Encoding: base64', '',
    Buffer.from('%PDF-1.4 test').toString('base64'), '--b1--', ''].join('\r\n');
  const r = await admin.req('POST', '/api/inbox/eml', Buffer.from(eml, 'latin1'), { raw: true, headers: { 'Content-Type': 'application/octet-stream' } });
  assert.equal(r.status, 200);
  const inbox = await admin.get('/api/inbox');
  const item = inbox.data.find(i => i.subject === 'Verlegungsanfrage Kürzell');
  assert.ok(item);
  assert.equal(item.attachments[0].name, 'antrag.pdf');
});
