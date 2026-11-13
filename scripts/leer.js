// Startet eine LEERE App in einem eigenen Datenverzeichnis (data-leer/), um die Ersteinrichtung
// mit dem Einrichtungsassistenten durchzuspielen. Die echten Daten in data/ bleiben unberührt.
//
//   npm run leer            → http://localhost:3003 (vorhandener Stand bleibt erhalten)
//   npm run leer -- --neu   → vorher alles in data-leer/ löschen und ganz von vorn beginnen

import fs from 'node:fs';
import path from 'node:path';

process.env.DATA_DIR ||= 'data-leer';
process.env.PORT ||= '3003';
process.env.TTE_LEER = '1';
const { config } = await import('../server/config.js');

if (process.argv.includes('--neu')) {
  // Sicherheitsnetz: nur ein Verzeichnis löschen, das wirklich data-leer heißt
  if (path.basename(config.dataDir) !== 'data-leer') { console.error('Abbruch: --neu nur für data-leer.'); process.exit(1); }
  fs.rmSync(config.dataDir, { recursive: true, force: true });
  console.log('data-leer/ geleert.');
}

const { createServer } = await import('../server/index.js');
const { startScheduler } = await import('../server/services/scheduler.js');
const server = createServer();
server.listen(config.port, config.host, () => {
  console.log(`Leere App läuft auf http://localhost:${config.port}`);
  console.log('Erstes Konto anlegen → der Einrichtungsassistent startet automatisch.');
});
startScheduler();
