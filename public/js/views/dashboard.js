// Startseite: Was steht an? (AUF-1, AUF-6, AUF-7, AUF-8)

import { api } from '../api.js';
import { h, clear, pageHeader, emptyState, fmtDateShort, areaChip, button, relTime, icon } from '../ui.js';
import { state } from '../state.js';
import { taskRow, openTaskForm } from './taskform.js';

export default async function dashboard(el) {
  const d = await api.get('/api/dashboard');
  const jp = state.me.jugendplaner ? await api.get('/api/jugendplaner').catch(() => null) : null;
  const jpCrit = jp?.stand?.counts?.kritisch || 0;
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';
  const first = state.me.user.name.split(' ')[0];

  const stat = (n, label, href, tone = '') => h('a', { class: `stat ${tone} ${n ? '' : 'zero'}`, href }, h('strong', {}, n), h('span', {}, label));
  const section = (title, items, emptyText, href, opts = {}) => h('section', { class: 'card' },
    h('header', { class: 'card-head' }, h('h2', {}, title, items.length ? h('span', { class: 'count' }, items.length) : null), href ? h('a', { href, class: 'link' }, 'alle') : null),
    items.length ? h('div', { class: 'task-list' }, items.slice(0, opts.limit || 8).map(t => taskRow(t))) : h('p', { class: 'muted pad' }, emptyText));

  const approvals = state.me.counts.approvals;
  const inbox = state.me.counts.inbox;

  clear(el,
    pageHeader(`${greet}, ${first}`, d.totals.ueberfaellig ? `${d.totals.ueberfaellig} überfällig – am besten zuerst ansehen.` : 'Nichts überfällig. Gut so.',
      button('Übersicht als Bericht', async () => { const r = await api.post('/api/reports/overview', {}); location.hash = `#/automatisierung/berichte?id=${r.id}`; }, { iconName: 'chart', kind: 'ghost' })),
    state.me.setup_open ? h('a', { class: 'notice notice-action', href: '#/einrichtung' }, icon('check', 16),
      h('span', {}, h('strong', {}, 'Einrichtung noch nicht abgeschlossen. '), 'Der Assistent führt durch Bereiche, Ämter, Datenschutz, Verbindungen und Automatisierungen.'), h('span', { class: 'link' }, 'Weiter einrichten →')) : null,
    jpCrit ? h('a', { class: 'notice notice-action', href: '#/spielbetrieb' }, icon('layers', 16),
      h('span', {}, h('strong', {}, `Spielbetrieb Jugend: ${jpCrit} Spiel(e) mit kritischem Hinweis. `), 'Zum Beispiel fehlt ein Fahrer oder Betreuer – gelöst wird im Jugendplaner.'), h('span', { class: 'link' }, 'Ansehen →')) : null,
    h('div', { class: 'stats' },
      stat(d.totals.mine, 'meine offenen', '#/aufgaben?owner=me'),
      stat(d.totals.ueberfaellig, 'überfällig', '#/aufgaben?due=ueberfaellig', 'tone-red'),
      stat(d.totals.heute, 'heute fällig', '#/aufgaben?due=heute', 'tone-amber'),
      stat(d.totals.wartet, 'warten auf Zulieferung', '#/aufgaben?status=wartet', 'tone-violet'),
      stat(d.totals.liegt_lange, 'liegen lange', '#/aufgaben?stale=1', 'tone-slate'),
      stat(d.totals.offen, 'offen insgesamt', '#/aufgaben')),
    (approvals || inbox) ? h('div', { class: 'callouts' },
      approvals ? h('a', { class: 'callout callout-violet', href: '#/automatisierung/freigaben' }, icon('lock'), h('span', {}, h('strong', {}, `${approvals} Freigabe${approvals === 1 ? '' : 'n'}`), ' wartet auf dein Ja')) : null,
      inbox ? h('a', { class: 'callout callout-blue', href: '#/eingang' }, icon('inbox'), h('span', {}, h('strong', {}, `${inbox} Eingang${inbox === 1 ? '' : 'e'}`), ' zum Einsortieren')) : null) : null,
    h('div', { class: 'grid-2' },
      h('div', { class: 'col' },
        section('Überfällig', d.overdue, 'Keine überfälligen Aufgaben.', '#/aufgaben?due=ueberfaellig'),
        section('Meine Aufgaben', d.mine.filter(t => !t.overdue), 'Dir ist gerade nichts zugeordnet.', '#/aufgaben?owner=me', { limit: 10 }),
        section('In den nächsten 7 Tagen', d.week, 'Diese Woche ist nichts fällig.', '#/aufgaben?due=woche')),
      h('div', { class: 'col' },
        section('Wartet auf Zulieferung', d.waiting, 'Niemand schuldet gerade etwas.', '#/aufgaben?status=wartet'),
        section('Nachfassen: lange ohne Bewegung', d.stale, 'Alles in Bewegung.', '#/aufgaben?stale=1&sort=bewegung'),
        d.unassigned.length ? section('Ohne Zuständigkeit', d.unassigned, '', '#/aufgaben?owner=none') : null,
        h('section', { class: 'card' },
          h('header', { class: 'card-head' }, h('h2', {}, 'Termine (14 Tage)'), h('a', { href: '#/kalender', class: 'link' }, 'Kalender')),
          d.upcoming.length ? h('ul', { class: 'mini-list' }, d.upcoming.map(e => h('li', {}, h('span', { class: 'date' }, fmtDateShort(e.date), e.time ? ` ${e.time}` : ''), h('span', {}, e.title), areaChip(e.area_name, e.area_color))))
            : h('p', { class: 'muted pad' }, 'Keine Termine.')),
        d.ideas.length ? h('section', { class: 'card card-idea' },
          h('header', { class: 'card-head' }, h('h2', {}, 'Ideen zur Entscheidung', h('span', { class: 'count' }, d.ideas.length)), h('a', { href: '#/ideen', class: 'link' }, 'Ideenspeicher')),
          h('p', { class: 'muted pad-x' }, 'Diese Ideen liegen schon lange. Umsetzen oder verwerfen?'),
          h('ul', { class: 'mini-list' }, d.ideas.map(i => h('li', {}, h('a', { href: `#/aufgabe/${i.id}` }, i.title), h('small', { class: 'muted' }, `zuletzt ${relTime(i.last_activity_at)}`))))) : null,
        d.lastReport ? h('p', { class: 'muted small' }, 'Letzte Übersicht: ', h('a', { href: `#/automatisierung/berichte?id=${d.lastReport.id}` }, d.lastReport.title)) : null)),
    d.totals.offen === 0 ? emptyState('Noch keine Aufgaben. Leg die erste an oder übernimm deine Liste aus Asana (Adminpanel → Asana-Import).',
      button('Neue Aufgabe', () => openTaskForm(), { kind: 'primary', iconName: 'plus' })) : null);
}
