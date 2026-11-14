// Vorstandsarbeit-Simulator: eine virtuelle Vereinswelt und daneben eine LEERE App.
//
//   Vereinswelt  http://localhost:3002   Postfächer, Briefkasten, WhatsApp, Vereinsordner, click-TT, Ereignisse
//   App          http://localhost:3004   startet leer – du richtest sie für den Verein ein, als ob ihr sie neu einführt
//
//   npm run simulator                 Stand fortsetzen
//   npm run simulator -- --neu        alles von vorn (data-simulator/ wird geleert)
//   npm run simulator -- --echte-ki   echten Claude statt Nachbau (ANTHROPIC_API_KEY aus der .env; nur grüne Fantasiedaten)
//
// Alles liegt in data-simulator/ (App-Datenbank und Welt getrennt). Die echten Daten in data/ bleiben unberührt.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WELT_PORT = Number(process.env.WELT_PORT || 3002);
const APP_PORT = Number(process.env.APP_PORT || 3004);
const simDir = path.resolve(root, process.env.SIM_DATA_DIR || 'data-simulator');

if (process.argv.includes('--neu')) {
  if (!/data-simulator/.test(path.basename(simDir))) { console.error('Abbruch: --neu nur für data-simulator*-Ordner.'); process.exit(1); }
  fs.rmSync(simDir, { recursive: true, force: true });
  console.log('data-simulator/ geleert – die Vereinswelt beginnt von vorn.');
}

process.env.DATA_DIR = path.join(simDir, 'app');
process.env.PORT = String(APP_PORT);
process.env.TTE_SIMULATOR = '1';
process.env.TTE_LEER = '1';
process.env.TTE_WELT_URL = `http://localhost:${WELT_PORT}`;
const echteKi = process.argv.includes('--echte-ki');

// Nachbau-Dienste VOR dem Laden der App-Konfiguration eintragen (die .env überschreibt gesetzte Werte nicht)
const { dienstEnv } = await import('../simulator/welt/dienste.js');
dienstEnv(`http://127.0.0.1:${WELT_PORT}`, { echteKi });
const { config } = await import('../server/config.js');
if (echteKi && !process.env.ANTHROPIC_API_KEY) console.warn('Hinweis: --echte-ki, aber kein ANTHROPIC_API_KEY in der .env – der KI-Bereich bleibt gesperrt.');

const { openWelt, W, save } = await import('../simulator/welt/zustand.js');
const { erschaffen, history } = await import('../simulator/welt/verein.js');
const { mail } = await import('../simulator/welt/kanaele.js');
const { restoreClock } = await import('../simulator/welt/motor.js');
const { createWeltServer } = await import('../simulator/welt/server.js');
const { createServer } = await import('../server/index.js');
const { startScheduler } = await import('../server/services/scheduler.js');

const neu = !openWelt(path.join(simDir, 'welt'));
if (neu) {
  erschaffen();
  history((mb, m) => mail(mb, { ...m, attachments: m.attachments || [] }));
  save(true);
}
restoreClock();
// Ältere Welten ohne Jugendplaner nachrüsten
if (!W().jp) { const { jugendplanerFor } = await import('../simulator/welt/verein.js'); W().jp = jugendplanerFor(W().games); save(true); }

const app = createServer();
const welt = createWeltServer({ appUrl: `http://localhost:${APP_PORT}`, base: `http://localhost:${WELT_PORT}` });
welt.listen(WELT_PORT, '127.0.0.1', () => {
  app.listen(APP_PORT, config.host, () => {
    console.log('');
    console.log(`  Vereinswelt (TTV Musterhausen):  http://localhost:${WELT_PORT}`);
    console.log(`  Ehrenamt-App (startet leer):     http://localhost:${APP_PORT}`);
    console.log('');
    console.log(neu ? '  Neue Welt angelegt. Öffne die Vereinswelt und beginne mit Kapitel 1.' : `  Weiter an Tag ${Math.round((Date.parse(new Date(Date.now() + (W().offset || 0)).toISOString().slice(0, 10)) - Date.parse(W().start)) / 86_400_000)} der Simulation.`);
  });
});
startScheduler();
const stop = () => { save(true); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
