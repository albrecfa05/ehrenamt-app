// Anschluss an den Jugendplaner – gegen einen Nachbau mit Fantasiedaten (gleiche Schnittstelle wie das Original).

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Vor jedem Import, der die Konfiguration lädt: eigener Datenordner (nie data/)
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tte-jp-'));
process.env.DISABLE_SCHEDULER = '1';

const { handleJugendplaner, makeJugendplaner, checkToken, JP_SECRET, JP_PINS } = await import('../simulator/welt/jugendplaner.js');
let data = makeJugendplaner();
const fake = http.createServer((req, res) => handleJugendplaner(req, res, new URL(req.url, 'http://x'), '/jugendplaner', { getData: () => data, saveData: (d) => { data = d; } })
  .then(ok => { if (!ok) { res.writeHead(404); res.end(); } }));
await new Promise(r => fake.listen(0, '127.0.0.1', r));
const JP = `http://127.0.0.1:${fake.address().port}/jugendplaner`;
process.env.JUGENDPLANER_URL = JP;
process.env.JUGENDPLANER_SECRET = JP_SECRET;

const { startApp, STRONG_PW } = await import('./helpers.js');
const app = await startApp();
const admin = app.client();
const ctx = {};
test.after(async () => { await app.close(); fake.close(); });

const kidNames = () => [...new Set(data.youthTeams.flatMap(t => [...t.players, ...t.reserves]))];

test('Verbindung und Abgleich: Hinweise ohne Namen', async () => {
  const su = await admin.post('/api/auth/setup', { name: 'Jana Jugend', login: 'jana', password: STRONG_PW });
  assert.equal(su.status, 200, JSON.stringify(su.data));
  const me = await admin.get('/api/me');
  assert.equal(me.status, 200, JSON.stringify(me.data));
  assert.equal(me.data.jugendplaner, true);
  ctx.area = me.data.areas.find(a => a.key === 'ttsf-hohberg').id;
  const office = (await admin.get('/api/offices')).data.find(o => o.area_id === ctx.area && o.name === 'Jugendwart');
  await admin.put(`/api/offices/${office.id}`, { holder_id: me.data.user.id });
  let r = await admin.put('/api/jugendplaner', { area_id: ctx.area });
  assert.equal(r.status, 200);
  r = await admin.post('/api/jugendplaner/sync');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.counts.spiele >= 15);
  assert.ok(r.data.counts.kritisch >= 1, 'offene Spiele in den nächsten 14 Tagen');
  assert.ok(r.data.created >= 1);
  const st = (await admin.get('/api/jugendplaner')).data;
  const text = JSON.stringify(st);
  for (const k of kidNames()) assert.ok(!text.includes(k), `Kindername „${k}“ darf nicht übernommen werden`);
  assert.ok(!text.includes('Petra Ahorn') && !text.includes('Volker Linde'), 'auch keine Fahrernamen');
  assert.ok(!('icsKey' in st.stand), 'Kalender-Schlüssel bleibt auf dem Server');
  assert.ok(st.stand.games.some(g => g.issues.some(i => i.kind === 'zusagen')), 'zu wenige Zusagen erkannt');
  assert.ok(st.stand.games.some(g => g.issues.some(i => i.kind === 'betreuung')), 'fehlender Fahrer erkannt');
});

test('Aufgabe für die Jugendleitung, schließt sich nach Lösung im Jugendplaner', async () => {
  const all = (await admin.get('/api/tasks')).data;
  const list = Array.isArray(all) ? all : all.tasks || all.items || [];
  const t = list.find(x => /noch niemand fährt|keinen Betreuer/i.test(x.title));
  assert.ok(t, JSON.stringify(all).slice(0, 300));
  const detail = (await admin.get(`/api/tasks/${t.id}`)).data;
  assert.ok(detail.task.owner_id, 'an den Jugendwart');
  assert.match(detail.template?.name || '', /^Jugend:/, 'Vorgang VOR-14');
  // Zweiter Abgleich legt nichts doppelt an
  let r = await admin.post('/api/jugendplaner/sync');
  assert.equal(r.data.created, 0);
  // Im Jugendplaner wird ein Fahrer eingetragen (und Zusagen ergänzt)
  const gameId = detail.task.parent_source.split(':')[1];
  const g = data.games.find(x => x.id === gameId);
  g.drivers = 'Ute Fichte';
  g.respTeam = '';
  r = await admin.post('/api/jugendplaner/sync');
  assert.ok(r.data.closed >= 1);
  const after = (await admin.get(`/api/tasks/${t.id}`)).data;
  assert.equal(after.task.status, 'erledigt');
  assert.ok(after.comments.some(c => c.body.includes('im Jugendplaner gelöst')));
});

test('Spielplan-Abo aus dem Jugendplaner und Anmeldung „Zum Jugendplaner“', async () => {
  let r = await admin.post('/api/jugendplaner/feed');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const feeds = (await admin.get('/api/connections')).data.feeds;
  const f = feeds.find(x => x.name.startsWith('Jugendplaner'));
  r = await admin.post(`/api/feeds/${f.id}/sync`);
  assert.ok(r.data.read >= 15, JSON.stringify(r.data));
  r = await admin.post('/api/jugendplaner/feed');
  assert.equal(r.data.existed, true);
  r = await admin.get('/api/jugendplaner/open');
  assert.equal(r.data.sso, true);
  const token = r.data.url.split('#sso=')[1];
  assert.equal(checkToken(token), 'admin', 'Der Jugendplaner akzeptiert die Anmeldung');
});

test('Falscher Schlüssel, PIN statt Schlüssel, Rechte', async () => {
  process.env.JUGENDPLANER_SECRET = 'falsch';
  let r = await admin.post('/api/jugendplaner/sync');
  assert.equal(r.status, 400);
  assert.match(r.data.error, /APP_SECRET/);
  delete process.env.JUGENDPLANER_SECRET;
  process.env.JUGENDPLANER_PIN = JP_PINS.mf;
  r = await admin.post('/api/jugendplaner/sync');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await admin.get('/api/jugendplaner/open');
  assert.equal(r.data.sso, false);
  const u = await admin.post('/api/users', { name: 'Zuarbeit', login: 'zuarbeit', role: 'zuarbeit', password: STRONG_PW, areas: [ctx.area] });
  const z = app.client();
  await z.post('/api/auth/login', { login: 'zuarbeit', password: STRONG_PW });
  await z.post('/api/auth/password', { current: STRONG_PW, password: 'Andere-Kelle-2026!' });
  r = await z.post('/api/jugendplaner/sync');
  assert.equal(r.status, 403, 'nur Admins gleichen ab');
  assert.equal((await z.get('/api/jugendplaner')).status, 200, 'lesen darf, wer den Bereich sieht');
  assert.ok(u.status === 200);
  process.env.JUGENDPLANER_SECRET = JP_SECRET;
  delete process.env.JUGENDPLANER_PIN;
});
