// Alle offenen Entwürfe an einer Stelle (AUT-14: Versand nur durch Menschen).

import { api } from '../api.js';
import { h, clear, pageHeader, tabs, emptyState, errorToast, areaChip } from '../ui.js';
import { draftCard } from './shared.js';

export default async function drafts(el) {
  let tab = 'entwurf';
  const list = h('div', { class: 'stack' });
  const load = async () => {
    const rows = await api.get(`/api/drafts?status=${tab}`);
    clear(list, rows.length ? rows.map(d => h('div', { class: 'card pad' },
      h('div', { class: 'draft-context' }, areaChip(d.area_name), d.task_id ? h('a', { href: `#/aufgabe/${d.task_id}` }, d.task_title) : h('span', { class: 'muted' }, 'ohne Aufgabe'),
        d.created_by_name ? h('small', { class: 'muted' }, `von ${d.created_by_name}`) : null),
      draftCard(d, load))) : emptyState(tab === 'entwurf' ? 'Keine offenen Entwürfe.' : 'Nichts in dieser Liste.'));
  };
  const render = () => {
    clear(el, pageHeader('Entwürfe', 'Mails und Dokumente entstehen nur als Entwurf. Übernehmen heißt: Du verschickst selbst, die App protokolliert es.'),
      tabs([['entwurf', 'Offen'], ['uebernommen', 'Übernommen'], ['verworfen', 'Verworfen']], tab, (k) => { tab = k; render(); }), list);
    load().catch(errorToast);
  };
  render();
}
