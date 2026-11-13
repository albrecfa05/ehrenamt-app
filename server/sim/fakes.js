// Vorstandsarbeit-Simulator: Nachbauten der externen Dienste, alle lokal in diesem Prozess.
//   • Microsoft Graph (Postfächer, Entwürfe, Kalender, Ablage)  → nichts verlässt den Rechner
//   • click-TT-Spielpläne als ICS-Abo                             → Spiele relativ zum simulierten Datum
//   • Claude (nur wenn kein echter API-Schlüssel in der .env steht) → feste Beispielvorschläge
// Alles, was die App „nach außen“ tut, landet im Simulator-Protokoll (sim_aussen) und ist in der
// Simulator-Oberfläche sichtbar. So lässt sich auch das Verhalten mit allen Datenschutz-Schaltern
// auf „an“ ausprobieren, ohne dass echte Daten oder echte Dienste beteiligt sind.

import http from 'node:http';
import crypto from 'node:crypto';
import { getSetting, setSetting } from '../db.js';
import { clockNow } from '../clock.js';

const TOKEN = 'simulator-token';
let base = '';
export const fakeBase = () => base;

// ---------- Postfächer ----------

/** Legt eine Mail in ein simuliertes Postfach. Die App holt sie beim nächsten Abruf. */
export function queueMail(address, { from, fromName, subject, body, attachments = [], conversationId = null }) {
  const box = getSetting('sim_postfach', []);
  const id = `sim-${crypto.randomBytes(6).toString('hex')}`;
  box.push({
    id, address: address.toLowerCase(), delivered: false,
    msg: {
      id, subject, from: { emailAddress: { name: fromName || from, address: from } },
      receivedDateTime: clockNow().toISOString(), body: { content: body }, hasAttachments: attachments.length > 0,
      conversationId: conversationId || `conv-${id}`, internetMessageId: `<${id}@simulator.invalid>`,
    },
    attachments: attachments.map(a => ({ name: a.name, mime: a.mime, b64: Buffer.from(a.data).toString('base64') })),
  });
  setSetting('sim_postfach', box.slice(-300));
  return id;
}

function logOutside(kind, detail) {
  const log = getSetting('sim_aussen', []);
  log.push({ at: clockNow().toISOString(), kind, ...detail });
  setSetting('sim_aussen', log.slice(-300));
}

// ---------- Spielplan ----------

/** ICS aus den gespeicherten Simulator-Spielen einer Mannschaft. */
function icsFor(team) {
  const games = getSetting('sim_spiele', []).filter(g => g.team === team);
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vorstandsarbeit-Simulator//click-TT-Nachbau//DE'];
  for (const g of games) {
    const [hh, mm] = (g.time || '18:00').split(':');
    const end = `${String(Math.min(23, Number(hh) + 3)).padStart(2, '0')}${mm}00`;
    lines.push('BEGIN:VEVENT', `UID:${g.uid}`, `SUMMARY:${esc(g.summary)}`, `LOCATION:${esc(g.location)}`,
      `DTSTART;TZID=Europe/Berlin:${g.date.replace(/-/g, '')}T${hh}${mm}00`, `DTEND;TZID=Europe/Berlin:${g.date.replace(/-/g, '')}T${end}`,
      ...(g.cancelled ? ['STATUS:CANCELLED'] : []), 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// ---------- Claude-Nachbau ----------

/** Erzeugt aus einem JSON-Schema einen gültigen Leerwert (für den Claude-Nachbau). */
function blank(schema) {
  if (!schema) return null;
  if (schema.enum) return schema.enum[0];
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (t === 'object') return Object.fromEntries(Object.entries(schema.properties || {}).map(([k, v]) => [k, blank(v)]));
  if (t === 'array') return [];
  if (t === 'string') return '';
  if (t === 'integer' || t === 'number') return 0;
  if (t === 'boolean') return false;
  return null;
}

function fakeClaude(body) {
  const schema = body?.output_config?.format?.schema;
  const out = blank(schema) || {};
  const props = schema?.properties || {};
  if (props.vorschlaege) {
    const item = props.vorschlaege.items;
    const rule = blank(item.properties.regel);
    const cat = blank(item.properties.katalog);
    out.zusammenfassung = 'Simulierter Claude: zwei Beispielvorschläge, unabhängig vom Text. Für echte Vorschläge ANTHROPIC_API_KEY in die .env eintragen.';
    out.vorschlaege = [
      { ...blank(item), art: 'regel', titel: 'Erinnerung zwei Tage vor Schiedsrichter-Fristen', begruendung: 'Kurzfristige Ersatzsuche ist das häufigste Ärgernis im Spielbetrieb.', nutzen: 'weniger Hektik am Spieltag',
        regel: { ...rule, name: 'SR-Fristen 2 Tage vorher', beschreibung: 'Erinnert zwei Tage vor Fälligkeit an Schiedsrichter-Vorgänge.', vorgang: 'VOR-3', ausloeser: 'frist', tage_vorher: 2, aktion: 'erinnern', stufe: 1, nachricht: 'Bitte an {{aufgabe}} denken (fällig {{frist}}).', auch_vertretung: true },
        katalog: cat },
      { ...blank(item), art: 'katalog', titel: 'Kontaktpflege für Sponsoren einschalten', begruendung: 'Gibt es schon fertig im Katalog.', nutzen: 'Sponsoren fühlen sich gesehen',
        regel: rule, katalog: { ...cat, schluessel: 'sponsor_kontakt', parameter: [{ name: 'tage', wert: '120' }] } },
    ];
  } else if ('zusammenfassung' in props) {
    out.zusammenfassung = 'Simulierter Claude: Lage ruhig, keine Auffälligkeiten erkannt.';
  }
  logOutside('claude', { text: 'Anfrage an den Claude-Nachbau (keine echte KI)' });
  return { id: 'msg_sim', type: 'message', role: 'assistant', model: body?.model || 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(out) }],
    stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } };
}

// ---------- Server ----------

async function handle(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const url = decodeURIComponent(req.url);
  const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };

  if (url.startsWith('/anthropic/')) return json(fakeClaude(JSON.parse(raw.toString('utf8') || '{}')));
  if (url.includes('/oauth2/v2.0/token')) return json({ access_token: TOKEN, expires_in: 3600 });
  const ics = url.match(/^\/ics\/([\w-]+)\.ics/);
  if (ics) { res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' }); return res.end(icsFor(ics[1])); }
  if (!url.startsWith('/graph')) return json({ error: { message: 'unbekannt' } }, 404);
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return json({ error: { message: 'unauthorized' } }, 401);

  const mb = url.match(/^\/graph\/users\/([^/]+)\//)?.[1]?.toLowerCase();
  if (/\/mailFolders\/inbox\?/.test(url)) return json({ displayName: 'Posteingang (Simulator)', totalItemCount: getSetting('sim_postfach', []).filter(m => m.address === mb).length });
  if (/\/mailFolders\/inbox\/messages/.test(url)) {
    const box = getSetting('sim_postfach', []);
    const out = box.filter(m => m.address === mb && !m.delivered);
    out.forEach(m => { m.delivered = true; });
    setSetting('sim_postfach', box);
    return json({ value: out.map(m => m.msg) });
  }
  const att = url.match(/\/messages\/([^/]+)\/attachments/);
  if (att) {
    const m = getSetting('sim_postfach', []).find(x => x.id === att[1]);
    return json({ value: (m?.attachments || []).map(a => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: a.name, contentType: a.mime, contentBytes: a.b64, isInline: false })) });
  }
  if (req.method === 'POST' && /\/users\/[^/]+\/messages$/.test(url)) {
    const b = JSON.parse(raw.toString('utf8') || '{}');
    const id = `draft-${crypto.randomBytes(4).toString('hex')}`;
    logOutside('entwurf', { mailbox: mb, text: `Entwurf im Postfach ${mb}: „${b.subject}“`, subject: b.subject, body: b.body?.content?.slice(0, 2000) });
    return json({ id, conversationId: `conv-${id}`, webLink: `https://outlook.simulator.invalid/${id}` }, 201);
  }
  if (req.method === 'POST' && /\/events$/.test(url)) {
    const b = JSON.parse(raw.toString('utf8') || '{}');
    logOutside('termin', { mailbox: mb, text: `Termin im Kalender ${mb}: „${b.subject}“ am ${b.start?.dateTime?.slice(0, 10)}` });
    return json({ id: `event-${crypto.randomBytes(4).toString('hex')}` }, 201);
  }
  if (req.method === 'PUT' && /\/content$/.test(url)) {
    const path = url.split('/root:/')[1]?.replace(/:\/content$/, '') || url;
    logOutside('ablage', { text: `Datei in SharePoint: ${path} (${raw.length} Bytes)` });
    return json({ id: `file-${crypto.randomBytes(4).toString('hex')}`, webUrl: `https://sharepoint.simulator.invalid/${path}`, size: raw.length }, 201);
  }
  if (/\/drive\?/.test(url) || /\/drive$/.test(url)) return json({ name: 'Vereinsablage (Simulator)', webUrl: 'https://sharepoint.simulator.invalid/' });
  json({ error: { message: `Im Simulator nicht nachgebaut: ${req.method} ${url}` } }, 404);
}

/** Startet die Nachbauten und setzt die Umgebungsvariablen, bevor die App ihre Anschlüsse nutzt. */
export async function startFakes({ realClaude = false } = {}) {
  const server = http.createServer((req, res) => handle(req, res).catch(err => { res.writeHead(500); res.end(String(err.message)); }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.M365_TENANT_ID = 'simulator';
  process.env.M365_CLIENT_ID = 'simulator-app';
  process.env.M365_CLIENT_SECRET = 'simulator-geheimnis';
  process.env.M365_LOGIN_URL = base;
  process.env.M365_GRAPH_URL = `${base}/graph`;
  if (!realClaude) {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-simulator-kein-echter-schluessel';
    process.env.ANTHROPIC_BASE_URL = `${base}/anthropic`;
  }
  return server;
}
