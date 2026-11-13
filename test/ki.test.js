// Tests des KI-Assistenten gegen einen simulierten Claude-Server (keine echten API-Kosten).

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const received = [];
let nextResponse = null;
const fake = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  received.push({ url: req.url, headers: req.headers, body });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(nextResponse));
});
await new Promise(r => fake.listen(0, '127.0.0.1', r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;

const { startApp, STRONG_PW } = await import('./helpers.js');
const app = await startApp();
const admin = app.client();
const ctx = {};

test.after(async () => { await app.close(); fake.close(); });

const emptyRule = { name: '', beschreibung: '', bereich: '', vorgang: '', ausloeser: 'manuell', rhythmus: '', wochentag: 0, tag_im_monat: 0, stunde: 0, tage_vorher: 0,
  status_von: '', status_zu: '', aktion: 'erinnern', stufe: 0, aufgabe_titel: '', aufgabe_beschreibung: '', aufgabe_vorgang: '', aufgabe_bereich: '', faellig_in_tagen: 0,
  textvorlage: '', nachricht: '', auch_vertretung: false, termin_titel: '', termin_datum: '', termin_uhrzeit: '', termin_ort: '' };
const emptyCat = { schluessel: '', parameter: [] };
const message = (data, stop = 'end_turn') => ({ id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
  content: [{ type: 'text', text: JSON.stringify(data) }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 3200, output_tokens: 900 } });

test('Ohne API-Schlüssel ist der Assistent gesperrt', async () => {
  await admin.post('/api/auth/setup', { name: 'Test Admin', login: 'admin', password: STRONG_PW });
  const me = await admin.get('/api/me');
  ctx.areas = Object.fromEntries(me.data.areas.map(a => [a.key, a.id]));
  const cat = await admin.get('/api/catalog');
  const k = cat.data.find(c => c.key === 'ki_assistent');
  assert.equal(k.enabled, false, 'standardmäßig aus');
  assert.ok(k.missing.some(m => m.includes('API-Schlüssel')));
  await admin.put('/api/catalog', { ki_assistent: { enabled: true } });
  const r = await admin.post('/api/ki/ask', { mode: 'beschreibung', text: 'Bitte erinnere mich drei Tage vor jeder Frist.' });
  assert.equal(r.status, 400);
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-nur-fuer-den-simulierten-server';
});

test('Vorschläge werden geprüft; nur gültige lassen sich übernehmen', async () => {
  nextResponse = message({
    zusammenfassung: 'Drei Vorschläge.',
    vorschlaege: [
      { art: 'regel', titel: 'Erinnerung vor Schiedsrichter-Fristen', begruendung: 'Kurzfristige Ersatzsuche vermeiden.', nutzen: 'weniger Hektik',
        regel: { ...emptyRule, name: 'SR-Fristen 2 Tage vorher', beschreibung: 'Erinnert zwei Tage vor Fälligkeit.', bereich: 'TTSF Hohberg', vorgang: 'VOR-3', ausloeser: 'frist', tage_vorher: 2, aktion: 'erinnern', stufe: 1, nachricht: 'Bitte an {{aufgabe}} denken (fällig {{frist}}).', auch_vertretung: true }, katalog: emptyCat },
      { art: 'regel', titel: 'Kaputter Vorschlag', begruendung: '', nutzen: '',
        regel: { ...emptyRule, name: 'Entwurf', ausloeser: 'manuell', aktion: 'entwurf_erzeugen', stufe: 1, textvorlage: 'T-GIBTSNICHT' }, katalog: emptyCat },
      { art: 'katalog', titel: 'Kontaktpflege einschalten', begruendung: 'Gibt es schon fertig.', nutzen: '',
        regel: emptyRule, katalog: { schluessel: 'sponsor_kontakt', parameter: [{ name: 'tage', wert: '120' }] } },
      { art: 'nicht_moeglich', titel: 'Beiträge automatisch einziehen', begruendung: 'Lastschriften sind gesperrt.', nutzen: '', regel: emptyRule, katalog: emptyCat },
      { art: 'regel', titel: 'Stufe zu hoch', begruendung: '', nutzen: '',
        regel: { ...emptyRule, name: 'Zu hoch', vorgang: 'VOR-5', ausloeser: 'manuell', aktion: 'kalendereintrag', stufe: 3, termin_titel: 'Spendenbescheinigungen' }, katalog: emptyCat },
    ],
    rueckfragen: [],
  });
  const r = await admin.post('/api/ki/ask', { mode: 'beschreibung', text: 'Ich vergesse oft Schiedsrichter-Fristen. Ruf mich an unter 0781 123456.' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.warnings.some(w => w.includes('Telefonnummer')));
  // Was ging an Claude?
  const sent = received.at(-1);
  assert.match(sent.url, /\/v1\/messages/);
  assert.match(String(sent.headers['anthropic-beta']), /server-side-fallback-2026-07-01/);
  assert.equal(sent.body.model, 'claude-opus-5-5');
  assert.equal(sent.body.fallbacks, 'default');
  assert.equal(sent.body.output_config.format.type, 'json_schema');
  assert.ok(!JSON.stringify(sent.body).includes('0781 123456'), 'Telefonnummer wird nicht übertragen');
  assert.ok(!sent.body.tools, 'Claude bekommt keine Werkzeuge');

  const req = await admin.get(`/api/ki/requests/${r.data.id}`);
  assert.deepEqual(req.data.checks.map(c => c.ok), [true, false, true, false, false]);
  assert.match(req.data.checks[1].fehler[0], /T-GIBTSNICHT/);
  assert.match(req.data.checks[4].fehler[0], /Höchststufe|nie ausführen/);
  assert.equal(req.data.cost_usd, 0.0308);

  let a = await admin.post(`/api/ki/requests/${r.data.id}/apply`, { index: 0 });
  assert.equal(a.data.type, 'regel');
  const rules = await admin.get('/api/rules');
  const rule = rules.data.find(x => x.id === a.data.id);
  assert.equal(rule.approved, 0, 'neue Regel wartet auf Freigabe');
  assert.equal(rule.trigger_config.tage_vorher, 2);
  assert.equal(rule.action_config.auch_vertretung, true);
  a = await admin.post(`/api/ki/requests/${r.data.id}/apply`, { index: 0 });
  assert.equal(a.status, 400, 'nicht doppelt');
  a = await admin.post(`/api/ki/requests/${r.data.id}/apply`, { index: 1 });
  assert.equal(a.status, 400, 'ungültiger Vorschlag nicht übernehmbar');
  a = await admin.post(`/api/ki/requests/${r.data.id}/apply`, { index: 3 });
  assert.equal(a.status, 400, '„nicht möglich“ nicht übernehmbar');
  a = await admin.post(`/api/ki/requests/${r.data.id}/apply`, { index: 2 });
  assert.equal(a.data.type, 'katalog');
  const cat = await admin.get('/api/catalog');
  const sk = cat.data.find(c => c.key === 'sponsor_kontakt');
  assert.equal(sk.enabled, true);
  assert.equal(sk.params[0].value, 120);
});

test('Ideen finden: nur grüne Aufgaben werden übertragen', async () => {
  await admin.post('/api/tasks', { area_id: ctx.areas['ttsf-hohberg'], title: 'Hallenschlüssel beim Hausmeister holen', data_class: 'gruen' });
  await admin.post('/api/tasks', { area_id: ctx.areas['ttsf-hohberg'], title: 'Neuaufnahme Geheimname Mustermann', data_class: 'gelb' });
  nextResponse = message({ zusammenfassung: 'Keine Vorschläge.', vorschlaege: [], rueckfragen: ['Wie oft wird der Schlüssel gebraucht?'] });
  const r = await admin.post('/api/ki/ask', { mode: 'ideen', text: '' });
  assert.equal(r.status, 200);
  const sent = JSON.stringify(received.at(-1).body);
  assert.ok(sent.includes('Hallenschlüssel'));
  assert.ok(!sent.includes('Geheimname'), 'gelbe Aufgaben bleiben in der App');
  const pre = await admin.get('/api/ki/preview?mode=ideen');
  assert.ok(pre.data.ctx.statistik_90_tage);
});

test('Ablehnung durch Claude wird sauber gemeldet und protokolliert', async () => {
  nextResponse = message({ zusammenfassung: '', vorschlaege: [], rueckfragen: [] }, 'refusal');
  const r = await admin.post('/api/ki/ask', { mode: 'beschreibung', text: 'Etwas, das abgelehnt wird, zum Test.' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /abgelehnt/);
  const list = await admin.get('/api/ki/requests');
  assert.equal(list.data[0].status, 'abgelehnt');
  const log = await admin.get('/api/audit?entity=ki');
  assert.ok(log.data.length >= 3);
});

test('Zuarbeit hat keinen Zugriff', async () => {
  const u = await admin.post('/api/users', { name: 'Zoe', login: 'zoe', role: 'zuarbeit', areas: [ctx.areas['buehlertal']], password: 'Noppen-Belag-77#' });
  const zoe = app.client();
  await zoe.post('/api/auth/login', { login: 'zoe', password: 'Noppen-Belag-77#' });
  await zoe.post('/api/auth/password', { current: 'Noppen-Belag-77#', password: 'Andere-Kelle-88#' });
  const r = await zoe.post('/api/ki/ask', { mode: 'ideen' });
  assert.equal(r.status, 403);
  assert.ok(u.data.id);
});

test('KI schlägt Ablageregeln vor; Adressen werden abgewiesen', async () => {
  const emptyFiling = { name: '', bedingung_bereich: '', absender_enthaelt: '', betreff_enthaelt: '', dateiname_enthaelt: '', dateitypen: '', zielbereich: '',
    ordner: '', datenklasse: 'gelb', anlass: '', modus: 'vormerken', vorgang: '', sharepoint: false, mail_entfernen: false };
  nextResponse = message({
    zusammenfassung: 'Zwei Ablageregeln.',
    vorschlaege: [
      { art: 'ablageregel', titel: 'Sponsorenrechnungen', begruendung: 'Rechnungen landen gesammelt im Ordner.', nutzen: 'Findet man wieder', regel: emptyRule, katalog: emptyCat,
        ablageregel: { ...emptyFiling, name: 'Sponsorenrechnungen', betreff_enthaelt: 'Rechnung', dateitypen: 'pdf', zielbereich: 'TTSF Hohberg', ordner: 'Sponsoring/Rechnungen', modus: 'ablegen', datenklasse: 'gruen', sharepoint: true } },
      { art: 'ablageregel', titel: 'Kaputt', begruendung: '', nutzen: '', regel: emptyRule, katalog: emptyCat,
        ablageregel: { ...emptyFiling, name: 'Mit Adresse', absender_enthaelt: 'kassierer@verein.de', ordner: 'Kasse' } },
    ],
    rueckfragen: [],
  });
  const r = await admin.post('/api/ki/ask', { mode: 'beschreibung', text: 'Rechnungen von Sponsoren sollen immer in einen eigenen Ordner.' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(JSON.stringify(received.at(-1).body.output_config.format.schema).includes('ablageregel'));
  const req = await admin.get(`/api/ki/requests/${r.data.id}`);
  assert.deepEqual(req.data.checks.map(c => c.ok), [true, false]);
  assert.match(req.data.checks[1].fehler[0], /Mailadresse/);
  const a = await admin.post(`/api/ki/requests/${r.data.id}/apply`, { index: 0 });
  assert.equal(a.data.type, 'ablageregel');
  const rules = await admin.get('/api/filing-rules');
  const fr = rules.data.rules.find(x => x.id === a.data.id);
  assert.equal(fr.folder, 'Sponsoring/Rechnungen');
  assert.equal(fr.mirror, 1);
  assert.match(fr.origin, /KI-Vorschlag/);
});
