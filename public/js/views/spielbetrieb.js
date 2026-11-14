// Spielbetrieb der Jugend: Stand aus dem Jugendplaner (Spiele, Zusagen, Fahrer/Betreuer) mit Hinweisen.
// Gelöst wird im Jugendplaner – hier sieht der Vorstand, wo es klemmt.

import { api } from '../api.js';
import { h, clear, pageHeader, button, icon, toast, errorToast, relTime, fmtDate } from '../ui.js';
import { isAdmin } from '../state.js';

const LEVEL = { crit: 'tone-red', warn: 'tone-amber', info: '' };

export default async function spielbetrieb(el, { query = {} }) {
  let d = await api.get('/api/jugendplaner');
  let nurHinweise = query.alle !== '1';

  const open = async () => {
    try { const r = await api.get('/api/jugendplaner/open'); window.open(r.url, 'jugendplaner'); if (!r.sso) toast('Anmeldung im Jugendplaner mit der PIN – für automatische Anmeldung siehe docs/JUGENDPLANER.md', 'ok', 6000); }
    catch (e) { errorToast(e); }
  };
  const syncNow = async () => {
    try { const r = await api.post('/api/jugendplaner/sync'); toast(`Abgeglichen: ${r.counts.spiele} Spiele, ${r.counts.kritisch} kritisch${r.created || r.closed ? ` · ${r.created} Aufgabe(n) neu, ${r.closed} erledigt` : ''}`); d = await api.get('/api/jugendplaner'); draw(); }
    catch (e) { errorToast(e); }
  };

  function draw() {
    const st = d.stand;
    const head = pageHeader('Spielbetrieb Jugend', 'Stand aus dem Jugendplaner – ohne Namen. Fahrer, Betreuer und Zusagen werden im Jugendplaner eingetragen.',
      d.connection.url ? button('Zum Jugendplaner', open, { kind: 'primary', iconName: 'external' }) : null,
      isAdmin() && d.connection.configured ? button('Jetzt abgleichen', syncNow, { kind: 'ghost', iconName: 'refresh' }) : null);
    if (!d.connection.configured) {
      clear(el, head, h('section', { class: 'card pad' }, h('h3', {}, 'Noch nicht verbunden'),
        h('p', {}, 'In der Datei .env des Servers JUGENDPLANER_URL und JUGENDPLANER_SECRET eintragen, Server neu starten, dann unter Adminpanel → Verbindungen den Bereich wählen. Anleitung: docs/JUGENDPLANER.md')));
      return;
    }
    if (!st) { clear(el, head, h('section', { class: 'card pad' }, h('p', {}, 'Noch kein Abgleich.'), isAdmin() ? button('Jetzt abgleichen', syncNow, { kind: 'primary' }) : null)); return; }
    const games = st.games.filter(g => !nurHinweise || g.issues.some(i => i.level !== 'info'));
    const stat = (n, label, tone = '') => h('div', { class: `stat ${tone} ${n ? '' : 'zero'}` }, h('strong', {}, n), h('span', {}, label));
    const toggle = h('input', { type: 'checkbox', checked: nurHinweise });
    toggle.addEventListener('change', () => { nurHinweise = toggle.checked; draw(); });
    const byDate = new Map();
    for (const g of games) { if (!byDate.has(g.date)) byDate.set(g.date, []); byDate.get(g.date).push(g); }
    clear(el, head,
      st.error ? h('div', { class: 'notice' }, icon('alert', 16), h('span', {}, `Letzter Abgleich ${relTime(st.at)} fehlgeschlagen: ${st.error}`)) : null,
      h('div', { class: 'stats' },
        stat(st.counts.kritisch, 'Spiele mit kritischem Hinweis', 'tone-red'),
        stat(st.counts.warnungen, 'mit Warnung'),
        stat(st.counts.naechste14, 'Spiele in 14 Tagen'),
        stat(st.counts.spiele, 'künftige Jugendspiele'),
        h('div', { class: 'stat zero' }, h('strong', {}, st.season || '–'), h('span', {}, `Saison · Abgleich ${relTime(st.at)}`))),
      h('label', { class: 'check mt' }, toggle, h('span', {}, 'Nur Spiele mit Hinweisen zeigen')),
      games.length ? [...byDate].map(([date, list]) => h('section', { class: 'card mt' },
        h('header', { class: 'card-head' }, h('h2', {}, fmtDate(date, { weekday: 'long' })), h('span', { class: 'muted small' }, `${list.length} Spiel(e)`)),
        h('div', { class: 'task-list' }, list.map(g => h('div', { class: 'jp-game' },
          h('div', { class: 'jp-main' },
            h('strong', {}, `${g.team} ${g.home ? 'gegen' : 'bei'} ${g.opponent}`),
            h('div', { class: 'small muted' }, `${g.time || 'Uhrzeit offen'} · ${g.home ? 'Heimspiel' : 'Auswärts'} · Zusagen ${g.yes}/${g.min}`),
            g.issues.length ? h('ul', { class: 'jp-issues' }, g.issues.map(i => h('li', { class: LEVEL[i.level] }, i.text))) : null),
          h('span', { class: `pill ${g.status === 'fahrer' || g.status === 'betreut' ? 'pill-ok' : g.status === 'abgesagt' ? '' : 'pill-warn'}` }, d.labels[g.status] || g.status)))))) :
        h('p', { class: 'muted pad' }, nurHinweise ? 'Keine Hinweise – alles versorgt.' : 'Keine künftigen Spiele.'));
  }
  draw();
}
