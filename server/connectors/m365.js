// Anbindung an Microsoft 365 über Microsoft Graph (App-Registrierung, Anmeldung als Anwendung).
//
// Was dieser Anschluss kann – und bewusst NICHT kann:
//   ✔ Mails aus Funktionspostfächern LESEN (inkl. Anhängen)        → Eingang (AUT-4)
//   ✔ Entwürfe im Postfach ANLEGEN (nur nach Freigabe, Stufe 3)     → Mensch verschickt in Outlook (AUT-14)
//   ✔ Termine im Kalender des Funktionspostfachs anlegen (Freigabe) → Stufe 3
//   ✔ Dateien in SharePoint/OneDrive hochladen (Freigabe)          → gemeinsame Ablage (DAT-6)
//   ✔ eine Mail VERSCHICKEN – nur wenn ein Mensch einen geprüften Entwurf mit „Senden“ abschickt
//     (Katalog „Mails aus der App senden“, Standard: aus; braucht das Recht Mail.Send). Regeln und
//     Automatiken können diese Funktion nie aufrufen.
//   ✘ Mails im Postfach verändern, verschieben oder löschen.
//
// Zugangsdaten stehen nur in der .env (M365_TENANT_ID, M365_CLIENT_ID, M365_CLIENT_SECRET).
// Welche Postfächer, welcher Kalender und welcher Ablageort genutzt werden, steht in den Einstellungen.
// Die Rechte der App-Registrierung sollten per Exchange-Richtlinie auf die Funktionspostfächer begrenzt werden
// (siehe docs/MICROSOFT-365.md, DAT-4/DAT-5).

import { getSetting } from '../db.js';

const env = () => ({
  tenant: process.env.M365_TENANT_ID || '',
  clientId: process.env.M365_CLIENT_ID || '',
  secret: process.env.M365_CLIENT_SECRET || '',
  loginUrl: (process.env.M365_LOGIN_URL || 'https://login.microsoftonline.com').replace(/\/$/, ''),
  graphUrl: (process.env.M365_GRAPH_URL || 'https://graph.microsoft.com/v1.0').replace(/\/$/, ''),
});

export const DEFAULT_M365 = {
  mailboxes: [],          // [{ address, area_id }] Funktionspostfächer und ihr Bereich
  kalender_postfach: '',  // Postfach, in dessen Kalender Termine eingetragen werden
  ablage_ziel: '',        // z. B. "users/ablage@verein.de/drive", "sites/<site-id>/drive" oder "drives/<drive-id>"
  ablage_ordner: 'Ehrenamt-App',
};

export function m365Settings() { return { ...DEFAULT_M365, ...(getSetting('m365', {}) || {}) }; }

/** Sind die Zugangsdaten in der .env hinterlegt? */
export function credentialsPresent() {
  const e = env();
  return !!(e.tenant && e.clientId && e.secret);
}

/** Verbunden = Zugangsdaten vorhanden und mindestens ein Postfach eingetragen. */
export function isConfigured() {
  return credentialsPresent() && m365Settings().mailboxes.length > 0;
}

export function status() {
  const s = m365Settings();
  const e = env();
  return {
    credentials: credentialsPresent(),
    tenant: e.tenant ? `${e.tenant.slice(0, 8)}…` : '',
    clientId: e.clientId ? `${e.clientId.slice(0, 8)}…` : '',
    configured: isConfigured(),
    settings: s,
  };
}

// ---------- Anmeldung (Client Credentials) ----------

let cachedToken = null;
export function resetTokenCache() { cachedToken = null; }

async function token() {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const e = env();
  if (!credentialsPresent()) throw new M365Error('Microsoft 365 ist nicht eingerichtet: Zugangsdaten fehlen in der .env.');
  const res = await fetch(`${e.loginUrl}/${encodeURIComponent(e.tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: e.clientId, client_secret: e.secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new M365Error(`Anmeldung bei Microsoft fehlgeschlagen: ${data.error_description || data.error || res.status}`);
  cachedToken = { value: data.access_token, expires: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cachedToken.value;
}

export class M365Error extends Error {}

async function graph(method, path, { body, headers = {}, raw = false } = {}) {
  const e = env();
  const url = path.startsWith('http') ? path : `${e.graphUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data?.error?.message || `${res.status} ${res.statusText}`;
    throw new M365Error(`Microsoft Graph: ${msg}`);
  }
  return data;
}

const enc = (s) => encodeURIComponent(s);

// ---------- Lesen ----------

/** Verbindungstest: liest Anzeigename des ersten Postfachs. */
export async function testConnection() {
  const s = m365Settings();
  const results = [];
  for (const mb of s.mailboxes) {
    try {
      const u = await graph('GET', `/users/${enc(mb.address)}/mailFolders/inbox?$select=displayName,totalItemCount,unreadItemCount`);
      results.push({ address: mb.address, ok: true, info: `Posteingang erreichbar (${u.totalItemCount ?? '?'} Mails)` });
    } catch (err) { results.push({ address: mb.address, ok: false, info: err.message }); }
  }
  if (s.ablage_ziel) {
    try {
      const d = await graph('GET', `/${s.ablage_ziel.replace(/^\/+/, '')}?$select=name,webUrl`);
      results.push({ address: 'Ablage', ok: true, info: `Ablage erreichbar: ${d.name || d.webUrl || 'ok'}` });
    } catch (err) { results.push({ address: 'Ablage', ok: false, info: err.message }); }
  }
  if (!results.length) await token(); // wenigstens die Anmeldung prüfen
  return results;
}

/** Neue Mails seit sinceIso (aufsteigend). Liefert höchstens `max` Mails. */
export async function fetchMail(address, sinceIso, max = 50) {
  const filter = sinceIso ? `&$filter=${enc(`receivedDateTime gt ${sinceIso}`)}` : '';
  const select = 'id,subject,from,receivedDateTime,body,hasAttachments,conversationId,internetMessageId';
  let url = `/users/${enc(address)}/mailFolders/inbox/messages?$top=${Math.min(max, 50)}&$orderby=receivedDateTime asc&$select=${select}${filter}`;
  const out = [];
  while (url && out.length < max) {
    const page = await graph('GET', url, { headers: { Prefer: 'outlook.body-content-type="text"' } });
    out.push(...(page.value || []));
    url = page['@odata.nextLink'] || null;
  }
  return out.slice(0, max).map(m => ({
    id: m.id,
    subject: m.subject || '',
    sender: m.from?.emailAddress?.name || m.from?.emailAddress?.address || '',
    sender_address: m.from?.emailAddress?.address || '',   // nur zur Ermittlung der Domain, wird nicht gespeichert
    received_at: m.receivedDateTime,
    body: m.body?.content || '',
    has_attachments: !!m.hasAttachments,
    conversation_id: m.conversationId || null,
  }));
}

/** Dateianhänge einer Mail (nur echte Dateien, keine eingebetteten Elemente). */
export async function fetchAttachments(address, messageId) {
  const data = await graph('GET', `/users/${enc(address)}/messages/${enc(messageId)}/attachments`);
  return (data.value || [])
    .filter(a => a['@odata.type'] === '#microsoft.graph.fileAttachment' && !a.isInline && a.contentBytes)
    .map(a => ({ name: a.name, mime: a.contentType || 'application/octet-stream', data: Buffer.from(a.contentBytes, 'base64') }));
}

// ---------- Schreiben (nur nach Freigabe aufgerufen) ----------

/** Legt einen Entwurf im Postfach an. Keine Empfängeradressen: die ergänzt ein Mensch in Outlook. */
export async function createDraft(address, { subject, body }) {
  const m = await graph('POST', `/users/${enc(address)}/messages`, { body: { subject, body: { contentType: 'Text', content: body }, toRecipients: [] } });
  return { id: m.id, conversation_id: m.conversationId || null, webLink: m.webLink || null };
}

/**
 * Verschickt eine Mail aus einem Funktionspostfach. Wird ausschließlich von /api/drafts/:id/send aufgerufen,
 * also nach Prüfung und Klick eines Menschen. to: Liste von Adressen (werden nicht gespeichert).
 */
export async function sendMail(address, { subject, body, to }) {
  await graph('POST', `/users/${enc(address)}/sendMail`, {
    body: { message: { subject, body: { contentType: 'Text', content: body }, toRecipients: to.map(a => ({ emailAddress: { address: a } })) }, saveToSentItems: true },
  });
  return { ok: true };
}

/** Termin im Kalender eines Postfachs. Datum JJJJ-MM-TT, Uhrzeit HH:MM oder leer (ganztägig). */
export async function createEvent(address, { title, date, time, end_time, location, notes }) {
  const tz = 'W. Europe Standard Time';
  let start, end, isAllDay = false;
  if (time) {
    const endTime = end_time || `${String(Math.min(23, Number(time.slice(0, 2)) + 2)).padStart(2, '0')}:${time.slice(3)}`;
    start = { dateTime: `${date}T${time}:00`, timeZone: tz };
    end = { dateTime: `${date}T${endTime}:00`, timeZone: tz };
  } else {
    const next = new Date(date + 'T12:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
    start = { dateTime: `${date}T00:00:00`, timeZone: tz };
    end = { dateTime: `${next.toISOString().slice(0, 10)}T00:00:00`, timeZone: tz };
    isAllDay = true;
  }
  const ev = await graph('POST', `/users/${enc(address)}/events`, {
    body: { subject: title, start, end, isAllDay, location: location ? { displayName: location } : undefined, body: notes ? { contentType: 'Text', content: notes } : undefined, showAs: 'free' },
  });
  return { id: ev.id, webLink: ev.webLink || null };
}

/** Datei hochladen. Bis 4 MB direkt, darüber in Teilen (Upload-Sitzung). */
export async function uploadFile(relPath, buffer) {
  const s = m365Settings();
  if (!s.ablage_ziel) throw new M365Error('Kein Ablageort eingestellt (Adminpanel → Verbindungen).');
  const base = `/${s.ablage_ziel.replace(/^\/+|\/+$/g, '')}/root:/${relPath.split('/').map(enc).join('/')}`;
  if (buffer.length <= 4 * 1024 * 1024) {
    const item = await graph('PUT', `${base}:/content`, { body: buffer, raw: true, headers: { 'Content-Type': 'application/octet-stream' } });
    return { id: item.id, webUrl: item.webUrl };
  }
  const session = await graph('POST', `${base}:/createUploadSession`, { body: { item: { '@microsoft.graph.conflictBehavior': 'rename' } } });
  const chunk = 320 * 1024 * 12; // Vielfaches von 320 KiB
  let item = null;
  for (let off = 0; off < buffer.length; off += chunk) {
    const part = buffer.subarray(off, Math.min(off + chunk, buffer.length));
    const res = await fetch(session.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Length': String(part.length), 'Content-Range': `bytes ${off}-${off + part.length - 1}/${buffer.length}` },
      body: part, signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok && res.status !== 202) throw new M365Error(`Hochladen fehlgeschlagen (${res.status}).`);
    if (res.status === 200 || res.status === 201) item = await res.json();
  }
  return { id: item?.id, webUrl: item?.webUrl };
}

/** Postfach für einen Bereich: erstes zugeordnetes, sonst das erste überhaupt. */
export function mailboxForArea(areaId) {
  const s = m365Settings();
  return (s.mailboxes.find(m => Number(m.area_id) === Number(areaId)) || s.mailboxes[0])?.address || null;
}
