// Dateien in der Ablage speichern – gemeinsam genutzt von Upload, Mailanhängen und Eingang.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { q } from '../db.js';
import { config } from '../config.js';
import { assertDataClass } from '../guards.js';
import { audit, bad, nowIso, today } from '../util.js';
import { touch } from './tasks.js';
import { isOn, param } from './catalog.js';
import { requestApproval } from './automation.js';
import { gelbExtern } from '../privacy.js';

export const ALLOWED_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.txt', '.md', '.csv', '.eml', '.msg',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.zip', '.ics', '.json', '.rtf']);
const TEXT_EXT = new Set(['.txt', '.md', '.csv', '.eml', '.ics', '.json']);

export const cleanName = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Einheitlicher Dateiname nach ABL-2: „JJJJ-MM-TT - Aussteller - Anlass.ext“ */
export function standardName({ doc_date, issuer, occasion, original_name }) {
  const ext = path.extname(original_name || '').toLowerCase();
  const date = doc_date || today();
  const parts = [date, cleanName(issuer) || 'Unbekannt', cleanName(occasion) || cleanName(path.basename(original_name || 'Datei', ext))];
  return `${parts.join(' - ').slice(0, 180)}${ext}`;
}

/**
 * Themen-Ordner bereinigen: höchstens drei Ebenen, getrennt durch „/“, ohne verbotene Zeichen.
 * Beispiel: "Sponsoring / Verträge" → "Sponsoring/Verträge"
 */
export function cleanFolder(folder) {
  return String(folder || '').split(/[\\/]+/).map(s => cleanName(s).replace(/^\.+/, '').slice(0, 60)).filter(Boolean).slice(0, 3).join('/');
}

/** Pfad in der Vereinsablage (SharePoint/OneDrive): Bereich/Ordner/Jahr/Datei */
export function mirrorPath(f) {
  const area = q.get('SELECT name FROM areas WHERE id = ?', f.area_id)?.name || 'Ablage';
  return [cleanName(area), ...(f.folder ? f.folder.split('/') : []), (f.doc_date || today()).slice(0, 4), f.filename].join('/');
}

/**
 * Kopie in die Vereinsablage vorschlagen (Stufe 3 → Freigabe). force = Regel verlangt es ausdrücklich;
 * sonst entscheidet der Automatisierungskatalog „Ablage nach SharePoint/OneDrive kopieren“.
 */
export function maybeMirror(user, fileId, { force = false } = {}) {
  if (!isOn('ablage_spiegeln')) return null;
  const f = q.get('SELECT * FROM files WHERE id = ?', fileId);
  if (!f || f.remote_url) return null;
  if (f.data_class === 'gelb' && !gelbExtern()) return null;   // gelbe Dateien verlassen den Server nur mit Schalter
  if (!force && f.data_class !== 'gruen' && param('ablage_spiegeln', 'nur_gruen')) return null;
  const p = mirrorPath(f);
  return requestApproval({ actionType: 'ablage_hochladen', payload: { kind: 'ablage_hochladen', area_id: f.area_id, file_id: f.id, path: p },
    summary: `Datei „${f.filename}“ nach SharePoint/OneDrive kopieren (${p})`, taskId: f.task_id, user });
}

/**
 * Speichert eine Datei in der Ablage und gibt { id, filename, duplicateOf, reused } zurück.
 * reuseDuplicate: liegt dieselbe Datei schon im Bereich, wird keine zweite Kopie angelegt (für automatisches Ablegen).
 */
export function storeFile(user, { areaId, taskId = null, buffer, originalName, mime, dataClass, docDate, issuer = '', occasion = '', tags = '', filename = null,
  folder = '', mirror = 'auto', reuseDuplicate = false }) {
  assertDataClass(dataClass);
  if (reuseDuplicate && buffer?.length) {
    const sha = crypto.createHash('sha256').update(buffer).digest('hex');
    const existing = q.get('SELECT id, filename, task_id FROM files WHERE sha256 = ? AND area_id = ? AND deleted_at IS NULL', sha, areaId);
    if (existing) {
      if (taskId && !existing.task_id) q.run('UPDATE files SET task_id = ? WHERE id = ?', taskId, existing.id);
      return { id: existing.id, filename: existing.filename, duplicateOf: existing, reused: true };
    }
  }
  const result = storeNew(user, { areaId, taskId, buffer, originalName, mime, dataClass, docDate, issuer, occasion, tags, filename, folder: cleanFolder(folder) });
  if (mirror !== 'never') {
    try { maybeMirror(user, result.id, { force: mirror === 'force' }); } catch { /* Vorschlag ist optional */ }
  }
  return result;
}

function storeNew(user, { areaId, taskId, buffer, originalName, mime, dataClass, docDate, issuer, occasion, tags, filename, folder }) {
  const original = cleanName(originalName).slice(0, 200) || 'Datei';
  const ext = path.extname(original).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw bad(`Dateityp ${ext || '(ohne Endung)'} wird nicht angenommen.`);
  if (!buffer?.length) throw bad('Die Datei ist leer.');
  if (buffer.length > config.maxUploadBytes) throw bad('Die Datei ist zu groß.');
  const date = docDate || today();
  const name = filename ? cleanName(filename).slice(0, 200) : standardName({ doc_date: date, issuer, occasion, original_name: original });
  const area = q.get('SELECT key FROM areas WHERE id = ?', areaId);
  if (!area) throw bad('Bereich nicht gefunden.');
  const relDir = path.join(area.key, date.slice(0, 4));
  fs.mkdirSync(path.join(config.uploadDir, relDir), { recursive: true });
  const rel = path.join(relDir, `${crypto.randomUUID()}${ext}`).replace(/\\/g, '/');
  fs.writeFileSync(path.join(config.uploadDir, rel), buffer);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const dupe = q.get('SELECT id, filename FROM files WHERE sha256 = ? AND area_id = ? AND deleted_at IS NULL', sha256, areaId);
  const text = TEXT_EXT.has(ext) ? buffer.toString('utf8').slice(0, 200_000) : '';
  const r = q.run(`INSERT INTO files (area_id, task_id, filename, original_name, stored_path, mime, size, sha256, doc_date, issuer, occasion, tags, data_class, text_content, uploaded_by, created_at, folder)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    areaId, taskId, name, original, rel, String(mime || 'application/octet-stream').slice(0, 100), buffer.length, sha256, date, issuer, occasion, tags, dataClass, text, user?.id ?? null, nowIso(), folder);
  const id = Number(r.lastInsertRowid);
  audit(user, { entity: taskId ? 'task' : 'file', entityId: taskId || id, areaId, action: 'datei', summary: `Datei „${name}“ abgelegt${folder ? ` in „${folder}“` : ''} (${dataClass === 'gelb' ? 'gelb' : 'grün'})` });
  if (taskId) touch(taskId);
  return { id, filename: name, duplicateOf: dupe || null };
}

export function readStoredFile(f) {
  return fs.readFileSync(path.join(config.uploadDir, f.stored_path));
}

// ---------- Zwischenablage für Anhänge aus dem Eingang ----------

const inboxDir = (id) => path.join(config.dataDir, 'eingang', String(id));

export function saveInboxAttachments(inboxId, list) {
  const dir = inboxDir(inboxId);
  const meta = [];
  for (const [i, a] of list.entries()) {
    const ext = path.extname(a.name || '').toLowerCase();
    if (!ALLOWED_EXT.has(ext) || !a.data?.length || a.data.length > config.maxUploadBytes) {
      meta.push({ name: a.name, size: a.data?.length || 0, mime: a.mime, stored: null, skipped: 'Dateityp oder Größe nicht erlaubt' });
      continue;
    }
    fs.mkdirSync(dir, { recursive: true });
    const stored = `${i}${ext}`;
    fs.writeFileSync(path.join(dir, stored), a.data);
    meta.push({ name: cleanName(a.name).slice(0, 200), size: a.data.length, mime: a.mime, stored });
  }
  return meta;
}

export function readInboxAttachment(inboxId, stored) {
  if (!/^\d+\.[a-z0-9]+$/.test(stored)) throw bad('Ungültiger Anhang.');
  return fs.readFileSync(path.join(inboxDir(inboxId), stored));
}

export function removeInboxAttachments(inboxId) {
  fs.rmSync(inboxDir(inboxId), { recursive: true, force: true });
}
