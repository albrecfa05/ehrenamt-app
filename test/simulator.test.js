// Vorstandsarbeit-Simulator: Vereinswelt + leere App, durchgespielt wie von einem Menschen.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tte-welt-'));
process.env.DATA_DIR = path.join(dir, 'app');
process.env.DISABLE_SCHEDULER = '1';
process.env.TTE_SIMULATOR = '1';
process.env.TTE_LEER = '1';
delete process.env.ANTHROPIC_API_KEY;

const { openWelt, save } = await import('../simulator/welt/zustand.js');
const { erschaffen, history, MAILBOX } = await import('../simulator/welt/verein.js');
const { mail } = await import('../simulator/welt/kanaele.js');
const { dienstEnv } = await import('../simulator/welt/dienste.js');
const { createWeltServer } = await import('../simulator/welt/server.js');
const { createServer } = await import('../server/index.js');
const { Client, STRONG_PW } = await import('./helpers.js');
const { setClockOffset } = await import('../server/clock.js');

openWelt(path.join(dir, 'welt'));
erschaffen();
history((mb, m) => mail(mb, { ...m, attachments: m.attachments || [] }));
save(true);
const app = createServer();
await new Promise(r => app.listen(0, '127.0.0.1', r));
const welt = createWeltServer({ appUrl: `http://127.0.0.1:${app.address().port}`, base: 'http://127.0.0.1:0' });
await new Promise(r => welt.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${welt.address().port}`;
dienstEnv(base);
const mia = new Client(`http://127.0.0.1:${app.address().port}`);
const w = new Client(base);
test.after(async () => { setClockOffset(0); await new Promise(r => app.close(r)); await new Promise(r => welt.close(r)); });

const status = async () => (await w.get('/api/status')).data;
const ok = (s, key) => s.einrichtung.find(c => c.key === key).ok;
const ctx = {};

test('Welt: Unterlagen, alte Mails, Briefkasten leer, App leer', async () => {
  const docs = (await w.get('/api/ordner')).data;
  assert.ok(docs.length >= 9);
  const satzung = docs.find(d => d.title === 'Satzung');
  const pdf = await fetch(`${base}/datei/${satzung.file.id}`).then(r => r.arrayBuffer()).then(b => Buffer.from(b));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.includes(Buffer.from('xref')) && pdf.includes(Buffer.from('%%EOF')));
  const mails = (await w.get(`/api/postfach?mailbox=${encodeURIComponent(MAILBOX.ttv)}`)).data;
  assert.ok(mails.length >= 4);
  assert.equal((await mia.get('/api/auth/status')).data.setupNeeded, true);
  const s = await status();
  assert.equal(s.einrichtung.filter(c => c.ok).length, 0);
});

test('Kapitel 1: App mit den Vereinsunterlagen einrichten', async () => {
  await mia.post('/api/auth/setup', { name: 'Mia Muster', login: 'mia', password: STRONG_PW });
  assert.ok(ok(await status(), 'konto'));
  // Bereiche
  const [first] = (await mia.get('/api/areas')).data;
  await mia.put(`/api/areas/${first.id}`, { name: 'TTV Musterhausen' });
  await mia.post('/api/areas', { name: 'SV Beispieldorf', type: 'verein' });
  await mia.post('/api/areas', { name: 'Bezirk Musterkreis', type: 'bezirk' });
  const areas = (await mia.get('/api/areas')).data;
  ctx.ttv = areas.find(a => a.name === 'TTV Musterhausen').id;
  ctx.bezirk = areas.find(a => a.name === 'Bezirk Musterkreis').id;
  // Konten
  const all = areas.map(a => a.id);
  for (const [name, login, role] of [['Ben Beispiel', 'ben', 'admin'], ['Sara Satz', 'sara', 'admin'], ['Jana Jugend', 'jana', 'zuarbeit']]) {
    const r = await mia.post('/api/users', { name, login, role, areas: all });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  const users = Object.fromEntries((await mia.get('/api/users')).data.map(u => [u.login, u.id]));
  ctx.users = users;
  // Ämter laut Ämterliste
  const offices = (await mia.get('/api/offices')).data.filter(o => o.area_id === ctx.ttv);
  const set = { Vorsitz: ['mia', 'sara'], Kasse: ['ben', null], Sportwart: ['sara', 'mia'], Jugendwart: ['jana', 'mia'], Öffentlichkeitsarbeit: ['mia', null], Schriftführung: ['mia', null], Mitgliederverwaltung: ['mia', 'ben'], Sponsoring: ['mia', null] };
  for (const o of offices) if (set[o.name]) await mia.put(`/api/offices/${o.id}`, { holder_id: users[set[o.name][0]], deputy_id: set[o.name][1] ? users[set[o.name][1]] : null });
  // Satzung, Fristen, Beiträge, Datenschutz
  const docs = (await w.get('/api/ordner')).data;
  await mia.post('/api/kb/documents', { title: 'Satzung TTV Musterhausen', source_type: 'satzung', area_id: ctx.ttv, text: docs.find(d => d.title === 'Satzung').text });
  await mia.put('/api/settings', { einladung_frist_tage: 21, kuendigung_frist_monate: 3, gelb_lokal: true, gelb_extern: true,
    beitragsstufen: [{ name: 'Kinder und Jugendliche', ab_alter: 0, bis_alter: 17, beitrag: 48 }, { name: 'Erwachsene', ab_alter: 18, bis_alter: null, beitrag: 96 }] });
  // Microsoft 365 der Vereinswelt
  let r = await mia.put('/api/connections/m365', { mailboxes: [{ address: MAILBOX.ttv, area_id: ctx.ttv }, { address: MAILBOX.bezirk, area_id: ctx.bezirk }], kalender_postfach: MAILBOX.ttv, ablage_ziel: `users/${MAILBOX.ttv}/drive`, ablage_ordner: 'Ehrenamt-App' });
  assert.equal(r.data.configured, true);
  r = await mia.post('/api/connections/m365/test');
  assert.ok(r.data.ok, JSON.stringify(r.data));
  // Spielplan
  const vor16 = (await mia.get('/api/process-templates')).data.find(t => t.key === 'VOR-16');
  r = await mia.post('/api/feeds', { area_id: ctx.ttv, name: 'Herren I', url: `${base}/clicktt/herren1.ics`, home_pattern: 'TTV Musterhausen', create_tasks: true, template_id: vor16.id, lead_days: 10, owner_id: users.sara });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // Asana
  const asana = docs.find(d => d.title.startsWith('Asana'));
  const csv = await fetch(`${base}/datei/${asana.file.id}`).then(x => x.text());
  r = await mia.post('/api/import/asana', { csv, area_id: ctx.ttv, assignees: { 'Mia Muster': users.mia, 'Ben Beispiel': users.ben, 'Sara Satz': users.sara } });
  assert.ok(r.data.tasks >= 10, JSON.stringify(r.data));
  // Jahreskalender, Sponsoren, Voreinstellung, Abschluss
  await mia.post('/api/setup/confirm-calendar', { ids: (await mia.get('/api/recurring')).data.map(x => x.id) });
  for (const [company, end] of [['Autohaus Blechle', '2028-06-30'], ['Bäckerei Krümel', null], ['Malerbetrieb Pinsel & Söhne', '2027-06-01']]) {
    r = await mia.post('/api/sponsors', { area_id: ctx.ttv, company, end_date: end || new Date(Date.parse((await status()).today) + 45 * 86_400_000).toISOString().slice(0, 10), godparent_id: users.mia });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  r = await mia.post('/api/setup/preset', { preset: 'umfassend', approve_examples: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // Jugendplaner der Vereinswelt anbinden
  r = await mia.put('/api/jugendplaner', { area_id: ctx.ttv });
  assert.equal(r.status, 200);
  r = await mia.post('/api/jugendplaner/sync');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await mia.post('/api/setup/step', { key: 'start' });
  const s = await status();
  assert.deepEqual(s.einrichtung.filter(c => !c.ok).map(c => c.key), [], 'Kapitel 1 vollständig');
});

test('Mitgliedsantrag: Briefkasten → Scan → App → Wartet auf SEPA → Antwort → erledigt', async () => {
  await w.post('/api/ereignis', { key: 'mitgliedsantrag' });
  const letter = (await w.get('/api/post')).data.find(p => p.title.includes('Lea Lustig'));
  assert.ok(letter?.file);
  const pdf = await fetch(`${base}/datei/${letter.file.id}`).then(r => r.arrayBuffer()).then(b => Buffer.from(b));
  assert.ok(pdf.includes(Buffer.from('Lea Lustig')), 'ausgefülltes Formular');
  await w.post(`/api/post/${letter.id}/scan`, {});
  const poll = await mia.post('/api/inbox/poll');
  assert.ok(poll.data.created >= 1, JSON.stringify(poll.data));
  let item = null;
  for (const st of ['neu', 'uebernommen']) item ||= (await mia.get(`/api/inbox?status=${st}`)).data.find(i => i.subject.includes('Mitgliedsantrag'));
  assert.ok(item, 'Scan ist in der App angekommen');
  const vor1 = (await mia.get('/api/process-templates')).data.find(t => t.key === 'VOR-1');
  const tid = item.task_id || (await mia.post(`/api/inbox/${item.id}/accept`, { area_id: ctx.ttv, title: 'Neuaufnahme Lea Lustig', template_id: vor1.id, data_class: 'gelb' })).data.taskId;
  await mia.put(`/api/tasks/${tid}`, { title: 'Neuaufnahme Lea Lustig', template_id: vor1.id, data_class: 'gelb' });
  await mia.put(`/api/tasks/${tid}`, { status: 'in_arbeit' });
  await mia.put(`/api/tasks/${tid}`, { status: 'wartet', waiting_who: 'Familie Lustig', waiting_what: 'SEPA-Mandat' });
  let s = (await w.post('/api/pruefen', {})).data;
  let ev = s.ereignisse.find(e => e.key === 'mitgliedsantrag');
  assert.deepEqual(ev.checks.slice(0, 5).map(c => c.ok), [true, true, true, true, true], JSON.stringify(ev.checks));
  s = (await w.post('/api/zeit', { days: 3 })).data;
  const t = (await mia.get(`/api/tasks/${tid}`)).data.task;
  assert.notEqual(t.status, 'wartet', 'Mail der Familie mit [#Nummer] wurde zugeordnet');
  await mia.put(`/api/tasks/${tid}`, { status: 'erledigt' });
  s = (await w.post('/api/pruefen', {})).data;
  ev = s.ereignisse.find(e => e.key === 'mitgliedsantrag');
  assert.equal(ev.state, 'geloest', JSON.stringify(ev.checks));
});

test('Saisonverlauf: Ereignisse treten von selbst ein; Betrugsmail wird erkannt und abgelegt', async () => {
  const s = (await w.post('/api/zeit', { days: 3 })).data;
  assert.ok(['sr_absage', 'foerderung', 'phishing'].every(k => s.ereignisse.find(e => e.key === k).state !== 'neu'), 'bis Tag 6 eingetreten');
  await mia.post('/api/inbox/poll');
  const ph = (await mia.get('/api/inbox?status=neu')).data.find(i => i.subject.startsWith('Dringend'));
  assert.ok(ph, 'Betrugsmail in der App');
  assert.ok(ph.flags.length > 0);
  await mia.post(`/api/inbox/${ph.id}/dismiss`, { reason: 'Betrugsversuch' });
  const s2 = (await w.post('/api/zeit', { days: 1 })).data;
  assert.equal(s2.ereignisse.find(e => e.key === 'phishing').state, 'geloest');
});

test('Hallensperrung: Verlegungsantrag → Staffel genehmigt → neuer Termin kommt über das Abo', async () => {
  let s = (await w.post('/api/ereignis', { key: 'hallensperrung' })).data;
  await mia.post('/api/inbox/poll');
  const item = (await mia.get('/api/inbox?status=neu')).data.find(i => i.subject.startsWith('Sperrung'));
  assert.ok(item);
  const acc = await mia.post(`/api/inbox/${item.id}/accept`, { area_id: ctx.ttv, title: 'Heimspiel verlegen' });
  const texts = (await mia.get('/api/text-templates')).data;
  const tv = (texts.templates || texts).find(x => x.key === 'T-VERLEGUNG');
  await mia.post(`/api/tasks/${acc.data.taskId}/drafts`, { template_id: tv.id });
  // Tag 1: Staffel genehmigt; Tag 2: der tägliche Spielplan-Abruf der App bringt den neuen Termin
  s = (await w.post('/api/zeit', { days: 2 })).data;
  const ev = s.ereignisse.find(e => e.key === 'hallensperrung');
  assert.equal(ev.state, 'geloest', JSON.stringify(ev.checks));
});

test('Entwurf der App landet im Postfach der Welt und lässt sich dort verschicken; .eml-Import ohne Verbindung', async () => {
  const appr = (await mia.get('/api/approvals?status=offen')).data.find(a => a.action_type === 'postfach_entwurf');
  if (appr) {
    const r = await mia.post(`/api/approvals/${appr.id}/decide`, { approve: true, confirmRecipients: true });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const drafts = (await w.get(`/api/postfach?mailbox=${encodeURIComponent(MAILBOX.ttv)}&folder=drafts`)).data;
    assert.ok(drafts.length >= 1);
    await w.post('/api/mail/send', { draftId: drafts[0].id, to: 'familie.lustig@mail.example' });
    assert.ok((await w.get(`/api/postfach?mailbox=${encodeURIComponent(MAILBOX.ttv)}&folder=sent`)).data.length >= 1);
  }
  const m = (await w.get(`/api/postfach?mailbox=${encodeURIComponent(MAILBOX.sv)}`)).data[0];
  const emlText = await fetch(`${base}/eml/${m.id}`).then(r => r.text());
  const r = await mia.req('POST', '/api/inbox/eml', emlText, { raw: true, headers: { 'Content-Type': 'message/rfc822' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

test('Eingang erfassen mit Anhang (z. B. PDF aus dem Briefkasten)', async () => {
  const r = await mia.post('/api/inbox', { channel: 'post', sender: 'Familie Muster', subject: 'Antrag per Hand erfasst', body: 'Eingeworfen.',
    attachments: [{ name: 'Antrag.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 Fantasie').toString('base64') }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const all = [...(await mia.get('/api/inbox?status=neu')).data, ...(await mia.get('/api/inbox?status=uebernommen')).data];
  assert.equal(all.find(i => i.subject === 'Antrag per Hand erfasst').attachments[0].name, 'Antrag.pdf');
});

test('Fahrer springt ab: Jugendplaner → Aufgabe in der App → im Jugendplaner gelöst → Aufgabe erledigt', async () => {
  // Im Saisonverlauf ist es (Tag 2) meist schon eingetreten – sonst jetzt auslösen
  let s = (await w.get('/api/status')).data;
  // Für den Test frisch starten, damit das betroffene Spiel sicher in der Zukunft liegt
  if (s.ereignisse.find(e => e.key === 'fahrer_absage').state === 'laeuft') await w.post('/api/ereignis/abbrechen', { key: 'fahrer_absage' });
  s = (await w.post('/api/ereignis', { key: 'fahrer_absage' })).data;
  const ev = () => s.ereignisse.find(e => e.key === 'fahrer_absage');
  assert.equal(ev().state, 'laeuft');
  // Der Abgleich läuft beim Vorspulen schon automatisch; zur Sicherheit noch einmal von Hand
  let r = await mia.post('/api/jugendplaner/sync');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  s = (await w.post('/api/pruefen', {})).data;
  assert.equal(ev().checks[0].ok, true, 'Lücke erkannt');
  const jp = (await w.get('/api/jugendplaner')).data;
  const open = jp.games.filter(g => !g.drivers && !g.cancelled);
  for (const g of open) await w.post('/api/jugendplaner/set', { id: g.id, field: 'drivers', value: 'Ute Fichte' });
  r = await mia.post('/api/jugendplaner/sync');
  assert.ok(r.data.closed >= 1, JSON.stringify(r.data));
  s = (await w.post('/api/pruefen', {})).data;
  assert.equal(ev().state, 'geloest', JSON.stringify(ev().checks));
});
