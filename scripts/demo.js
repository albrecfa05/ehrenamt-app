// Startet die App mit Beispieldaten in einem EIGENEN Datenverzeichnis (data-demo/).
// Die echten Daten in data/ bleiben unberührt. Zum Ausprobieren und für Schulungen.
//
//   npm run demo            → http://localhost:3001
//   Zugang: steht in data-demo/DEMO-ZUGANG.txt

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

process.env.DATA_DIR ||= 'data-demo';
process.env.PORT ||= '3001';
const { config } = await import('../server/config.js');
const { createServer } = await import('../server/index.js');
const { q } = await import('../server/db.js');
const { hashPassword, randomToken } = await import('../server/auth.js');
const { createTask, updateTask } = await import('../server/services/tasks.js');
const { addDays, nowIso, today } = await import('../server/util.js');
const { startScheduler } = await import('../server/services/scheduler.js');

const server = createServer();
const zugang = path.join(config.dataDir, 'DEMO-ZUGANG.txt');

if (!q.get('SELECT 1 FROM users LIMIT 1')) {
  const pw = `Demo-${crypto.randomBytes(4).toString('hex')}-Kelle!`;
  const mk = (name, login, role) => Number(q.run(`INSERT INTO users (name, login, pw_hash, role, created_at, calendar_token) VALUES (?, ?, ?, ?, ?, ?)`, name, login, hashPassword(pw), role, nowIso(), randomToken()).lastInsertRowid);
  const a1 = mk('Demo Admin', 'demo', 'admin');
  const a2 = mk('Zweiter Admin', 'demo2', 'admin');
  const z = mk('Zuarbeit Jugend', 'jugend', 'zuarbeit');
  fs.writeFileSync(zugang, `Demo-Zugänge (nur für data-demo)\n\nAdmin:     demo  / ${pw}\nAdmin 2:   demo2 / ${pw}\nZuarbeit:  jugend / ${pw}\n`);
  const area = Object.fromEntries(q.all('SELECT id, key FROM areas').map(r => [r.key, r.id]));
  q.run('INSERT INTO user_areas (user_id, area_id) VALUES (?, ?)', z, area['ttsf-hohberg']);
  const office = (a, n) => q.get('SELECT id FROM offices WHERE area_id = ? AND name = ?', area[a], n)?.id;
  q.run('UPDATE offices SET holder_id = ?, deputy_id = ? WHERE area_id = ?', a1, a2, area['ttsf-hohberg']);
  q.run('UPDATE offices SET holder_id = ?, deputy_id = ? WHERE area_id = ?', a2, a1, area['bezirk-mittelbaden']);
  q.run('UPDATE offices SET holder_id = ? WHERE id = ?', z, office('ttsf-hohberg', 'Jugendwart'));
  const tpl = (k) => q.get('SELECT id FROM process_templates WHERE key = ?', k).id;
  const admin = { id: a1, name: 'Demo Admin' };
  const d = today();
  const back = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

  const t = (o) => createTask(admin, { channel: 'manuell', ...o });
  const ids = [];
  ids.push(t({ area_id: area['ttsf-hohberg'], title: 'Neuaufnahme Lea K.', template_id: tpl('VOR-1'), office_id: office('ttsf-hohberg', 'Mitgliederverwaltung'), due_date: addDays(d, 3), channel: 'post' }));
  ids.push(t({ area_id: area['ttsf-hohberg'], title: 'Schiedsrichter-Ersatz für Samstag', template_id: tpl('VOR-3'), office_id: office('ttsf-hohberg', 'Sportwart'), due_date: addDays(d, 1), channel: 'whatsapp' }));
  ids.push(t({ area_id: area['ttsf-hohberg'], title: 'Spielbericht Herren I gegen Offenburg', template_id: tpl('VOR-7'), office_id: office('ttsf-hohberg', 'Öffentlichkeitsarbeit'), due_date: addDays(d, -2) }));
  ids.push(t({ area_id: area['ttsf-hohberg'], title: 'Budgetplan Q4 aktualisieren', template_id: tpl('VOR-10'), office_id: office('ttsf-hohberg', 'Kasse'), due_date: addDays(d, 10) }));
  ids.push(t({ area_id: area['ttsf-hohberg'], title: 'Elterninfo Bezirksranglisten Jugend', template_id: tpl('VOR-14'), owner_id: z, due_date: addDays(d, 6) }));
  ids.push(t({ area_id: area['buehlertal'], title: 'Hallenbelegung Rückrunde mit Gemeinde klären', description: 'Gemeinde hat neue Belegungszeiten angekündigt.', due_date: addDays(d, 14), owner_id: a2 }));
  ids.push(t({ area_id: area['buehlertal'], title: 'Sponsorvertrag Bäckerei verlängern', template_id: tpl('VOR-6'), due_date: addDays(d, 20), owner_id: a2 }));
  ids.push(t({ area_id: area['bezirk-mittelbaden'], title: 'Schiedsrichtereinteilung Rückrunde', template_id: tpl('VOR-12'), office_id: office('bezirk-mittelbaden', 'Schiedsrichterwart'), due_date: addDays(d, 25) }));
  ids.push(t({ area_id: area['bezirk-mittelbaden'], title: 'Bezirksmeisterschaften Jugend ankündigen', template_id: tpl('VOR-13'), due_date: addDays(d, -5) }));
  ids.push(t({ area_id: area['bezirk-mittelbaden'], title: 'Protokoll Bezirksvorstandssitzung fertigstellen', template_id: tpl('VOR-8'), due_date: addDays(d, 4) }));
  t({ area_id: area['ttsf-hohberg'], kind: 'idee', title: 'Vereinsmeisterschaft mit Doppel-Turnier verbinden', description: 'Vorschlag aus der Mitgliederversammlung.' });
  t({ area_id: area['buehlertal'], kind: 'idee', title: 'Schnuppertraining für Erwachsene' });
  // Zustände und Geschichte
  const get = (id) => q.get('SELECT * FROM tasks WHERE id = ?', id);
  updateTask(admin, get(ids[2]), { status: 'wartet', waiting_who: 'Kapitän Herren I', waiting_what: 'Bilder und Einzelergebnisse' });
  const steps0 = q.all('SELECT id FROM task_steps WHERE task_id = ? ORDER BY pos', ids[0]);
  q.run('UPDATE task_steps SET done = 1, done_by = ?, done_at = ? WHERE id IN (?, ?)', a1, nowIso(), steps0[0].id, steps0[1].id);
  updateTask(admin, get(ids[0]), { status: 'in_arbeit' });
  q.run('INSERT INTO comments (task_id, user_id, body, created_at) VALUES (?, ?, ?, ?)', ids[0], a1, 'Antrag ist da, SEPA-Mandat liegt bei.', nowIso());
  q.run('UPDATE tasks SET created_at = ?, last_activity_at = ? WHERE id = ?', back(16), back(12), ids[5]);
  q.run('UPDATE tasks SET created_at = ?, last_activity_at = ? WHERE id = ?', back(20), back(20), ids[8]);
  // Abgeschlossene Vorgänge für Kennzahlen und Erfahrungswerte
  for (let i = 0; i < 9; i++) {
    const created = back(30 * (i % 5) + 18);
    const id = t({ area_id: area['ttsf-hohberg'], title: `Kleinanfrage Spielverlegung ${i + 1}`, template_id: tpl('VOR-3'), office_id: office('ttsf-hohberg', 'Sportwart') });
    const start = new Date(Date.parse(created) + (2 + (i % 6)) * 86_400_000).toISOString();
    const end = new Date(Date.parse(start) + 86_400_000 * (1 + (i % 3))).toISOString();
    q.run(`UPDATE tasks SET status = 'erledigt', created_at = ?, started_at = ?, completed_at = ?, last_activity_at = ?, lessons = ? WHERE id = ?`,
      created, start, end, end, i === 8 ? 'Staffelleitung antwortet schneller per Mail als per Telefon.' : '', id);
    q.run('INSERT INTO time_entries (task_id, user_id, minutes, note, created_at) VALUES (?, ?, ?, ?, ?)', id, a1, 5 + (i % 4), '', end);
  }
  q.run('INSERT INTO learnings (date, topic, rule, origin, template_id, area_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    d, 'Verlegungen', 'Verlegungsanträge immer mit zwei Alternativterminen stellen.', 'Erfahrung Herbst', tpl('VOR-3'), null, a1, nowIso());
  // Eingang
  const { inspectInbound } = await import('../server/guards.js');
  const inbox = (channel, sender, subject, body) => q.run(`INSERT INTO inbox (area_id, channel, sender, subject, body, received_at, suggestion, flags, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    area['ttsf-hohberg'], channel, sender, subject, body, nowIso(), JSON.stringify({ area_id: area['ttsf-hohberg'], title: subject, due_date: addDays(d, 7) }), JSON.stringify(inspectInbound(subject + body)), a1, nowIso());
  inbox('whatsapp', 'Trainer Jonas', 'Bilder vom Jugendturnier', 'Hab euch 12 Bilder vom Turnier geschickt, könnt ihr was für die Homepage machen?');
  inbox('mail', 'Unbekannt', 'Dringend: Rechnung', 'Bitte überweisen Sie heute noch 480 €. Neue Bankverbindung im Anhang.');
  // Regeln freigeben
  for (const r of q.all('SELECT id FROM rules')) q.run('UPDATE rules SET approved = 1, approved_by = ?, approved_at = ?, active = 1 WHERE id = ?', a1, nowIso(), r.id);
  q.run('INSERT INTO events (area_id, title, date, time, location, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', area['ttsf-hohberg'], 'Vorstandssitzung', addDays(d, 8), '19:30', 'Vereinsheim', a1, nowIso());
  console.log('Demo-Daten angelegt.');
}

// Beispiel-Sponsoren (auch für ältere Demo-Ordner nachgetragen)
if (!q.get('SELECT 1 FROM sponsors LIMIT 1')) {
  const area = q.get(`SELECT id FROM areas WHERE key = 'ttsf-hohberg'`).id;
  const bt = q.get(`SELECT id FROM areas WHERE key = 'buehlertal'`).id;
  const god = q.get(`SELECT id FROM users WHERE login = 'demo'`)?.id ?? null;
  const ins = (a, company, contact, cat, end, status = 'aktiv', lastContact = null) => q.run(
    `INSERT INTO sponsors (area_id, company, contact_name, godparent_id, category, start_date, end_date, status, last_contact, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    a, company, contact, god, cat, '2024-07-01', end, status, lastContact, nowIso(), nowIso());
  ins(area, 'Bäckerei Sonnenschein', 'Frau Weber', 'Bande', addDays(today(), 45), 'aktiv', addDays(today(), -200));
  ins(area, 'Autohaus Ortenau', 'Herr Kern', 'Trikot', addDays(today(), 400));
  ins(bt, 'Getränke Huber', '', 'Förderer', null, 'verhandlung');
}

server.listen(config.port, config.host, () => {
  console.log(`Demo läuft auf http://localhost:${config.port}`);
  console.log(`Zugänge: ${zugang}`);
});
startScheduler();
