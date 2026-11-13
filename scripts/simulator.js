// Vorstandsarbeit-Simulator: eine eigene App-Instanz mit erfundenem Demo-Verein, nachgebauten
// Diensten (Microsoft 365, click-TT, Claude) und Szenarien aus typischen Vereinsproblemen.
// Eigenes Datenverzeichnis (data-simulator/), die echten Daten in data/ bleiben unberührt.
//
//   npm run simulator                  → http://localhost:3002
//   npm run simulator -- --neu         → Simulator ganz von vorn (data-simulator/ wird geleert)
//   npm run simulator -- --echte-ki    → echten Claude nutzen (ANTHROPIC_API_KEY aus der .env; nur Fantasiedaten)
//
// Zugänge: data-simulator/SIMULATOR-ZUGANG.txt

import fs from 'node:fs';
import path from 'node:path';

process.env.DATA_DIR ||= 'data-simulator';
process.env.PORT ||= '3002';
process.env.TTE_SIMULATOR = '1';
const { config } = await import('../server/config.js');

if (process.argv.includes('--neu')) {
  if (path.basename(config.dataDir) !== 'data-simulator') { console.error('Abbruch: --neu nur für data-simulator.'); process.exit(1); }
  fs.rmSync(config.dataDir, { recursive: true, force: true });
  console.log('data-simulator/ geleert.');
}

const realClaude = process.argv.includes('--echte-ki') && !!process.env.ANTHROPIC_API_KEY;
const { q } = await import('../server/db.js');
const { startFakes, fakeBase } = await import('../server/sim/fakes.js');
await startFakes({ realClaude });
const { SIM_AREAS, seedWorld, SATZUNG, BEITRAGSORDNUNG } = await import('../server/sim/world.js');
const { createServer } = await import('../server/index.js');
await import('../server/sim/api.js');
const { restoreClock } = await import('../server/sim/engine.js');
const { startScheduler } = await import('../server/services/scheduler.js');
const { resetTokenCache } = await import('../server/connectors/m365.js');

const server = createServer({ areas: SIM_AREAS });
restoreClock();
resetTokenCache();
// Der Nachbau-Server bekommt bei jedem Start einen neuen Port: Spielplan-Abos nachziehen
q.run(`UPDATE feeds SET url = ? || substr(url, instr(url, '/ics/')) WHERE url LIKE 'http://127.0.0.1:%/ics/%'`, fakeBase());

const zugang = path.join(config.dataDir, 'SIMULATOR-ZUGANG.txt');
const created = seedWorld({ fakeBase: fakeBase() });

server.listen(config.port, config.host, async () => {
  const base = `http://127.0.0.1:${config.port}`;
  if (created) {
    // Satzung und Beitragsordnung über die normale Schnittstelle aufnehmen (Abschnitte, Änderungsprotokoll)
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'tte' }, body: JSON.stringify({ login: 'mia', password: created.pw }) });
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    const ttv = q.get(`SELECT id FROM areas WHERE key = 'ttv-musterhausen'`).id;
    for (const [title, source_type, text] of [['Satzung TTV Musterhausen', 'satzung', SATZUNG], ['Beitragsordnung TTV Musterhausen', 'ordnung', BEITRAGSORDNUNG]]) {
      await fetch(`${base}/api/kb/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'tte', Cookie: cookie }, body: JSON.stringify({ title, source_type, area_id: ttv, text }) });
    }
    await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { 'X-Requested-With': 'tte', Cookie: cookie } });
    fs.writeFileSync(zugang, [
      'Vorstandsarbeit-Simulator – Zugänge (nur Fantasiedaten, nur für data-simulator)', '',
      `Passwort für alle: ${created.pw}`, '',
      'mia   Mia Muster    Admin     Vorsitzende TTV Musterhausen',
      'ben   Ben Beispiel  Admin     Kassenwart TTV, Abteilungsleiter SV Beispieldorf',
      'tom   Tom Turnier   Admin     Bezirkssportwart, Schiedsrichterwart',
      'jana  Jana Jugend   Zuarbeit  Jugendwartin TTV',
      'paul  Paul Presse   Zuarbeit  Öffentlichkeitsarbeit TTV', '',
    ].join('\n'));
    console.log('Demo-Verein angelegt.');
  }
  console.log(`Vorstandsarbeit-Simulator läuft auf http://localhost:${config.port}`);
  console.log(`Zugänge: ${zugang}`);
  console.log(`Nachbau-Dienste (Microsoft 365, click-TT${realClaude ? '' : ', Claude'}): ${fakeBase()}`);
});
startScheduler();
