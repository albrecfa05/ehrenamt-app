// Handbuch je Amt (VOR-15): Aus Vorgangsvorlagen, Jahreskalender und Lernprotokoll entsteht die
// Übergabedokumentation, mit der eine zweite Person das Amt übernehmen kann (ABN-1).

import { api } from '../api.js';
import { h, clear, pageHeader, button, select, richText, fmtDate, fmtDateTime, MONTHS, FREQ, LEVELS, emptyState, icon } from '../ui.js';
import { state, areaOptions, officeOptions } from '../state.js';

export default async function handbook(el, { query = {} }) {
  let area = query.area || state.me.areas[0]?.id;
  let office = query.office || '';
  const out = h('div', { class: 'handbook' });
  const areaSel = select(areaOptions(null), area);
  const officeWrap = h('span');
  const drawOffice = () => {
    const s = select(officeOptions(area, 'Alle Ämter'), office);
    s.addEventListener('change', () => { office = s.value; load(); });
    clear(officeWrap, s);
  };
  areaSel.addEventListener('change', () => { area = areaSel.value; office = ''; drawOffice(); load(); });
  drawOffice();

  const load = async () => {
    history.replaceState(null, '', `#/handbuch?area=${area}${office ? '&office=' + office : ''}`);
    const d = await api.get(`/api/handbook?area=${area}${office ? '&office=' + office : ''}`);
    const missing = [];
    for (const o of d.offices) for (const t of o.templates) if (!t.guide || t.guide.length < 40) missing.push(`${o.office.name}: ${t.name}`);
    clear(out,
      h('div', { class: 'hb-cover' }, h('h1', {}, `Handbuch ${d.area.name}`), h('p', { class: 'muted' }, `Stand ${fmtDateTime(d.generated)} · erzeugt aus den gültigen Vorgangsvorlagen`),
        missing.length ? h('div', { class: 'warn-box no-print' }, icon('alert', 16), h('div', {}, h('strong', {}, 'Lücken für eine Übergabe: '), missing.join(', '))) : null),
      d.offices.length ? d.offices.map(o => h('section', { class: 'hb-office' },
        h('h2', {}, o.office.name),
        h('p', { class: 'muted' }, `Inhaber: ${o.office.holder_name || 'nicht besetzt'} · Vertretung: ${o.office.deputy_name || 'keine'}`),
        o.recurring.length ? h('div', {}, h('h3', {}, 'Wiederkehrend im Jahr'),
          h('table', { class: 'table' }, h('tbody', {}, o.recurring.map(r => h('tr', {}, h('td', {}, r.freq === 'jaehrlich' ? `${r.day}. ${MONTHS[r.month - 1]}` : FREQ[r.freq]), h('td', {}, r.title, r.assumption ? ' (Datum ist Annahme)' : ''), h('td', { class: 'muted' }, r.template_name || '')))))) : null,
        o.templates.length ? o.templates.map(t => h('article', { class: 'hb-proc' },
          h('h3', {}, `${t.key ? t.key + ' · ' : ''}${t.name}`),
          h('p', { class: 'small muted' }, `Höchststufe ${LEVELS[t.max_level]}${t.never_execute ? ' · nie ausführen' : ''} · Daten ${t.data_class === 'gelb' ? 'gelb (nur im Vorgang)' : 'grün'}`),
          t.guide ? richText(t.guide) : h('p', { class: 'warn-text' }, 'Keine Anleitung hinterlegt.'),
          h('h4', {}, 'Checkliste'),
          h('ol', { class: 'hb-steps' }, t.steps.map(s => h('li', {}, h('span', { class: 'box' }, '☐'), ' ', h('strong', {}, s.title), s.manual ? ' (von Hand)' : '', s.description ? h('div', { class: 'small muted' }, s.description) : null))),
          t.learnings.length ? h('div', {}, h('h4', {}, 'Stolpersteine und Entscheidungen'), h('ul', {}, t.learnings.map(l => h('li', {}, h('strong', {}, l.topic, ': '), l.rule, ` (${fmtDate(l.date)})`)))) : null))
          : h('p', { class: 'muted' }, 'Diesem Amt sind noch keine Vorgangsvorlagen zugeordnet (Feld „Zuständige Ämter“ in der Vorlage).'),
        o.open.length ? h('div', { class: 'no-print-small' }, h('h3', {}, 'Laufende Vorgänge'), h('ul', {}, o.open.map(x => h('li', {}, h('a', { href: `#/aufgabe/${x.id}` }, x.title), x.due_date ? ` – fällig ${fmtDate(x.due_date)}` : '')))) : null))
        : emptyState('Keine Ämter in diesem Bereich.'),
      d.learnings.length ? h('section', { class: 'hb-office' }, h('h2', {}, 'Allgemeine Regeln aus dem Lernprotokoll'), h('ul', {}, d.learnings.map(l => h('li', {}, h('strong', {}, l.topic, ': '), l.rule)))) : null,
      h('section', { class: 'hb-office' }, h('h2', {}, 'Systeme'), h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'System'), h('th', {}, 'Zweck'), h('th', {}, 'Zugriff'), h('th', {}, 'Exportweg'))),
        h('tbody', {}, d.systems.map(s => h('tr', {}, h('td', {}, s.name), h('td', {}, s.purpose), h('td', {}, s.access), h('td', {}, s.export_path)))))));
  };

  clear(el, h('div', { class: 'no-print' }, pageHeader('Handbuch je Amt', 'Übergabedokumentation aus den Vorgangsvorlagen. Drucken oder als PDF speichern.',
    button('Drucken / PDF', () => window.print(), { kind: 'primary', iconName: 'printer' })),
  h('div', { class: 'filters' }, areaSel, officeWrap)), out);
  await load();
}
