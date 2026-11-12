// Kennzahlen (AUF-10, ABN-3, ABN-4): Liegezeit, Durchlaufzeit und erfasste Minuten je Monat.

import { api } from '../api.js';
import { h, clear, pageHeader, select, MONTHS, emptyState, icon } from '../ui.js';
import { areaOptions } from '../state.js';

export default async function metrics(el, { query = {} }) {
  let area = query.area || '';
  let months = Number(query.months) || 12;
  const body = h('div');
  const areaSel = select(areaOptions(), area);
  const monthSel = select([[6, '6 Monate'], [12, '12 Monate'], [24, '24 Monate']], months);
  areaSel.addEventListener('change', () => { area = areaSel.value; load(); });
  monthSel.addEventListener('change', () => { months = Number(monthSel.value); load(); });

  const load = async () => {
    const d = await api.get(`/api/metrics?months=${months}${area ? '&area=' + area : ''}`);
    const c = d.current;
    const hero = (label, value, unit, note, tone) => h('div', { class: `stat hero ${tone || ''}` }, h('span', {}, label), h('strong', {}, value ?? '—', value != null ? h('small', {}, unit) : null), note ? h('em', {}, note) : null);
    const goal = c.ziel_erreicht == null ? null : c.ziel_erreicht;
    clear(body,
      h('div', { class: 'stats heroes' },
        hero('Mittlere Liegezeit, letzte 6 Wochen', c.liegezeit_6_wochen?.toLocaleString('de-DE'), ' Tage',
          goal == null ? `Ziel: höchstens ${d.target} Tage` : goal ? `✓ Ziel erreicht (≤ ${d.target} Tage)` : `✗ Ziel verfehlt (≤ ${d.target} Tage)`, goal == null ? '' : goal ? 'tone-good' : 'tone-bad'),
        hero('Begonnene Aufgaben in diesem Zeitraum', c.anzahl, '', 'Grundlage der Liegezeit'),
        hero('Noch nicht begonnen', c.noch_nicht_begonnen, '', c.warten_seit_mittel != null ? `warten im Mittel seit ${c.warten_seit_mittel.toLocaleString('de-DE')} Tagen` : null),
        hero('Vorher (Asana)', d.baseline.asana_durchlaufzeit_mittel?.toLocaleString('de-DE'), ' Tage', d.baseline.asana_anzahl ? `mittlere Durchlaufzeit, ${d.baseline.asana_anzahl} importierte Aufgaben` : 'kein Import vorhanden')),
      h('div', { class: 'grid-2' },
        chartCard('Mittlere Liegezeit je Monat (Tage)', 'Zeit von der Erfassung bis zur ersten Bearbeitung. Gestrichelt: Ziel.', d.monthly, 'liegezeit_mittel', { target: d.target, unit: 'Tage', extra: (m) => `${m.started} begonnen` }),
        chartCard('Erfasste Stunden je Monat', 'Summe der erfassten Minuten (inkl. Prüfzeit).', d.monthly, 'stunden', { unit: 'Std.', extra: (m) => `${m.minuten} Minuten` }),
        chartCard('Mittlere Durchlaufzeit je Monat (Tage)', 'Erfassung bis Abschluss, für im Monat erledigte Aufgaben.', d.monthly, 'durchlaufzeit_mittel', { unit: 'Tage', extra: (m) => `${m.done} erledigt` }),
        chartCard('Erledigte Aufgaben je Monat', null, d.monthly, 'done', { unit: '', extra: (m) => `${m.created} neu erfasst` })),
      h('section', { class: 'card' },
        h('header', { class: 'card-head' }, h('h2', {}, 'Zeitersparnis je Vorgangstyp (ABN-4)')),
        d.byTemplate.length ? h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Vorgang'), h('th', { class: 'num' }, 'Durchläufe'), h('th', { class: 'num' }, 'Vorher (Min.)'), h('th', { class: 'num' }, 'Jetzt je Durchlauf (Min.)'), h('th', { class: 'num' }, 'Ersparnis'))),
          h('tbody', {}, d.byTemplate.map(t => h('tr', {}, h('td', {}, t.name), h('td', { class: 'num' }, t.durchlaeufe), h('td', { class: 'num' }, t.vorher_minuten ?? '—'), h('td', { class: 'num' }, t.minuten_je_durchlauf),
            h('td', { class: 'num' }, t.ersparnis_minuten == null ? h('span', { class: 'muted' }, 'Vorher-Wert in der Vorlage eintragen') : h('span', { class: t.ersparnis_minuten >= 0 ? 'good-text' : 'warn-text' }, `${t.ersparnis_minuten >= 0 ? '−' : '+'}${Math.abs(t.ersparnis_minuten)} Min.`))))))
          : h('p', { class: 'muted pad' }, 'Noch keine abgeschlossenen Vorgänge mit Vorlage und erfasster Zeit.')),
      h('p', { class: 'muted small' }, 'Aus Asana importierte Aufgaben zählen nur als Vorher-Wert, nicht in die Monatswerte.'));
  };

  clear(el, pageHeader('Kennzahlen', 'Liegezeit, Durchlaufzeit und erfasste Zeit – vorher und nachher an denselben Aufgaben.'), h('div', { class: 'filters' }, areaSel, monthSel), body);
  await load();
}

/** Säulendiagramm für eine Reihe mit Hover-Hinweis, optionaler Ziellinie und Tabellenansicht. */
function chartCard(title, sub, data, key, { target, unit, extra } = {}) {
  const values = data.map(m => m[key]);
  const has = values.some(v => v != null && v > 0);
  const card = h('section', { class: 'card chart-card' }, h('header', { class: 'card-head' }, h('div', {}, h('h2', {}, title), sub ? h('p', { class: 'small muted' }, sub) : null)));
  if (!has) { card.append(h('p', { class: 'muted pad' }, 'Noch keine Werte.')); return card; }
  const W = 560, H = 200, padL = 34, padB = 26, padT = 10, padR = 6;
  const max = Math.max(...values.map(v => v || 0), target || 0) * 1.15 || 1;
  const nice = niceMax(max);
  const bw = (W - padL - padR) / data.length;
  const barW = Math.max(4, Math.min(28, bw - 6));
  const y = (v) => padT + (H - padT - padB) * (1 - v / nice);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', title);
  const el = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  for (let i = 0; i <= 4; i++) {
    const v = nice / 4 * i;
    svg.append(el('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: 'grid' }));
    const t = el('text', { x: padL - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }); t.textContent = fmtNum(v); svg.append(t);
  }
  const tip = h('div', { class: 'chart-tip', hidden: true });
  data.forEach((m, i) => {
    const v = m[key];
    const cx = padL + bw * i + bw / 2;
    if (v != null && v > 0) {
      const top = y(v), bottom = y(0);
      const r = Math.min(4, barW / 2, bottom - top);
      // Säule mit 4px abgerundetem oberen Ende, unten an der Grundlinie bündig
      const x0 = cx - barW / 2, x1 = cx + barW / 2;
      svg.append(el('path', { class: 'bar', d: `M${x0},${bottom} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x1 - r} Q${x1},${top} ${x1},${top + r} V${bottom} Z` }));
    }
    const lbl = el('text', { x: cx, y: H - 8, class: 'axis', 'text-anchor': 'middle' });
    const [yy, mm] = m.month.split('-');
    lbl.textContent = data.length > 12 && i % 2 ? '' : `${MONTHS[Number(mm) - 1].slice(0, 3)}${mm === '01' || i === 0 ? ' ' + yy.slice(2) : ''}`;
    svg.append(lbl);
    const hit = el('rect', { x: padL + bw * i, y: padT, width: bw, height: H - padT - padB, class: 'hit' });
    hit.addEventListener('mouseenter', () => {
      tip.hidden = false;
      tip.replaceChildren(h('strong', {}, `${MONTHS[Number(mm) - 1]} ${yy}`), h('div', {}, v == null ? 'kein Wert' : `${fmtNum(v)} ${unit}`), extra ? h('div', { class: 'muted' }, extra(m)) : null);
      tip.style.left = `${(cx / W) * 100}%`;
      tip.style.top = `${(y(v || 0) / H) * 100}%`;
      hit.classList.add('on');
    });
    hit.addEventListener('mouseleave', () => { tip.hidden = true; hit.classList.remove('on'); });
    svg.append(hit);
  });
  if (target) {
    svg.append(el('line', { x1: padL, x2: W - padR, y1: y(target), y2: y(target), class: 'target' }));
    const t = el('text', { x: W - padR, y: y(target) - 4, class: 'axis target-label', 'text-anchor': 'end' }); t.textContent = `Ziel ${target}`; svg.append(t);
  }
  svg.append(el('line', { x1: padL, x2: W - padR, y1: y(0), y2: y(0), class: 'baseline' }));
  const table = h('table', { class: 'table small', hidden: true }, h('thead', {}, h('tr', {}, h('th', {}, 'Monat'), h('th', { class: 'num' }, `Wert${unit ? ' (' + unit + ')' : ''}`))),
    h('tbody', {}, data.map(m => h('tr', {}, h('td', {}, m.month), h('td', { class: 'num' }, m[key] == null ? '—' : fmtNum(m[key]))))));
  const toggle = h('button', { class: 'link small', type: 'button', onclick: () => { table.hidden = !table.hidden; toggle.textContent = table.hidden ? 'Als Tabelle' : 'Tabelle ausblenden'; } }, 'Als Tabelle');
  card.firstChild.append(toggle);
  card.append(h('div', { class: 'chart-wrap' }, svg, tip), table);
  return card;
}

function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const fmtNum = (v) => (Math.round(v * 10) / 10).toLocaleString('de-DE');

export { emptyState, icon };
