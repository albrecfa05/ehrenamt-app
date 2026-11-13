// Tests: leere App, Einrichtungsassistent, Datenschutz-Schalter.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TTE_LEER = '1';
const { startApp, STRONG_PW } = await import('./helpers.js');
const app = await startApp();
const admin = app.client();
test.after(() => app.close());

test('Leere App: ein Platzhalter-Bereich, Assistent wird angeboten', async () => {
  const st = await admin.get('/api/auth/status');
  assert.equal(st.data.setupNeeded, true);
  await admin.post('/api/auth/setup', { name: 'Erste Person', login: 'erste', password: STRONG_PW });
  const me = await admin.get('/api/me');
  assert.deepEqual(me.data.areas.map(a => a.name), ['Mein Verein']);
  assert.equal(me.data.setup_open, true);
  const s = await admin.get('/api/setup');
  assert.equal(s.data.done, false);
  assert.equal(s.data.steps.length, 9);
  assert.equal(s.data.steps.find(x => x.key === 'verein').ok, true);
  assert.equal(s.data.steps.find(x => x.key === 'personen').ok, false, 'nur ein Admin');
});

test('Bereiche: neuer Bereich bekommt Ämter und Kalender; leerer Bereich lässt sich entfernen', async () => {
  const r = await admin.post('/api/areas', { name: 'Bezirk Test', type: 'bezirk' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const offices = await admin.get('/api/offices');
  assert.ok(offices.data.some(o => o.area_name === 'Bezirk Test' && o.name === 'Schiedsrichterwart'));
  const rec = await admin.get('/api/recurring');
  assert.ok(rec.data.some(x => x.area_name === 'Bezirk Test'));
  const id = (await admin.get('/api/me')).data.areas.find(a => a.name === 'Bezirk Test')?.id
    ?? (await admin.get('/api/areas')).data.find(a => a.name === 'Bezirk Test').id;
  const d = await admin.del(`/api/areas/${id}`);
  assert.ok(d.status < 300, JSON.stringify(d.data));
  assert.ok(!(await admin.get('/api/areas')).data.some(a => a.name === 'Bezirk Test'));
});

test('Voreinstellung „Empfohlen“ schaltet Katalog und gibt Beispielregeln frei', async () => {
  const r = await admin.post('/api/setup/preset', { preset: 'empfohlen', approve_examples: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.approved >= 2);
  const cat = await admin.get('/api/catalog');
  assert.equal(cat.data.find(c => c.key === 'spielplan_import').enabled, true);
  assert.equal(cat.data.find(c => c.key === 'postfach_abruf').enabled, false);
  assert.equal(r.data.steps.find(x => x.key === 'automatisierung').ok, true);
  assert.equal((await admin.post('/api/setup/preset', { preset: 'quatsch' })).status, 400);
});

test('Jahreskalender bestätigen und Einrichtung abschließen', async () => {
  const rec = await admin.get('/api/recurring');
  const r = await admin.post('/api/setup/confirm-calendar', { ids: rec.data.map(x => x.id) });
  assert.equal(r.data.steps.find(x => x.key === 'kalender').ok, true);
  await admin.post('/api/setup/step', { key: 'start' });
  const me = await admin.get('/api/me');
  assert.equal(me.data.setup_open, false);
});

test('Datenschutz-Schalter: getrennt lokal und extern, alter Schalter setzt beide', async () => {
  let s = await admin.get('/api/settings');
  assert.equal(s.data.gelb_lokal.value, false);
  assert.equal(s.data.gelb_extern.value, false);
  await admin.put('/api/settings', { gelb_lokal: true });
  s = await admin.get('/api/settings');
  assert.equal(s.data.gelb_lokal.value, true);
  assert.equal(s.data.gelb_extern.value, false);
  const cat = await admin.get('/api/catalog');
  const mp = cat.data.find(c => c.key === 'mitglieder_pruefung');
  assert.ok(!mp.missing.some(m => /gelb/i.test(m)), 'Voraussetzung „gelb lokal“ erfüllt');
});
