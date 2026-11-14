// Vereinswelt: Kapitel 1 ausfüllen lassen / überspringen, Vorschau ohne Download, Weiterleiten ans Postfach.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tte-fill-'));
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

openWelt(path.join(dir, 'welt'));
erschaffen();
history((mb, m) => mail(mb, { ...m, attachments: m.attachments || [] }));
save(true);
const app = createServer();
await new Promise(r => app.listen(0, '127.0.0.1', r));
const appUrl = `http://127.0.0.1:${app.address().port}`;
// Die Welt muss ihre eigene Adresse kennen (für Spielplan-Abos) – Port erst nach dem Start bekannt
let base = '';
const welt = createWeltServer({ appUrl, get base() { return base; } });
await new Promise(r => welt.listen(0, '127.0.0.1', r));
base = `http://127.0.0.1:${welt.address().port}`;
dienstEnv(base);
const mia = new Client(appUrl);
const w = new Client(base);
test.after(async () => { await new Promise(r => app.close(r)); await new Promise(r => welt.close(r)); });

test('Ohne erstes Konto kann der Assistent nichts ausfüllen', async () => {
  const r = await w.post('/api/kapitel/ausfuellen', { key: 'fristen' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /erste Konto/);
});

test('Zweiter Verein ist optional; „Alles ausfüllen“ erledigt Kapitel 1', async () => {
  await mia.post('/api/auth/setup', { name: 'Mia Muster', login: 'mia', password: STRONG_PW });
  let s = (await w.get('/api/status')).data;
  assert.equal(s.zweiterVerein, false);
  const r = await w.post('/api/kapitel/ausfuellen', { key: 'alle' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  s = r.data.status;
  assert.deepEqual(s.einrichtung.filter(c => !c.ok).map(c => c.key), [], JSON.stringify(r.data.messages));
  const areas = (await mia.get('/api/areas')).data.map(a => a.name);
  assert.ok(areas.includes('TTV Musterhausen') && areas.includes('Bezirk Musterkreis'));
  assert.ok(!areas.includes('SV Beispieldorf'), 'ohne zweiten Verein');
  const users = (await mia.get('/api/users')).data;
  assert.ok(users.length >= 6);
  assert.ok(!users.some(u => u.name === 'Udo Unger'), 'Abteilungsleiter des zweiten Vereins nicht angelegt');
  const audit = JSON.stringify((await mia.get('/api/audit?limit=200')).data);
  assert.ok(audit.includes('Asana-Import'), 'alles steht im Protokoll der App');
});

test('Überspringen und wieder aufnehmen', async () => {
  await w.post('/api/einstellung', { zweiterVerein: true });
  let s = (await w.get('/api/status')).data;
  // „bereiche“ ist schon erfüllt und bleibt erfüllt; neuer Schritt lässt sich überspringen
  const r = await w.post('/api/kapitel/ueberspringen', { key: 'sponsoren' });
  assert.equal(r.status, 200);
  s = (await w.post('/api/kapitel/ueberspringen', { key: 'sponsoren', on: false })).data;
  assert.equal(s.einrichtung.find(c => c.key === 'sponsoren').skipped, false);
});

test('Vorschau ohne Download und „ans Vorstandspostfach“', async () => {
  const docs = (await w.get('/api/ordner')).data;
  const satzung = docs.find(d => d.title === 'Satzung');
  const v = (await w.get(`/vorschau/${satzung.file.id}`)).data;
  assert.equal(v.kind, 'pdf');
  assert.ok(v.lines.some(l => l.text.startsWith('§ 7')), 'Text aus dem PDF lesbar');
  assert.ok(v.lines.some(l => /Mitgliederversammlung/.test(l.text)));
  const csv = (await w.get(`/vorschau/${docs.find(d => d.title.startsWith('Asana')).file.id}`)).data;
  assert.equal(csv.kind, 'text');
  assert.match(csv.text, /^Task ID,/);
  let r = await w.post(`/api/datei/${satzung.file.id}/mailen`, {});
  assert.equal(r.status, 200);
  const poll = await mia.post('/api/inbox/poll');
  assert.ok(poll.data.created >= 1);
  // WhatsApp-Nachricht mit Fotos weiterleiten
  await w.post('/api/ereignis', { key: 'fotos' });
  const chat = (await w.get('/api/chats')).data.find(c => c.key === 'vorstand');
  const msg = chat.messages.find(m => m.files.length);
  r = await w.post(`/api/chats/vorstand/${msg.id}/weiterleiten`, {});
  assert.equal(r.status, 200);
  const mails = (await w.get(`/api/postfach?mailbox=${encodeURIComponent(MAILBOX.ttv)}`)).data;
  assert.ok(mails.some(m => m.subject.startsWith('WhatsApp') && m.attachments === 2));
});

test('Fehlende Dateien: kein Absturz, Reparatur stellt den Vereinsordner wieder her', async () => {
  const { W } = await import('../simulator/welt/zustand.js');
  const { reparieren } = await import('../simulator/welt/verein.js');
  const doc = W().docs.find(d => d.title === 'Satzung');
  fs.unlinkSync(path.join(dir, 'welt', 'dateien', doc.file));
  let r = await fetch(`${base}/datei/${doc.file}`);
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /fehlt/);
  r = await w.get(`/vorschau/${doc.file}`);
  assert.equal(r.status, 404);
  assert.equal((await w.get('/api/status')).status, 200, 'Server läuft weiter');
  assert.ok(reparieren() >= 1);
  const neu = W().docs.find(d => d.title === 'Satzung');
  r = await fetch(`${base}/datei/${neu.file}`);
  assert.equal(r.status, 200);
  assert.equal(W().docs.length, 9);
});

test('Senden aus der App landet im Ordner „Gesendet“ der Vereinswelt', async () => {
  const areas = (await mia.get('/api/areas')).data;
  const ttv = areas.find(a => a.name === 'TTV Musterhausen').id;
  const t = await mia.post('/api/tasks', { area_id: ttv, title: 'Rückfrage an die Staffel' });
  const tpl = (await mia.get('/api/text-templates')).data.find(x => x.key === 'T-VERLEGUNG');
  const dr = await mia.post(`/api/tasks/${t.data.id}/drafts`, { template_id: tpl.id });
  const r = await mia.post(`/api/drafts/${dr.data.id}/send`, { to: 'staffel@tt-musterkreis.example', geprueft: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const sentBox = (await w.get(`/api/postfach?mailbox=${encodeURIComponent(MAILBOX.ttv)}&folder=sent`)).data;
  assert.ok(sentBox.some(m => m.to.includes('staffel@') && m.subject.startsWith(`[#${t.data.id}]`)));
});
