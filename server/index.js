// Einstieg: Datenbank öffnen, Grunddaten anlegen, Schnittstellen laden, Server und Zeitplan starten.

import http from 'node:http';
import { config } from './config.js';
import { openDb } from './db.js';
import { seedBase, seedUpgrades } from './seed.js';
import { setM365Check } from './services/catalog.js';
import { isConfigured as m365Configured } from './connectors/m365.js';
import { handle } from './http.js';
import { startScheduler } from './services/scheduler.js';

// Schnittstellen registrieren sich beim Import selbst (siehe http.js → route)
import './api/auth.js';
import './api/admin.js';
import './api/tasks.js';
import './api/templates.js';
import './api/calendar.js';
import './api/files.js';
import './api/automation.js';
import './api/inbox.js';
import './api/knowledge.js';
import './api/reports.js';
import './api/connections.js';
import './api/ki.js';

export function createServer() {
  openDb();
  seedBase();
  seedUpgrades();
  setM365Check(m365Configured);
  return http.createServer((req, res) => {
    handle(req, res).catch(err => {
      console.error(err);
      if (!res.headersSent) { res.writeHead(500); res.end(); }
    });
  });
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const server = createServer();
  server.listen(config.port, config.host, () => {
    console.log(`Ehrenamt-App läuft auf http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
    console.log(`Daten: ${config.dataDir}`);
  });
  startScheduler();
  const stop = () => { console.log('Beende …'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
