// Eingabefeld für Themen-Ordner mit Vorschlägen aus der Ablage und den Ablageregeln.

import { api } from '../api.js';
import { h, input } from '../ui.js';

let cache = null;
let cacheAt = 0;

export async function knownFolders() {
  if (!cache || Date.now() - cacheAt > 30_000) {
    cache = (await api.get('/api/files/folders').catch(() => ({ folders: [] }))).folders.map(f => f.folder);
    cacheAt = Date.now();
  }
  return cache;
}

export function forgetFolders() { cache = null; }

/** Liefert { el, input }: Textfeld + Datalist. Unterordner mit „/“ trennen, z. B. „Sponsoring/Verträge“. */
export async function folderInput(value = '', attrs = {}) {
  const id = `fl-${Math.random().toString(36).slice(2, 8)}`;
  const inp = input({ value, list: id, placeholder: 'z. B. Rechnungen oder Sponsoring/Verträge', ...attrs });
  const dl = h('datalist', { id }, (await knownFolders()).map(f => h('option', { value: f })));
  return { el: h('div', {}, inp, dl), input: inp };
}
