// Zustand der Vereinswelt: eine JSON-Datei plus ein Ordner mit Dateien (PDFs, CSVs, Fotos).
// Getrennt von der Datenbank der App – die Welt schreibt nie in die App, sie liest dort nur,
// um zu prüfen, ob ein Ereignis gelöst ist.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { clockNow } from '../../server/clock.js';

let dir = '';
let state = null;

export function openWelt(baseDir) {
  dir = baseDir;
  fs.mkdirSync(path.join(dir, 'dateien'), { recursive: true });
  const f = path.join(dir, 'welt.json');
  state = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  return state;
}

export const W = () => state;
export function initWelt(s) { state = s; save(); }

let timer = null;
/** Speichert gebündelt (mehrere Änderungen kurz hintereinander → ein Schreibvorgang). */
export function save(now = false) {
  if (!state) return;
  const write = () => { timer = null; fs.writeFileSync(path.join(dir, 'welt.json.tmp'), JSON.stringify(state, null, 1)); fs.renameSync(path.join(dir, 'welt.json.tmp'), path.join(dir, 'welt.json')); };
  if (now) { clearTimeout(timer); write(); return; }
  if (!timer) timer = setTimeout(write, 150);
}

export const newId = (p) => `${p}-${crypto.randomBytes(5).toString('hex')}`;

/** Legt eine Datei im Weltordner ab und gibt ihre Kennung zurück. */
export function putFile(name, mime, data) {
  const id = newId('f');
  fs.writeFileSync(path.join(dir, 'dateien', id), data);
  state.files[id] = { id, name, mime, size: data.length };
  return id;
}
export function fileMeta(id) { return state.files[id] || null; }
export const fileExists = (id) => !!id && !!state.files[id] && fs.existsSync(path.join(dir, 'dateien', id));
/** Inhalt einer Datei oder null, wenn sie fehlt (z. B. Ordner von Hand gelöscht). */
export function readFile(id) { return fileExists(id) ? fs.readFileSync(path.join(dir, 'dateien', id)) : null; }
export function removeFile(id) { try { fs.unlinkSync(path.join(dir, 'dateien', id)); } catch { /* schon weg */ } delete state.files[id]; }

export function log(text, kind = 'info') {
  state.log.push({ at: clockNow().toISOString(), text, kind });
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
  save();
}
