// Sicherung: konsistente Kopie der Datenbank (VACUUM INTO) und der Ablage nach backups/<Zeitstempel>/.
//   npm run backup
// Läuft auch bei laufendem Server. Sicherungen regelmäßig an einen zweiten Ort kopieren.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../server/config.js';

if (!fs.existsSync(config.dbFile)) {
  console.error(`Keine Datenbank gefunden unter ${config.dbFile}`);
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const target = path.resolve(config.root, process.env.BACKUP_DIR || 'backups', stamp);
fs.mkdirSync(target, { recursive: true });
const db = new DatabaseSync(config.dbFile);
const out = path.join(target, 'ehrenamt.sqlite').replace(/'/g, "''");
db.exec(`VACUUM INTO '${out}'`);
db.close();
if (fs.existsSync(config.uploadDir)) fs.cpSync(config.uploadDir, path.join(target, 'ablage'), { recursive: true });
console.log(`Sicherung erstellt: ${target}`);
