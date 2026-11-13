// Tests des Vorstandsarbeit-Simulators: Demo-Verein, Nachbau-Dienste, Zeitraffer, Szenarien.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tte-sim-'));
process.env.DISABLE_SCHEDULER = '1';
process.env.TTE_SIMULATOR = '1';
delete process.env.ANTHROPIC_API_KEY;

const { startFakes, fakeBase } = await import('../server/sim/fakes.js');
const fakes = await startFakes();
const { SIM_AREAS, seedWorld } = await import('../server/sim/world.js');
const { createServer } = await import('../server/index.js');
await import('../server/sim/api.js');
const { Client } = await import('./helpers.js');
const { clockOffset, setClockOffset } = await import('../server/clock.js');

const server = createServer({ areas: SIM_AREAS });
const world = seedWorld({ fakeBase: fakeBase() });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const mia = new Client(`http://127.0.0.1:${server.address().port}`);
test.after(async () => { setClockOffset(0); await new Promise(r => server.close(r)); fakes.close(); });

const inboxItem = async (pred) => {
  for (const st of ['neu', 'uebernommen', 'abgelegt']) { const i = (await mia.get(`/api/inbox?status=${st}`)).data.find(pred); if (i) return i; }
  return null;
};

test('Demo-Verein mit Fantasiedaten, alle Schalter an', async () => {
  assert.ok(world?.pw);
  const r = await mia.post('/api/auth/login', { login: 'mia', password: world.pw });
  assert.equal(r.status, 200);
  const me = await mia.get('/api/me');
  assert.equal(me.data.simulator, true);
  assert.deepEqual(me.data.areas.map(a => a.name).sort(), SIM_AREAS.map(a => a.name).sort());
  const s = await mia.get('/api/settings');
  assert.equal(s.data.gelb_lokal.value, true);
  assert.equal(s.data.gelb_extern.value, true);
  const cat = await mia.get('/api/catalog');
  assert.ok(cat.data.filter(c => c.key !== 'ki_assistent').every(c => c.enabled), 'Katalog voll eingeschaltet');
  const conn = await mia.post('/api/connections/m365/test');
  assert.ok(conn.data.ok, JSON.stringify(conn.data));
  const sim = await mia.get('/api/sim');
  assert.equal(sim.data.scenarios.length, 16);
  assert.ok(sim.data.spiele.length > 0);
});

test('Szenario „Neue Bankverbindung“: Ablegen löst es, Warnhinweis vorhanden', async () => {
  let r = await mia.post('/api/sim/scenario', { key: 'phishing' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const item = await inboxItem(i => i.subject.startsWith('Dringend'));
  assert.ok(item, 'Mail ist über den Postfach-Nachbau angekommen');
  assert.ok(item.flags.length > 0, 'App warnt');
  assert.equal(item.status, 'neu', 'auffällige Mail wird nie automatisch übernommen');
  await mia.post(`/api/inbox/${item.id}/dismiss`, { reason: 'Betrugsversuch' });
  r = await mia.post('/api/sim/advance', { days: 1 });
  const sc = r.data.scenarios.find(s => s.key === 'phishing');
  assert.equal(sc.state, 'geloest', JSON.stringify(sc.checks));
});

test('Szenario „Schiedsrichter sagt ab“: Übernehmen, Rundfrage, Abschluss', async () => {
  await mia.post('/api/sim/scenario', { key: 'sr_absage' });
  const item = await inboxItem(i => i.subject.startsWith('Absage Schiedsrichter'));
  assert.ok(item);
  // Mit voll eingeschaltetem Katalog übernimmt die App eindeutige Mails selbst („Eingang automatisch übernehmen“)
  let tid = item.task_id;
  if (!tid) {
    const acc = await mia.post(`/api/inbox/${item.id}/accept`, { area_id: item.area_id, title: item.subject, template_id: item.suggestion.template_id, due_date: item.suggestion.due_date });
    assert.equal(acc.status, 200, JSON.stringify(acc.data));
    tid = acc.data.taskId;
  }
  const task = await mia.get(`/api/tasks/${tid}`);
  const vor3 = (await mia.get('/api/process-templates')).data.find?.(t => t.key === 'VOR-3');
  if (task.data.task.template_id !== vor3?.id) await mia.put(`/api/tasks/${tid}`, { template_id: vor3.id });
  const texts = await mia.get('/api/text-templates');
  const rund = (texts.data.templates || texts.data).find(t => t.key === 'T-SR-RUNDFRAGE');
  const dr = await mia.post(`/api/tasks/${tid}/drafts`, { template_id: rund.id });
  assert.equal(dr.status, 200, JSON.stringify(dr.data));
  await mia.put(`/api/tasks/${tid}`, { status: 'erledigt' });
  const sim = await mia.get('/api/sim');
  const sc = sim.data.scenarios.find(s => s.key === 'sr_absage');
  assert.deepEqual(sc.checks.map(c => c.ok), [true, true, true, true], JSON.stringify(sc.checks));
  assert.equal(sc.state, 'geloest');
});

test('Zeitraffer: Uhr läuft vor, Tageslauf erzeugt Sponsor-Aufgabe, Spielplan kommt an', async () => {
  const before = clockOffset();
  await mia.post('/api/sim/scenario', { key: 'sponsor' });
  const r = await mia.post('/api/sim/advance', { days: 2 });
  assert.ok(clockOffset() > before);
  const me = await mia.get('/api/me');
  assert.ok(me.data.clock_offset > 0);
  const sc = r.data.scenarios.find(s => s.key === 'sponsor');
  assert.equal(sc.checks[0].ok, true, 'Verlängerungs-Aufgabe aus dem Tageslauf');
  const cal = await mia.get(`/api/calendar?from=${r.data.today}&to=${new Date(Date.parse(r.data.today) + 120 * 86_400_000).toISOString().slice(0, 10)}`);
  assert.ok(JSON.stringify(cal.data).includes('TTV Musterhausen'), 'Spiele aus dem click-TT-Nachbau im Kalender');
});

test('Hallensperrung: Ablageregel greift, Staffel reagiert auf den Verlegungsantrag', async () => {
  await mia.post('/api/sim/scenario', { key: 'hallensperrung' });
  let sim = await mia.get('/api/sim');
  let sc = sim.data.scenarios.find(s => s.key === 'hallensperrung');
  assert.equal(sc.checks[0].ok, true, 'Hallenplan automatisch abgelegt');
  const item = await inboxItem(i => i.subject.startsWith('Sperrung Sporthalle'));
  const acc = item.task_id ? { data: { taskId: item.task_id } } : await mia.post(`/api/inbox/${item.id}/accept`, { area_id: item.area_id, title: 'Heimspiel verlegen' });
  const texts = await mia.get('/api/text-templates');
  const verl = (texts.data.templates || texts.data).find(t => t.key === 'T-VERLEGUNG');
  await mia.post(`/api/tasks/${acc.data.taskId}/drafts`, { template_id: verl.id });
  sim = await mia.post('/api/sim/advance', { days: 1 });
  sc = sim.data.scenarios.find(s => s.key === 'hallensperrung');
  assert.equal(sc.state, 'geloest', JSON.stringify(sc.checks));
  assert.ok(sim.data.log.some(l => l.text.includes('Staffelleitung')));
});

test('Neuaufnahme (gelb): Wartet auf SEPA, Willkommensentwurf per Regel, Antwort wird zugeordnet', async () => {
  await mia.post('/api/sim/scenario', { key: 'neuaufnahme' });
  const item = await inboxItem(i => i.subject.startsWith('Aufnahmeantrag Lea'));
  const vor1 = (await mia.get('/api/process-templates')).data.find(t => t.key === 'VOR-1');
  const tid = item.task_id || (await mia.post(`/api/inbox/${item.id}/accept`, { area_id: item.area_id, title: item.subject, template_id: vor1.id, data_class: 'gelb' })).data.taskId;
  await mia.put(`/api/tasks/${tid}`, { template_id: vor1.id, data_class: 'gelb' });
  await mia.put(`/api/tasks/${tid}`, { status: 'in_arbeit' });
  await mia.put(`/api/tasks/${tid}`, { status: 'wartet', waiting_who: 'Familie Lustig', waiting_what: 'SEPA-Mandat' });
  let sim = await mia.post('/api/sim/advance', { days: 3 });
  assert.ok(sim.data.log.some(l => l.text.includes('SEPA-Mandat')), 'Familie schickt das Mandat');
  const t = await mia.get(`/api/tasks/${tid}`);
  assert.notEqual(t.data.task.status, 'wartet', 'Antwort mit Vorgangsnummer beendet „Wartet“');
  await mia.put(`/api/tasks/${tid}`, { status: 'erledigt' });
  sim = await mia.get('/api/sim');
  const sc = sim.data.scenarios.find(s => s.key === 'neuaufnahme');
  assert.equal(sc.state, 'geloest', JSON.stringify(sc.checks));
});

test('Kassenprüfung: neue Ablageregel erwischt die später eingehenden Rechnungen', async () => {
  const ttv = (await mia.get('/api/me')).data.areas.find(a => a.key === 'ttv-musterhausen').id;
  const r = await mia.post('/api/filing-rules', { name: 'Rechnungen', pos: 5, subject_contains: 'Rechnung', area_id: ttv, folder: 'Rechnungen', data_class: 'gelb', mode: 'ablegen', dismiss_mail: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await mia.post('/api/sim/scenario', { key: 'kassenpruefung' });
  let sim = await mia.post('/api/sim/advance', { days: 3 });
  const sc = sim.data.scenarios.find(s => s.key === 'kassenpruefung');
  assert.deepEqual(sc.checks.slice(0, 3).map(c => c.ok), [true, true, true], JSON.stringify(sc.checks));
});

test('Einladung Mitgliederversammlung: Rechner nutzt die Satzungsfrist', async () => {
  let sim = await mia.post('/api/sim/scenario', { key: 'mv_einladung' });
  const tasks = (await mia.get('/api/tasks?q=Mitgliederversammlung')).data;
  const task = (tasks.tasks || tasks).find(t => t.title.startsWith('Einladung Mitgliederversammlung'));
  const ev = (await mia.get(`/api/calendar?from=${sim.data.today}&to=${new Date(Date.parse(sim.data.today) + 60 * 86_400_000).toISOString().slice(0, 10)}`)).data;
  const mv = JSON.stringify(ev).match(/"title":"Mitgliederversammlung TTV","date":"(\d{4}-\d{2}-\d{2})"/)?.[1];
  const calc = await mia.post(`/api/tasks/${task.id}/calc`, { calc: 'einladungsfrist', input: { termin: mv, frist_tage: 21, antrag_tage: 7, puffer_tage: 3 } });
  assert.equal(calc.status, 200, JSON.stringify(calc.data));
  const texts = await mia.get('/api/text-templates');
  const inv = (texts.data.templates || texts.data).find(t => t.key === 'T-EINLADUNG-MV');
  await mia.post(`/api/tasks/${task.id}/drafts`, { template_id: inv.id, values: { datum: mv } });
  await mia.put(`/api/tasks/${task.id}`, { status: 'erledigt' });
  sim = await mia.get('/api/sim');
  assert.equal(sim.data.scenarios.find(s => s.key === 'mv_einladung').state, 'geloest');
});

test('Nach außen: Entwürfe landen im Protokoll des Nachbaus, nie bei Microsoft', async () => {
  const appr = await mia.get('/api/approvals?status=offen');
  const list = appr.data;
  for (const a of list.filter(x => x.action_type === 'postfach_entwurf').slice(0, 1)) {
    const r = await mia.post(`/api/approvals/${a.id}/decide`, { approve: true, confirmRecipients: true });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  const sim = await mia.get('/api/sim');
  if (list.some(x => x.action_type === 'postfach_entwurf')) assert.ok(sim.data.aussen.some(x => x.kind === 'entwurf'));
  assert.ok(sim.data.score.points > 0);
});
