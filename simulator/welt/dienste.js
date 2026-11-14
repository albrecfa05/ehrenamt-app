// Nachbauten der externen Dienste, wie die App sie sieht:
//   /m365/…      Microsoft-Anmeldung und Graph (Postfächer der Welt, Entwürfe, Kalender, SharePoint)
//   /clicktt/…   Spielpläne als ICS-Abo
//   /anthropic/… Claude (nur ohne --echte-ki)
// Was die App „nach außen“ tut, landet sichtbar in der Welt: Entwürfe im Ordner „Entwürfe“
// des Postfachs, Termine und SharePoint-Dateien im Microsoft-365-Bereich.

import { clockNow } from '../../server/clock.js';
import { W, save, putFile, newId, readFile, fileMeta, log } from './zustand.js';
import { TEAMS } from './verein.js';
import { JP_SECRET } from './jugendplaner.js';

const TOKEN = 'vereinswelt-token';

function aussen(kind, text, extra = {}) {
  W().aussen.push({ at: clockNow().toISOString(), kind, text, ...extra });
  if (W().aussen.length > 300) W().aussen.splice(0, W().aussen.length - 300);
  save();
}

// ---------- click-TT ----------
function ics(team) {
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vereinswelt//click-TT-Nachbau//DE', `X-WR-CALNAME:${esc(TEAMS[team]?.name || team)}`];
  for (const g of W().games.filter(x => x.team === team)) {
    const [hh, mm] = g.time.split(':');
    const end = `${String(Math.min(23, Number(hh) + 3)).padStart(2, '0')}${mm}00`;
    const d = g.date.replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${g.uid}@clicktt.example`, `SUMMARY:${esc(g.summary)}`, `LOCATION:${esc(g.location)}`,
      `DTSTART;TZID=Europe/Berlin:${d}T${hh}${mm}00`, `DTEND;TZID=Europe/Berlin:${d}T${end}`, ...(g.cancelled ? ['STATUS:CANCELLED'] : []), 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// ---------- Claude ----------
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
function claude(body) {
  const schema = body?.output_config?.format?.schema;
  const out = blank(schema) || {};
  const props = schema?.properties || {};
  if (props.vorschlaege) {
    const item = props.vorschlaege.items;
    const rule = blank(item.properties.regel);
    const cat = blank(item.properties.katalog);
    out.zusammenfassung = 'Claude-Nachbau der Vereinswelt: zwei feste Beispielvorschläge, unabhängig vom Text. Für echte Vorschläge den Simulator mit --echte-ki starten.';
    out.vorschlaege = [
      { ...blank(item), art: 'regel', titel: 'Erinnerung zwei Tage vor Schiedsrichter-Fristen', begruendung: 'Kurzfristige Ersatzsuche ist das häufigste Ärgernis im Spielbetrieb.', nutzen: 'weniger Hektik am Spieltag',
        regel: { ...rule, name: 'SR-Fristen 2 Tage vorher', beschreibung: 'Erinnert zwei Tage vor Fälligkeit an Schiedsrichter-Vorgänge.', vorgang: 'VOR-3', ausloeser: 'frist', tage_vorher: 2, aktion: 'erinnern', stufe: 1, nachricht: 'Bitte an {{aufgabe}} denken (fällig {{frist}}).', auch_vertretung: true }, katalog: cat },
      { ...blank(item), art: 'katalog', titel: 'Kontaktpflege für Sponsoren einschalten', begruendung: 'Gibt es schon fertig im Katalog.', nutzen: 'Sponsoren fühlen sich gesehen',
        regel: rule, katalog: { ...cat, schluessel: 'sponsor_kontakt', parameter: [{ name: 'tage', wert: '120' }] } },
    ];
  } else if ('zusammenfassung' in props) out.zusammenfassung = 'Claude-Nachbau: Lage ruhig, keine Auffälligkeiten erkannt.';
  aussen('claude', 'Anfrage an den Claude-Nachbau (keine echte KI, nur grüne Daten)');
  return { id: 'msg_welt', type: 'message', role: 'assistant', model: body?.model || 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } };
}

// ---------- Microsoft Graph ----------
const toGraph = (m) => ({
  id: m.id, subject: m.subject, from: { emailAddress: { name: m.fromName, address: m.from } }, receivedDateTime: m.received,
  body: { content: m.body }, hasAttachments: m.attachments.length > 0, conversationId: m.conv, internetMessageId: `<${m.id}@vereinswelt.example>`,
});

function graph(req, url, raw, json) {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return json({ error: { code: 'InvalidAuthenticationToken', message: 'Access token is empty or invalid.' } }, 401);
  const mbRaw = url.pathname.match(/^\/m365\/graph\/users\/([^/]+)/)?.[1];
  const mb = mbRaw ? decodeURIComponent(mbRaw).toLowerCase() : null;
  if (mb && !W().mailboxes[mb]) return json({ error: { code: 'ErrorInvalidUser', message: `The requested user '${mb}' is invalid.` } }, 404);
  const p = url.pathname;
  if (/\/mailFolders\/inbox$/.test(p)) return json({ displayName: 'Posteingang', totalItemCount: W().mails.filter(m => m.mailbox === mb && m.folder === 'inbox').length });
  if (/\/mailFolders\/inbox\/messages$/.test(p)) {
    const f = url.searchParams.get('$filter') || '';
    const since = f.match(/receivedDateTime gt (\S+)/)?.[1] || '';
    const list = W().mails.filter(m => m.mailbox === mb && m.folder === 'inbox' && m.received > since && m.received <= clockNow().toISOString())
      .sort((a, b) => a.received.localeCompare(b.received)).slice(0, 50);
    return json({ value: list.map(toGraph) });
  }
  const att = p.match(/\/messages\/([^/]+)\/attachments$/);
  if (att) {
    const m = W().mails.find(x => x.id === decodeURIComponent(att[1]));
    return json({ value: (m?.attachments || []).filter(fid => readFile(fid)).map(fid => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: fileMeta(fid).name, contentType: fileMeta(fid).mime, contentBytes: readFile(fid).toString('base64'), isInline: false })) });
  }
  if (req.method === 'POST' && /\/users\/[^/]+\/messages$/.test(p)) {
    const b = JSON.parse(raw.toString('utf8') || '{}');
    const id = newId('m');
    W().mails.push({ id, mailbox: mb, folder: 'drafts', from: mb, fromName: W().mailboxes[mb], to: '', subject: b.subject || '', body: b.body?.content || '', received: clockNow().toISOString(), read: false, conv: `conv-${id}`, source: 'app', attachments: [] });
    aussen('entwurf', `Entwurf im Postfach ${mb}: „${b.subject}“ – liegt im Ordner „Entwürfe“ der Vereinswelt zum Verschicken.`);
    log(`Die App hat einen Entwurf ins Postfach ${mb} gelegt: „${b.subject}“.`);
    return json({ id, conversationId: `conv-${id}`, webLink: `http://localhost/vereinswelt/#postfach/${id}` }, 201);
  }
  if (req.method === 'POST' && /\/events$/.test(p)) {
    const b = JSON.parse(raw.toString('utf8') || '{}');
    aussen('termin', `Termin im Kalender von ${mb}: „${b.subject}“ am ${String(b.start?.dateTime || '').slice(0, 10)}`, { mailbox: mb, title: b.subject, date: String(b.start?.dateTime || '').slice(0, 10) });
    return json({ id: newId('ev') }, 201);
  }
  if (req.method === 'PUT' && /:\/content$/.test(p)) {
    const rel = decodeURIComponent(p.split('/root:/')[1] || '').replace(/:\/content$/, '');
    const fid = putFile(rel.split('/').pop(), 'application/octet-stream', raw);
    aussen('ablage', `Datei in SharePoint: ${rel}`, { file: fid, path: rel });
    return json({ id: fid, webUrl: `https://ttvmusterhausen.sharepoint.example/${encodeURI(rel)}`, size: raw.length }, 201);
  }
  if (/\/drive$/.test(p)) return json({ name: 'Vereinsablage (SharePoint der Vereinswelt)', webUrl: 'https://ttvmusterhausen.sharepoint.example/' });
  return json({ error: { code: 'NotImplemented', message: `In der Vereinswelt nicht nachgebaut: ${req.method} ${p}` } }, 404);
}

/** Behandelt eine Anfrage an die Nachbau-Dienste. Gibt false zurück, wenn sie nicht hierher gehört. */
export async function handleDienst(req, res, url) {
  if (!/^\/(m365|clicktt|anthropic)\//.test(url.pathname)) return false;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (url.pathname.startsWith('/anthropic/')) { json(claude(JSON.parse(raw.toString('utf8') || '{}'))); return true; }
  if (url.pathname.includes('/oauth2/v2.0/token')) { json({ access_token: TOKEN, token_type: 'Bearer', expires_in: 3600 }); return true; }
  const team = url.pathname.match(/^\/clicktt\/([\w-]+)\.ics$/)?.[1];
  if (team) {
    if (!TEAMS[team]) { res.writeHead(404); res.end('Unbekannte Mannschaft'); return true; }
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' }); res.end(ics(team)); return true;
  }
  if (url.pathname.startsWith('/m365/graph/')) { graph(req, url, raw, json); return true; }
  json({ error: 'unbekannt' }, 404);
  return true;
}

/** Umgebungsvariablen, mit denen die App die Nachbauten statt der echten Dienste nutzt. */
export function dienstEnv(base, { echteKi = false } = {}) {
  process.env.M365_TENANT_ID = 'ttv-musterhausen';
  process.env.M365_CLIENT_ID = 'vereinswelt-app-registrierung';
  process.env.M365_CLIENT_SECRET = 'vereinswelt-geheimnis-nur-fantasie';
  process.env.M365_LOGIN_URL = `${base}/m365`;
  process.env.M365_GRAPH_URL = `${base}/m365/graph`;
  process.env.JUGENDPLANER_URL = `${base}/jugendplaner`;
  process.env.JUGENDPLANER_SECRET = JP_SECRET;
  delete process.env.JUGENDPLANER_PIN;
  if (!echteKi) {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-vereinswelt-kein-echter-schluessel';
    process.env.ANTHROPIC_BASE_URL = `${base}/anthropic`;
  }
}
