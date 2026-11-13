// Anmeldung (NFA-3), Sitzungen und sofortiger Entzug von Zugriffen (ROL-5, NFA-5).
// Passwörter werden mit scrypt gehasht; Sitzungs-Token liegen nur als SHA-256-Hash in der Datenbank.

import crypto from 'node:crypto';
import { q } from './db.js';
import { config } from './config.js';
import { HttpError, nowIso } from './util.js';
import { clockNow, nowMs } from './clock.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const COOKIE = 'tte_session';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, N, r, p, saltB64, hashB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(pw, Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(expected, actual);
}

/** Starkes Passwort (NFA-3): mindestens 12 Zeichen, drei Zeichenarten, nicht trivial. */
export function checkPasswordStrength(pw, { name = '', login = '' } = {}) {
  const problems = [];
  if (typeof pw !== 'string' || pw.length < 12) problems.push('mindestens 12 Zeichen');
  const classes = [/[a-zäöüß]/, /[A-ZÄÖÜ]/, /\d/, /[^A-Za-zÄÖÜäöüß\d]/].filter(re => re.test(pw || '')).length;
  if (classes < 3) problems.push('mindestens drei von: Kleinbuchstaben, Großbuchstaben, Ziffern, Sonderzeichen');
  const lower = String(pw || '').toLowerCase();
  const weak = ['passwort', 'password', 'tischtennis', 'hohberg', 'bühlertal', 'buehlertal', 'mittelbaden', '123456', 'qwertz'];
  if (weak.some(w => lower.includes(w))) problems.push('keine naheliegenden Wörter wie „Passwort“, „Tischtennis“ oder Vereinsnamen');
  for (const part of [login, ...String(name).split(/\s+/)]) {
    if (part && part.length >= 3 && lower.includes(part.toLowerCase())) { problems.push('nicht den eigenen Namen oder die Anmeldung enthalten'); break; }
  }
  if (/(.)\1{3,}/.test(pw || '')) problems.push('keine langen Wiederholungen');
  if (problems.length) throw new HttpError(400, `Das Passwort ist zu schwach. Es braucht ${problems.join('; ')}.`);
}

// ---------- Schutz vor Durchprobieren ----------

const attempts = new Map(); // key -> { count, until }
const WINDOW_MS = 15 * 60_000;

export function checkRateLimit(key) {
  const a = attempts.get(key);
  if (a && a.until > Date.now() && a.count >= 8) {
    const min = Math.ceil((a.until - Date.now()) / 60_000);
    throw new HttpError(429, `Zu viele Fehlversuche. Bitte in ${min} Minute(n) erneut versuchen.`);
  }
}
export function noteFailure(key) {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) attempts.set(key, { count: 1, until: Date.now() + WINDOW_MS });
  else a.count++;
}
export function clearFailures(key) { attempts.delete(key); }

// ---------- Sitzungen ----------

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(userId, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = nowIso();
  q.run('INSERT INTO sessions (token_hash, user_id, created_at, last_seen, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)',
    sha(token), userId, now, now, String(req.headers['user-agent'] || '').slice(0, 300), clientIp(req));
  return token;
}

export function sessionCookie(token) {
  const maxAge = config.sessionDays * 86400;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.secureCookies ? '; Secure' : ''}`;
}
export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${config.secureCookies ? '; Secure' : ''}`;
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/** Liefert die angemeldete Person oder null. Gesperrte Konten und abgelaufene Sitzungen zählen nicht. */
export function userFromRequest(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const row = q.get(`SELECT s.id AS session_id, s.last_seen, s.created_at AS session_created, u.*
                     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, sha(token));
  if (!row) return null;
  const ageDays = (nowMs() - Date.parse(row.session_created)) / 86_400_000;
  if (!row.active || ageDays > config.sessionDays) {
    q.run('DELETE FROM sessions WHERE id = ?', row.session_id);
    return null;
  }
  // last_seen höchstens minütlich schreiben
  if (nowMs() - Date.parse(row.last_seen) > 60_000) q.run('UPDATE sessions SET last_seen = ? WHERE id = ?', nowIso(), row.session_id);
  delete row.pw_hash;
  return row;
}

export function destroySession(req) {
  const token = readCookie(req, COOKIE);
  if (token) q.run('DELETE FROM sessions WHERE token_hash = ?', sha(token));
}

/** Entzieht alle Sitzungen einer Person sofort (NFA-5, z. B. bei Geräteverlust). */
export function revokeAllSessions(userId, exceptSessionId = null) {
  if (exceptSessionId) return q.run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', userId, exceptSessionId).changes;
  return q.run('DELETE FROM sessions WHERE user_id = ?', userId).changes;
}

export function clientIp(req) {
  return String(req.socket?.remoteAddress || '').replace('::ffff:', '');
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}
