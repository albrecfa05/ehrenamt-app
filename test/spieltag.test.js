// Senden aus der App, Heimspieltage (mehrere Spiele, Jugend ohne Schiedsrichter), Mitgliederliste und Auslosung.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tte-spieltag-'));
process.env.DISABLE_SCHEDULER = '1';

const sent = [];
let icsText = '';
const fake = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString('utf8');
  const url = decodeURIComponent(req.url);
  const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (url.includes('/oauth2/v2.0/token')) return json({ access_token: 't', expires_in: 3600 });
  if (url.endsWith('/sendMail')) { sent.push({ url, body: JSON.parse(body) }); res.writeHead(202); return res.end(); }
  if (url.endsWith('/team.ics')) { res.writeHead(200, { 'Content-Type': 'text/calendar' }); return res.end(icsText); }
  json({ value: [] });
});
await new Promise(r => fake.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${fake.address().port}`;
Object.assign(process.env, { M365_TENANT_ID: 't', M365_CLIENT_ID: 'c', M365_CLIENT_SECRET: 's', M365_LOGIN_URL: base, M365_GRAPH_URL: `${base}/graph` });

const { startApp, STRONG_PW } = await import('./helpers.js');
const app = await startApp();
const admin = app.client();
const ctx = {};
test.after(async () => { await app.close(); fake.close(); });

const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const ics = (events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flatMap(([uid, date, time, summary]) => ['BEGIN:VEVENT', `UID:${uid}`, `DTSTART;TZID=Europe/Berlin:${date.replace(/-/g, '')}T${time.replace(':', '')}00`, `SUMMARY:${summary}`, 'LOCATION:Sporthalle Musterhausen', 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

test('Senden aus der App: nur eingeschaltet, nach Prüfung, Adressen werden nicht gespeichert', async () => {
  await admin.post('/api/auth/setup', { name: 'Mia Muster', login: 'mia', password: STRONG_PW });
  const me = (await admin.get('/api/me')).data;
  ctx.area = me.areas.find(a => a.key === 'ttsf-hohberg').id;
  await admin.put('/api/connections/m365', { mailboxes: [{ address: 'vorstand@verein.example', area_id: ctx.area }] });
  const t = await admin.post('/api/tasks', { area_id: ctx.area, title: 'Elterninfo Rangliste' });
  ctx.task = t.data.id;
  const tpl = (await admin.get('/api/text-templates')).data.find(x => x.key === 'T-ELTERN');
  const dr = await admin.post(`/api/tasks/${ctx.task}/drafts`, { template_id: tpl.id });
  let r = await admin.post(`/api/drafts/${dr.data.id}/send`, { to: 'eltern@beispiel.example', geprueft: true });
  assert.equal(r.status, 400, 'standardmäßig aus');
  await admin.put('/api/catalog', { mail_senden: { enabled: true } });
  r = await admin.post(`/api/drafts/${dr.data.id}/send`, { to: 'eltern@beispiel.example' });
  assert.match(r.data.error, /geprüft/);
  r = await admin.post(`/api/drafts/${dr.data.id}/send`, { to: 'keine-adresse', geprueft: true });
  assert.match(r.data.error, /Keine gültige Adresse/);
  const many = Array.from({ length: 6 }, (_, i) => `e${i}@beispiel.example`).join(', ');
  r = await admin.post(`/api/drafts/${dr.data.id}/send`, { to: many, geprueft: true });
  assert.equal(r.data.needsRecipientConfirmation, true, 'ab 5 Empfängern ausdrücklich bestätigen');
  r = await admin.post(`/api/drafts/${dr.data.id}/send`, { to: 'eltern@beispiel.example, trainer@beispiel.example', geprueft: true, subject: 'Rangliste am Sonntag' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /vorstand@verein\.example\/sendMail$/);
  assert.equal(sent[0].body.message.subject, `[#${ctx.task}] Rangliste am Sonntag`, 'Vorgangsnummer für die Antwortzuordnung');
  assert.deepEqual(sent[0].body.message.toRecipients.map(x => x.emailAddress.address), ['eltern@beispiel.example', 'trainer@beispiel.example']);
  const d = (await admin.get('/api/drafts?status=uebernommen')).data.find(x => x.id === dr.data.id);
  assert.equal(d.sent_count, 2);
  assert.ok(!JSON.stringify(d).includes('eltern@beispiel'), 'Adresse nicht am Entwurf gespeichert');
  const audit = JSON.stringify((await admin.get('/api/audit?limit=50')).data);
  assert.ok(audit.includes('aus der App gesendet') && !audit.includes('eltern@beispiel'), 'Protokoll ohne Adressen');
});

test('Heimspieltag: zwei Spiele an einem Tag → eine Aufgabe; Jugend braucht keinen Schiedsrichter', async () => {
  const d1 = day(3), d2 = day(5);
  icsText = ics([['g1', d1, '10:00', 'TTV Musterhausen U15 – TTG Seeblick U15'], ['g2', d1, '19:30', 'TTV Musterhausen II – SV Nachbarort'], ['g3', d2, '10:00', 'TTV Musterhausen U13 – DJK Talstadt U13'], ['g4', day(4), '18:00', 'SV Gast – TTV Musterhausen II']]);
  const vor16 = (await admin.get('/api/process-templates')).data.find(t => t.key === 'VOR-16');
  const f = await admin.post('/api/feeds', { area_id: ctx.area, name: 'Herren II (Kreisliga)', url: `${base}/team.ics`, home_pattern: 'TTV Musterhausen', create_tasks: true, template_id: vor16.id, lead_days: 10 });
  const s = await admin.post(`/api/feeds/${f.data.id}/sync`);
  assert.equal(s.data.tasks, 2, 'zwei Spieltage, nicht drei Aufgaben');
  const tasks = (await admin.get('/api/tasks?q=Heimspiel')).data;
  const list = Array.isArray(tasks) ? tasks : tasks.tasks || tasks.items;
  const mixed = list.find(t => t.title.startsWith('Heimspieltag'));
  assert.ok(mixed, JSON.stringify(list.map(t => t.title)));
  assert.match(mixed.title, /U15 gegen TTG Seeblick U15 \(10:00\) · Herren II gegen SV Nachbarort \(19:30\)/);
  const youth = list.find(t => t.title.includes('DJK Talstadt'));
  const yd = (await admin.get(`/api/tasks/${youth.id}`)).data;
  const sr = yd.steps.find(x => x.title === 'Schiedsrichter klären');
  assert.equal(sr.done, 1, 'Schiedsrichter-Schritt entfällt bei reinem Jugendspieltag');
  assert.match(sr.note, /Jugendspiel/);
  const md = (await admin.get(`/api/tasks/${mixed.id}`)).data;
  assert.equal(md.steps.find(x => x.title === 'Schiedsrichter klären').done, 0, 'bei Herren-Spiel bleibt er');
  assert.equal(md.events.length, 2);
  // Entwurf kennt Datum, Begegnungen und den Schiedsrichter-Hinweis
  const v = (await admin.get(`/api/tasks/${mixed.id}/draft-values`)).data.values;
  assert.match(v.spieltag, /\d{2}\.\d{2}\.\d{4}/);
  assert.match(v.begegnung, /TTG Seeblick U15/);
  assert.match(v.schiedsrichter, /entfällt \(Jugend\)/);
  const tpl = (await admin.get('/api/text-templates')).data.find(x => x.key === 'T-HEIMSPIEL');
  const dr = await admin.post(`/api/tasks/${mixed.id}/drafts`, { template_id: tpl.id, values: { hallendienst: 'Ben' } });
  const draft = (await admin.get(`/api/tasks/${mixed.id}`)).data.drafts.find(x => x.id === dr.data.id);
  assert.match(draft.body, /SV Nachbarort/);
  assert.match(draft.body, /Hallendienst \(Aufbau ab 09:00 Uhr\): Ben/);
  const yv = (await admin.get(`/api/tasks/${youth.id}/draft-values`)).data.values;
  assert.match(yv.schiedsrichter, /kein Schiedsrichter nötig/);
});

test('Mitgliederliste nur mit „Gelb lokal“; Auslosung nachprüfbar', async () => {
  const csv = 'Vorname,Nachname,Geburtsdatum,Mannschaft,Q-TTR,IBAN\nAnna,Ahorn,01.02.2012,U15,1350,DE00\nBen,Birke,03.04.2011,U15,1420,DE00\nCem,Erle,2013,U13,1100,\nDora,Esche,2012,U15,1280,';
  let r = await admin.post('/api/members/import', { area_id: ctx.area, text: csv });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Gelbe Daten lokal/);
  // Ohne Liste: Auslosung mit eingefügten Namen geht trotzdem
  r = await admin.post('/api/draws', { mode: 'paare', participants: [{ name: 'X' }, { name: 'Y' }, { name: 'Z' }] });
  assert.equal(r.status, 200);
  assert.equal(r.data.result.pairs.flat().length, 3);
  await admin.put('/api/settings', { gelb_lokal: true });
  r = await admin.post('/api/members/import', { area_id: ctx.area, text: csv });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.added, 4);
  r = await admin.post('/api/members/import', { area_id: ctx.area, text: 'Anna Ahorn; 2012; 1400; U15' });
  assert.equal(r.data.updated, 1, 'kein Duplikat');
  const m = (await admin.get('/api/members')).data;
  assert.equal(m.members.length, 4);
  assert.ok(!JSON.stringify(m).includes('DE00'), 'Bankdaten aus dem Export werden ignoriert');
  assert.deepEqual(m.teams, ['U13', 'U15']);
  const people = m.members.map(x => ({ name: `${x.first_name} ${x.last_name}`, ttr: x.ttr }));
  const a = await admin.post('/api/draws', { mode: 'gruppen', participants: people, groups: 2, seeded: true, seed: 'abc', title: 'Vereinsmeisterschaft', save: true });
  const b = await admin.post('/api/draws', { mode: 'gruppen', participants: people, groups: 2, seeded: true, seed: 'abc' });
  assert.deepEqual(a.data.result, b.data.result, 'gleicher Zufallswert → gleiches Ergebnis');
  const tops = a.data.result.groups.map(g => Math.max(...g.members.map(x => x.ttr)));
  assert.ok(tops.includes(1420) && tops.includes(1400), 'die zwei Stärksten in verschiedenen Gruppen');
  assert.ok(a.data.id);
  const ko = await admin.post('/api/draws', { mode: 'ko', participants: people.slice(0, 3), seeded: true });
  assert.equal(ko.data.result.byes, 1);
  const audit = JSON.stringify((await admin.get('/api/audit?limit=50')).data);
  assert.ok(!audit.includes('Ahorn'), 'keine Namen im Protokoll');
});
