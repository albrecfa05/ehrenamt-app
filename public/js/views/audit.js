// Protokoll aller Vorgänge und Freigaben (NFA-2): einsehbar und exportierbar für Kassenprüfung und Entlastung.

import { api, qs } from '../api.js';
import { h, clear, pageHeader, select, input, button, debounce, fmtDateTime, emptyState } from '../ui.js';
import { areaOptions, userOptions } from '../state.js';

const ENTITY = { task: 'Aufgabe', rule: 'Regel', approval: 'Freigabe', user: 'Konto', process_template: 'Vorgangsvorlage', text_template: 'Textvorlage',
  kb_document: 'Wissensbasis', file: 'Datei', inbox: 'Eingang', recurring: 'Jahreskalender', event: 'Termin', settings: 'Einstellungen', system: 'System',
  import: 'Import', area: 'Bereich', office: 'Amt', learning: 'Lernprotokoll', faq: 'FAQ', report: 'Übersicht', draft: 'Entwurf', audit: 'Protokoll' };

export default async function auditView(el, { query = {} }) {
  const f = { q: '', entity: query.entity || '', area: '', user: '', from: '', to: '', only: query.only || '' };
  let offset = 0;
  const tbody = h('tbody');
  const more = button('Mehr laden', () => load(true), { kind: 'ghost' });
  const load = async (append = false) => {
    if (!append) offset = 0;
    const rows = await api.get('/api/audit' + qs({ ...f, limit: 200, offset }));
    offset += rows.length;
    more.hidden = rows.length < 200;
    const trs = rows.map(r => h('tr', {}, h('td', { class: 'nowrap small' }, fmtDateTime(r.at)), h('td', {}, r.user_name), h('td', { class: 'small' }, ENTITY[r.entity] || r.entity, r.entity_id ? ` #${r.entity_id}` : ''),
      h('td', { class: 'small muted' }, r.area_name || ''),
      h('td', {}, r.entity === 'task' && r.entity_id ? h('a', { href: `#/aufgabe/${r.entity_id}` }, r.summary) : r.summary)));
    if (append) tbody.append(...trs); else clear(tbody, trs.length ? trs : h('tr', {}, h('td', { colspan: 5 }, emptyState('Keine Einträge.'))));
  };
  const ctl = (k, node) => { node.addEventListener(node.tagName === 'INPUT' && node.type === 'search' ? 'input' : 'change', debounce(() => { f[k] = node.value; load(); }, 250)); return node; };
  clear(el,
    pageHeader('Protokoll', 'Jede Änderung, Freigabe und Ausführung – unveränderlich gespeichert.',
      button('Als CSV exportieren', () => { location.href = '/api/audit.csv' + qs(f); }, { kind: 'primary', iconName: 'download' })),
    h('div', { class: 'filters' },
      ctl('q', input({ type: 'search', placeholder: 'Text suchen …' })),
      ctl('entity', h('select', {}, [['', 'Alle Objekte'], ...Object.entries(ENTITY)].map(([v, l]) => h('option', { value: v, selected: v === f.entity }, l)))),
      ctl('only', select([['', 'Alle Aktionen'], ['freigaben', 'Nur Freigaben und Übernahmen']], f.only)),
      ctl('area', select(areaOptions(), '')), ctl('user', select(userOptions('Alle Personen'), '')),
      ctl('from', input({ type: 'date', 'aria-label': 'von' })), ctl('to', input({ type: 'date', 'aria-label': 'bis' }))),
    h('table', { class: 'table audit' }, h('thead', {}, h('tr', {}, h('th', {}, 'Zeitpunkt'), h('th', {}, 'Person'), h('th', {}, 'Objekt'), h('th', {}, 'Bereich'), h('th', {}, 'Was'))), tbody),
    more);
  await load();
}
