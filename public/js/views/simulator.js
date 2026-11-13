// Vorstandsarbeit-Simulator: Steuerung (Zeitraffer, Szenarien) und Auswertung.

import { api } from '../api.js';
import { h, clear, pageHeader, button, icon, toast, errorToast, fmtDateTime, fmtDate } from '../ui.js';
import { state, refreshMe } from '../state.js';

const DIFF = ['', 'leicht', 'mittel', 'schwer'];

export default async function simulator(el) {
  if (!state.me.simulator) { clear(el, h('div', { class: 'empty' }, h('p', {}, 'Der Simulator läuft nur in der Simulator-Instanz (npm run simulator).'))); return; }
  let s = await api.get('/api/sim');
  let busy = false;

  const act = async (fn, msg) => {
    if (busy) return;
    busy = true; draw();
    try { s = await fn(); await refreshMe(); if (msg) toast(msg); } catch (e) { errorToast(e); }
    busy = false; draw();
  };
  const advance = (days) => act(() => api.post('/api/sim/advance', { days }), `${days} Tag(e) vorgespult`);

  function scenarioCard(sc) {
    const open = sc.state === 'laeuft';
    return h('article', { class: `card pad scenario ${open ? 'active' : ''} ${sc.state === 'geloest' ? 'solved' : ''}` },
      h('h3', {}, sc.state === 'geloest' ? icon('check', 16) : open ? icon('play', 14) : null, sc.title),
      h('div', { class: 'meta' }, `${sc.area} · ${DIFF[sc.difficulty]} · ca. ${sc.days} Tag(e)`,
        open ? ` · läuft seit Tag ${sc.day}` : sc.state === 'geloest' ? ` · gelöst nach ${sc.solved_days} Tag(en)` : sc.state === 'abgebrochen' ? ' · abgebrochen' : ''),
      h('p', { class: 'small' }, sc.problem),
      sc.state !== 'neu' ? h('ul', { class: 'checks' }, sc.checks.map(c => h('li', { class: c.ok ? 'ok' : '' }, c.ok ? '✓' : '○', ' ', c.label))) : null,
      open ? h('details', {}, h('summary', { class: 'small' }, 'Tipps'), h('ul', { class: 'small' }, sc.tips.map(t => h('li', {}, t)))) : null,
      h('div', { class: 'btn-row' },
        sc.state === 'neu' || sc.state === 'abgebrochen' ? button('Starten', () => act(() => api.post('/api/sim/scenario', { key: sc.key }), `„${sc.title}“ läuft – schau in den Eingang.`), { kind: 'primary', iconName: 'play', disabled: busy }) : null,
        open ? button('Abbrechen', () => act(() => api.post('/api/sim/scenario/abort', { key: sc.key })), { kind: 'ghost', disabled: busy }) : null));
  }

  function draw() {
    const running = s.scenarios.filter(x => x.state === 'laeuft');
    const others = s.scenarios.filter(x => x.state !== 'laeuft');
    const noise = h('input', { type: 'checkbox', class: 'switch', checked: s.rauschen });
    noise.addEventListener('change', () => act(() => api.post('/api/sim/noise', { on: noise.checked })));
    const stat = (n, label, tone = '') => h('div', { class: `stat ${tone} ${n ? '' : 'zero'}` }, h('strong', {}, n), h('span', {}, label));
    clear(el,
      pageHeader('Vorstandsarbeit-Simulator', 'Ein erfundener Verein, nachgebaute Dienste, echte App. Alle Datenschutz-Schalter sind an – es gibt nur Fantasiedaten.'),
      h('section', { class: 'card pad' },
        h('div', { class: 'sim-clock' },
          h('span', { class: 'date' }, new Date(s.today + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })),
          h('span', { class: 'muted small' }, s.sim_day ? `Tag ${s.sim_day} der Simulation` : 'Erster Tag der Simulation'),
          h('span', { class: 'spacer' }),
          button('+1 Tag', () => advance(1), { iconName: 'play', disabled: busy }),
          button('+3 Tage', () => advance(3), { kind: 'ghost', disabled: busy }),
          button('+1 Woche', () => advance(7), { kind: 'ghost', disabled: busy }),
          button('Jetzt abrufen', () => act(() => api.post('/api/sim/pull'), 'Postfächer und Spielpläne abgerufen'), { kind: 'ghost', iconName: 'refresh', disabled: busy }),
          busy ? h('span', { class: 'spin' }) : null),
        h('p', { class: 'small muted' }, 'Ein Tag vorspulen = Tageslauf (Erinnerungen, Jahreskalender, Sponsoren, Eskalation), Regeln, Postfach- und Spielplan-Abruf, Reaktionen der Welt auf euer Handeln. Zurückspulen geht nicht – für einen Neustart „npm run simulator -- --neu“.'),
        h('label', { class: 'check' }, noise, h('span', {}, 'Alltagsrauschen: an manchen Tagen kommen zusätzliche Nachrichten (Newsletter, Spielberichte, Anfragen)'))),
      h('div', { class: 'stats' },
        stat(`${s.score.solved}/${s.score.total}`, 'Szenarien gelöst', 'tone-green'),
        stat(s.score.points, 'Punkte'),
        stat(s.health.ueberfaellig, 'überfällig', 'tone-red'),
        stat(s.health.eingang, 'im Eingang'),
        stat(s.health.freigaben, 'Freigaben offen'),
        stat(s.health.ohne_verantwortung, 'ohne Verantwortung')),
      running.length ? h('section', {}, h('h2', {}, 'Laufende Szenarien'), h('div', { class: 'sim-grid' }, running.map(scenarioCard))) : null,
      h('section', {}, h('div', { class: 'card-head' }, h('h2', {}, 'Szenarien'), button('Zufälliges Szenario', () => act(() => api.post('/api/sim/scenario', { key: 'zufall' }), 'Zufälliges Szenario gestartet'), { kind: 'ghost', iconName: 'zap', disabled: busy })),
        h('p', { class: 'muted small' }, 'Aus typischen Problemen von Sportvereinen (Ehrenamt-Mangel, Schiedsrichter, Hallen, Kasse, Satzungsfristen, Datenschutz, Betrugsmails). Jedes prüft selbst, ob es gelöst ist.'),
        h('div', { class: 'sim-grid' }, others.map(scenarioCard))),
      h('div', { class: 'grid-2' },
        h('section', { class: 'card pad' }, h('h3', {}, 'Ereignisse'), s.log.length ? h('ul', { class: 'mini-list sim-log' }, s.log.map(l => h('li', {}, h('span', {}, l.text), h('small', { class: 'muted' }, fmtDateTime(l.at))))) : h('p', { class: 'muted' }, 'Noch nichts passiert.')),
        h('section', { class: 'card pad' }, h('h3', {}, 'Was die App „nach außen“ getan hätte'),
          h('p', { class: 'small muted' }, 'Entwürfe ins Postfach, Outlook-Termine, SharePoint-Kopien, KI-Anfragen – im Simulator landen sie hier statt bei Microsoft oder Anthropic.'),
          s.aussen.length ? h('ul', { class: 'mini-list sim-log' }, s.aussen.map(l => h('li', {}, h('span', {}, l.text), h('small', { class: 'muted' }, fmtDateTime(l.at))))) : h('p', { class: 'muted' }, 'Noch nichts.'))),
      h('div', { class: 'grid-2' },
        h('section', { class: 'card pad' }, h('h3', {}, 'Der Demo-Verein'),
          h('p', { class: 'small' }, s.world.areas.join(' · ')),
          h('ul', { class: 'mini-list' }, s.world.people.map(p => h('li', {}, h('span', {}, h('strong', {}, p.name), ` (${p.login})`), h('small', { class: 'muted' }, p.text)))),
          h('p', { class: 'small muted' }, 'Anmelden als andere Person: abmelden und mit deren Anmeldenamen einloggen – das Passwort steht in data-simulator/SIMULATOR-ZUGANG.txt.'),
          h('p', { class: 'small muted' }, `Postfächer: ${s.world.mailboxes.join(', ')}`)),
        h('section', { class: 'card pad' }, h('h3', {}, 'Nächste Spiele (click-TT-Nachbau)'),
          h('ul', { class: 'mini-list' }, s.spiele.map(g => h('li', {}, h('span', {}, g.summary), h('small', { class: 'date' }, `${fmtDate(g.date)} ${g.time}`)))))));
  }
  draw();
  const timer = setInterval(async () => { if (busy || document.hidden) return; try { s = await api.get('/api/sim'); draw(); } catch { /* still */ } }, 15_000);
  return () => clearInterval(timer);
}
