// Zentrale Konfiguration. Alles lässt sich über Umgebungsvariablen setzen,
// damit dieselbe App lokal, auf einem Vereins-Server oder bei einem Hoster läuft.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Zugangsdaten für Schnittstellen (z. B. Microsoft 365) stehen in einer .env-Datei neben package.json,
// nie in der Datenbank oder der Oberfläche (Datenampel: Zugangsdaten = rot). Vorlage: .env.beispiel
try { process.loadEnvFile(path.join(root, process.env.ENV_FILE || '.env')); } catch { /* keine .env vorhanden */ }
const dataDir = path.resolve(root, process.env.DATA_DIR || 'data');

export const config = {
  root,
  dataDir,
  dbFile: path.join(dataDir, 'ehrenamt.sqlite'),
  uploadDir: path.join(dataDir, 'ablage'),
  publicDir: path.join(root, 'public'),
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  // Hinter einem HTTPS-Proxy (z. B. Caddy, nginx) auf "1" setzen, damit Cookies das Secure-Flag bekommen.
  secureCookies: process.env.SECURE_COOKIES === '1',
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024,
  timezone: 'Europe/Berlin',
  // Zeitplan-Prüfung (Erinnerungen, wiederkehrende Aufgaben, Regeln) in Millisekunden
  schedulerIntervalMs: Number(process.env.SCHEDULER_INTERVAL_MS || 60_000),
  disableScheduler: process.env.DISABLE_SCHEDULER === '1',
};
