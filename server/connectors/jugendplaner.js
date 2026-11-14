// Anschluss an den TTV-Jugendplaner (PHP-App auf dem Vereins-Webspace).
//
// Was dieser Anschluss tut – und bewusst NICHT tut:
//   ✔ den aktuellen Stand LESEN (api.php?action=state): Spiele, Zusagen, Fahrer/Betreuer
//   ✔ die Adresse des Kalender-Abos (ics.php) ermitteln
//   ✔ eine Anmeldung für „Zum Jugendplaner“ ausstellen (gleiches Verfahren wie der Jugendplaner selbst)
//   ✘ im Jugendplaner etwas ändern – das bleibt dort, bei Jugendleitung, Mannschaftsführern und Eltern
//
// Zugang in der .env (nie in Datenbank oder Oberfläche):
//   JUGENDPLANER_URL     z. B. https://wp.ttvbuehlertal.de/jugendplaner
//   JUGENDPLANER_SECRET  der APP_SECRET aus der config.php des Jugendplaners (empfohlen)
//   JUGENDPLANER_PIN     alternativ: eine PIN des Jugendplaners (Jugendleitung oder Mannschaftsführer)

import crypto from 'node:crypto';

const env = () => ({
  url: (process.env.JUGENDPLANER_URL || '').trim().replace(/\/+$/, '').replace(/\/(index\.html|api\.php)$/i, ''),
  secret: process.env.JUGENDPLANER_SECRET || '',
  pin: process.env.JUGENDPLANER_PIN || '',
});

export class JugendplanerError extends Error {}

export const isConfigured = () => { const e = env(); return !!(e.url && (e.secret || e.pin)); };
export const baseUrl = () => env().url;
export function status() {
  const e = env();
  let origin = '';
  try { origin = e.url ? new URL(e.url).host : ''; } catch { origin = '(ungültige Adresse)'; }
  return { configured: isConfigured(), url: e.url, host: origin, auth: e.secret ? 'schluessel' : e.pin ? 'pin' : null, sso: !!e.secret };
}

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Anmeldung wie der Jugendplaner sie ausstellt: base64url("rolle|ablauf") + "." + base64url(HMAC-SHA256). */
export function mintToken(role, seconds = 8 * 3600) {
  const { secret } = env();
  if (!secret) throw new JugendplanerError('Für die Anmeldung fehlt JUGENDPLANER_SECRET in der .env.');
  if (!['admin', 'mf', 'eltern'].includes(role)) throw new JugendplanerError('Unbekannte Rolle.');
  const payload = `${role}|${Math.floor(Date.now() / 1000) + seconds}`;
  return `${b64u(payload)}.${b64u(crypto.createHmac('sha256', secret).update(payload).digest())}`;
}

let pinToken = null;
async function token() {
  const e = env();
  if (e.secret) return mintToken('admin', 600);
  if (pinToken) return pinToken;
  const r = await call('login', { method: 'POST', body: { pin: e.pin }, auth: false });
  pinToken = r.token;
  return pinToken;
}

async function call(action, { method = 'GET', body, auth = true, query = '' } = {}) {
  const e = env();
  if (!e.url) throw new JugendplanerError('JUGENDPLANER_URL fehlt in der .env.');
  let res;
  try {
    res = await fetch(`${e.url}/api.php?action=${encodeURIComponent(action)}${query}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(auth ? { 'X-Token': await token() } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new JugendplanerError(`Jugendplaner nicht erreichbar (${err.cause?.code || err.message}).`);
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) {
    pinToken = null;
    throw new JugendplanerError(action === 'login' ? 'Die PIN wurde vom Jugendplaner abgelehnt.' : 'Der Jugendplaner hat die Anmeldung abgelehnt – stimmt JUGENDPLANER_SECRET mit dem APP_SECRET überein?');
  }
  if (!res.ok || !data) throw new JugendplanerError(`Jugendplaner antwortet mit Fehler ${res.status}${data?.error ? `: ${data.error}` : ''}.`);
  return data;
}

/** Liest den kompletten Stand. Ergebnis: { role, version, icsKey, data } */
export async function fetchState() {
  const r = await call('state');
  if (!r.data || !Array.isArray(r.data.games)) throw new JugendplanerError('Unerwartete Antwort – ist das ein Jugendplaner (Version 2)?');
  return r;
}

export const icsUrl = (icsKey, { team } = {}) => `${env().url}/ics.php?k=${encodeURIComponent(icsKey)}${team ? `&t=${encodeURIComponent(team)}` : ''}`;
export function resetTokenCache() { pinToken = null; }
