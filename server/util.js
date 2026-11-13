// Kleine Hilfsfunktionen: Zeit, Fehler, Eingabeprüfung, Protokoll.

import { q } from './db.js';
import { config } from './config.js';
import { clockNow, nowMs } from './clock.js';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
export const bad = (msg, extra) => new HttpError(400, msg, extra);
export const forbidden = (msg = 'Dafür fehlt die Berechtigung.') => new HttpError(403, msg);
export const notFound = (msg = 'Nicht gefunden.') => new HttpError(404, msg);

// ---------- Zeit ----------

export const nowIso = () => clockNow().toISOString();

const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('de-DE', { timeZone: config.timezone, hour: '2-digit', hourCycle: 'h23', weekday: 'short' });

/** Heutiges Datum in Berlin als JJJJ-MM-TT */
export const today = (d = clockNow()) => dayFmt.format(d);

/** Stunde (0–23) und Wochentag (1 = Montag … 7 = Sonntag) in Berlin */
export function berlinClock(d = clockNow()) {
  const parts = hourFmt.formatToParts(d);
  const hour = Number(parts.find(p => p.type === 'hour').value);
  const wd = parts.find(p => p.type === 'weekday').value.replace('.', '');
  const weekday = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].indexOf(wd) + 1;
  return { hour, weekday };
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000 * 10) / 10;
}

export function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

export function formatDateDe(s) {
  if (!s) return '';
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

// ---------- Eingabeprüfung ----------

export function str(v, { max = 10_000, required = false, name = 'Feld' } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') v = String(v);
  v = v.trim();
  if (required && !v) throw bad(`${name} fehlt.`);
  if (v.length > max) throw bad(`${name} ist zu lang (höchstens ${max} Zeichen).`);
  return v;
}

export function int(v, { min = -Infinity, max = Infinity, name = 'Wert', nullable = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (nullable) return null;
    throw bad(`${name} fehlt.`);
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} ist ungültig.`);
  return n;
}

export function oneOf(v, list, { name = 'Wert', fallback } = {}) {
  if ((v === undefined || v === null || v === '') && fallback !== undefined) return fallback;
  if (!list.includes(v)) throw bad(`${name} ist ungültig.`);
  return v;
}

export function dateOrNull(v, name = 'Datum') {
  if (v === undefined || v === null || v === '') return null;
  if (!isDate(v)) throw bad(`${name} ist kein gültiges Datum.`);
  return v;
}

export function parseJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

// ---------- Protokoll (NFA-2, AUF-13) ----------

/**
 * Schreibt einen unveränderlichen Protokolleintrag.
 * @param {object|null} user  angemeldete Person oder null für das System
 */
export function audit(user, { entity, entityId = null, action, summary, areaId = null, detail = {} }) {
  q.run(`INSERT INTO audit_log (at, user_id, user_name, area_id, entity, entity_id, action, summary, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    nowIso(), user?.id ?? null, user?.name ?? 'System', areaId, entity, entityId, action, summary,
    JSON.stringify(detail));
}

export const STATUS_LABEL = {
  offen: 'Offen', in_arbeit: 'In Arbeit', wartet: 'Wartet auf Zulieferung', erledigt: 'Erledigt', verworfen: 'Verworfen',
};
export const LEVEL_LABEL = ['0 Auskunft', '1 Entwurf', '2 Vorbereitung', '3 Ausführung nach Freigabe', '4 Selbstständig nach Plan'];
