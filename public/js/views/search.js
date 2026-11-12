// Globale Suche über Aufgaben, Ablage, Wissensbasis und Vorgangsvorlagen.

import { api } from '../api.js';
import { h, clear, pageHeader, emptyState, fmtDate, icon } from '../ui.js';
import { taskRow } from './taskform.js';

export default async function search(el, { query = {} }) {
  const q = query.q || '';
  const input = document.querySelector('.search-input');
  if (input) input.value = q;
  const r = await api.get(`/api/search?q=${encodeURIComponent(q)}`);
  const total = r.tasks.length + r.files.length + r.knowledge.length + r.templates.length;
  const sec = (title, ic, list, body) => list.length
    ? h('section', { class: 'card' }, h('header', { class: 'card-head' }, h('h2', {}, icon(ic, 16), title, h('span', { class: 'count' }, list.length))), body(list))
    : null;
  clear(el, pageHeader(`Suche: „${q}“`, `${total} Treffer`),
    total ? h('div', { class: 'stack' },
      sec('Aufgaben', 'list', r.tasks, (l) => h('div', { class: 'task-list' }, l.map(t => taskRow(t)))),
      sec('Vorgangsvorlagen', 'flow', r.templates, (l) => h('ul', { class: 'mini-list pad' }, l.map(t => h('li', {}, h('a', { href: `#/vorgaenge/${t.id}` }, t.name), h('small', { class: 'muted' }, t.summary))))),
      sec('Wissensbasis', 'book', r.knowledge, (l) => h('ul', { class: 'mini-list pad' }, l.map(k => h('li', {}, h('a', { href: `#/auskunft?q=${encodeURIComponent(q)}` }, `${k.reference} ${k.heading}`), h('small', { class: 'muted' }, k.title))))),
      sec('Ablage', 'folder', r.files, (l) => h('ul', { class: 'mini-list pad' }, l.map(f => h('li', {}, h('a', { href: `/api/files/${f.id}/download`, target: '_blank', rel: 'noopener' }, f.filename), h('small', { class: 'muted' }, `${f.area_name} · ${fmtDate(f.doc_date)}`))))))
      : emptyState('Nichts gefunden.'));
}
