// Automatisierungen → „Mit KI erstellen“: Claude schlägt Regeln und Katalog-Einträge vor, Admins übernehmen.

import { api } from '../api.js';
import { h, clear, button, textarea, toast, errorToast, emptyState, fmtDateTime, icon, levelBadge, relTime } from '../ui.js';
import { refreshCatalog } from '../state.js';

const TRIGGER = { zeitplan: 'Zeitplan', frist: 'Frist', eingang: 'Eingang', statuswechsel: 'Statuswechsel', manuell: 'auf Zuruf' };
const ACTION = { aufgabe_anlegen: 'Aufgabe anlegen', entwurf_erzeugen: 'Entwurf erzeugen', erinnern: 'Erinnern', uebersicht: 'Übersicht erstellen', kalendereintrag: 'Kalendereintrag (mit Freigabe)' };
const WD = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const EXAMPLES = [
  'Erinnere die Vertretung, wenn ein Schiedsrichter-Ersatz zwei Tage vor dem Spiel noch offen ist.',
  'Wenn ein Spielbericht erledigt ist, soll automatisch eine Aufgabe für den Instagram-Beitrag entstehen.',
  'Jeden Freitag um 16 Uhr möchte ich eine Übersicht aller wartenden Aufgaben.',
  'Ich möchte nicht mehr vergessen, Sponsoren zu Weihnachten zu kontaktieren.',
];

export default async function kiTab(el) {
  const st = await api.get('/api/ki/status');
  const results = h('div', { class: 'stack' });
  const history = h('div');

  const statusBox = h('div', { class: `conn-status ${st.active ? 'ok' : st.key && st.sdk ? 'half' : 'off'}` },
    icon(st.active ? 'check' : 'alert', 16),
    h('div', {},
      h('strong', {}, st.active ? `Claude ist verbunden (${st.model})` : !st.key ? 'Kein API-Schlüssel hinterlegt' : !st.sdk ? 'SDK fehlt' : 'KI-Assistent ist ausgeschaltet'),
      h('div', { class: 'small muted' }, st.active
        ? `Letzte 30 Tage: ${st.last30.n} Anfrage(n), ${(st.last30.i + st.last30.o).toLocaleString('de-DE')} Tokens.`
        : [!st.key ? 'ANTHROPIC_API_KEY in die Datei .env auf dem Server eintragen (Vorlage .env.beispiel), Server neu starten. ' : '',
          st.sdkError ? st.sdkError + ' ' : '',
          'Danach unter ', h('a', { href: '#/admin/automatisierungen' }, 'Adminpanel → Automatisierungen'), ' den Eintrag „Automatisierungen mit KI entwerfen“ einschalten.'])));

  const input = textarea({ rows: 4, placeholder: 'Was soll die App künftig für dich übernehmen? In eigenen Worten, z. B. „Wenn …, dann …“.', disabled: !st.active });
  const examples = h('div', { class: 'chips' }, EXAMPLES.map(t => h('button', { class: 'chip', type: 'button', disabled: !st.active, onclick: () => { input.value = t; input.focus(); } }, t)));
  const askBtn = button('Vorschläge holen', () => run('beschreibung'), { kind: 'primary', iconName: 'zap', disabled: !st.active });
  const ideasBtn = button('Ideen aus unseren Daten finden', () => run('ideen'), { kind: 'ghost', iconName: 'bulb', disabled: !st.active, title: 'Claude sieht Zählwerte der letzten 90 Tage und Titel grüner Aufgaben ohne Vorlage' });

  const preview = h('details', { class: 'small' }, h('summary', {}, 'Was wird an Claude übertragen?'), h('div', { class: 'pad-sm' }));
  preview.addEventListener('toggle', async () => {
    if (!preview.open || preview.dataset.loaded) return;
    preview.dataset.loaded = '1';
    const [b, i] = await Promise.all([api.get('/api/ki/preview?mode=beschreibung'), api.get('/api/ki/preview?mode=ideen')]);
    clear(preview.lastChild,
      h('p', {}, 'Immer: deine Beschreibung (Adressen, Telefonnummern, Mailadressen und Bankdaten werden vorher entfernt) und ', b.summary, '.'),
      h('p', {}, 'Bei „Ideen finden“ zusätzlich: ', i.summary.split('; ').slice(1).join('; '), '.'),
      h('p', {}, h('strong', {}, 'Nie: '), 'Aufgaben mit gelben Daten, Beschreibungen, Kommentare, Eingänge, Dateien, Mitglieder- oder Bankdaten.'),
      h('details', {}, h('summary', {}, 'Genauen Inhalt anzeigen (Ideen-Modus)'), h('pre', { class: 'payload' }, JSON.stringify(i.ctx, null, 2))));
  });

  async function run(mode) {
    if (mode === 'beschreibung' && input.value.trim().length < 10) return errorToast(new Error('Bitte das Anliegen in ein, zwei Sätzen beschreiben.'));
    askBtn.disabled = ideasBtn.disabled = true;
    clear(results, h('div', { class: 'loading' }, h('span', { class: 'spin' }), 'Claude denkt nach … (meist 20–60 Sekunden)'));
    try {
      const r = await api.post('/api/ki/ask', { mode, text: input.value });
      if (r.warnings?.length) toast(r.warnings.join(' '), 'warn', 7000);
      await show(r.id);
      loadHistory();
    } catch (e) {
      clear(results, h('div', { class: 'warn-box' }, icon('alert', 16), h('div', {}, e.message)));
      loadHistory();
    } finally { askBtn.disabled = ideasBtn.disabled = false; }
  }

  async function show(id) {
    const r = await api.get(`/api/ki/requests/${id}`);
    if (r.status !== 'ok') { clear(results, h('div', { class: 'warn-box' }, icon('alert', 16), h('div', {}, h('strong', {}, r.status === 'abgelehnt' ? 'Abgelehnt: ' : 'Fehler: '), r.error))); return; }
    const d = r.response;
    clear(results,
      h('div', { class: 'card pad' },
        h('div', { class: 'small muted' }, `${r.mode === 'ideen' ? 'Ideen finden' : 'Anliegen'} · ${fmtDateTime(r.created_at)} · ${r.model} · ${(r.input_tokens + r.output_tokens).toLocaleString('de-DE')} Tokens${r.cost_usd != null ? ` · ca. ${r.cost_usd.toLocaleString('de-DE', { style: 'currency', currency: 'USD' })}` : ''}`),
        r.mode === 'beschreibung' ? h('blockquote', {}, r.prompt) : null,
        h('p', {}, d.zusammenfassung),
        d.rueckfragen?.length ? h('div', { class: 'callout callout-blue' }, icon('help'), h('div', {}, h('strong', {}, 'Rückfragen: '), h('ul', {}, d.rueckfragen.map(q => h('li', {}, q))))) : null),
      d.vorschlaege.length ? d.vorschlaege.map((v, i) => proposal(r, v, i)) : emptyState('Keine Vorschläge.'));
  }

  function proposal(r, v, i) {
    const check = r.checks[i] || {};
    const applied = r.applied[i];
    const kind = { regel: ['Neue Regel', 'badge-level'], katalog: ['Katalog einschalten', 'badge-gruen'], nicht_moeglich: ['Nicht möglich', 'badge-red'] }[v.art];
    let detail = null;
    if (v.art === 'regel') {
      const g = v.regel;
      const when = g.ausloeser === 'zeitplan' ? `${g.rhythmus === 'woechentlich' ? `jeden ${WD[g.wochentag] || ''}` : g.rhythmus === 'monatlich' ? `monatlich am ${g.tag_im_monat}.` : 'täglich'} um ${g.stunde} Uhr`
        : g.ausloeser === 'frist' ? `${g.tage_vorher} Tag(e) vor Fälligkeit`
        : g.ausloeser === 'statuswechsel' ? `Statuswechsel${g.status_von ? ` von ${g.status_von}` : ''}${g.status_zu ? ` zu ${g.status_zu}` : ''}` : TRIGGER[g.ausloeser];
      const what = g.aktion === 'aufgabe_anlegen' ? `„${g.aufgabe_titel}“${g.aufgabe_vorgang ? ` (${g.aufgabe_vorgang})` : ''}, fällig in ${g.faellig_in_tagen} Tagen`
        : g.aktion === 'entwurf_erzeugen' ? `aus Vorlage ${g.textvorlage}` : g.aktion === 'erinnern' ? (g.nachricht ? `„${g.nachricht}“` : '') + (g.auch_vertretung ? ' – auch die Vertretung' : '')
        : g.aktion === 'kalendereintrag' ? `„${g.termin_titel}“` : '';
      detail = h('div', { class: 'rule-flow' }, h('span', { class: 'rf-when' }, icon('clock', 14), when), icon('chevronRight', 14),
        h('span', { class: 'rf-do' }, icon('zap', 14), ACTION[g.aktion], what ? ': ' + what : ''), levelBadge(g.stufe),
        h('span', { class: 'small muted' }, [g.bereich || 'alle Bereiche', g.vorgang ? `nur ${g.vorgang}` : null].filter(Boolean).join(' · ')));
    } else if (v.art === 'katalog') {
      detail = h('div', { class: 'small' }, 'Katalog: ', h('strong', {}, check.label || v.katalog.schluessel),
        v.katalog.parameter.length ? ` · ${v.katalog.parameter.map(p => `${p.name} = ${p.wert}`).join(', ')}` : '');
    }
    const actionBtn = v.art === 'nicht_moeglich' ? null : applied
      ? h('span', { class: 'pill st-erledigt' }, applied.startsWith('regel') ? h('a', { href: '#/automatisierung/regeln' }, 'als Regel angelegt – Freigabe offen') : 'eingeschaltet')
      : button(v.art === 'regel' ? 'Als Regel anlegen' : 'Einschalten', async () => {
        try {
          const res = await api.post(`/api/ki/requests/${r.id}/apply`, { index: i });
          toast(res.type === 'regel' ? 'Regel angelegt. Sie läuft erst nach Freigabe (Automatisierungen → Regeln).' : 'Im Katalog eingeschaltet.', 'ok', 6000);
          if (res.type === 'katalog') refreshCatalog().catch(() => {});
          show(r.id);
        } catch (e) { errorToast(e); }
      }, { kind: 'primary', iconName: 'check', disabled: !check.ok });
    return h('article', { class: `card pad ki-proposal ${check.ok ? '' : 'invalid'}` },
      h('div', { class: 'ap-head' }, h('div', { class: 'rule-title' }, h('span', { class: `badge ${kind[1]}` }, kind[0]), h('strong', {}, v.titel)), actionBtn),
      h('p', { class: 'small' }, v.begruendung),
      v.nutzen ? h('p', { class: 'small muted' }, 'Nutzen: ', v.nutzen) : null,
      detail,
      check.fehler?.length ? h('div', { class: 'small warn-text' }, icon('alert', 12), ' Nicht übernehmbar: ', check.fehler.join('; ')) : null,
      check.hinweise?.length ? h('div', { class: 'small muted' }, check.hinweise.join(' ')) : null);
  }

  async function loadHistory() {
    const rows = await api.get('/api/ki/requests');
    clear(history, rows.length ? h('details', { class: 'card pad mt' }, h('summary', {}, `Frühere Anfragen (${rows.length})`),
      h('ul', { class: 'mini-list' }, rows.map(x => h('li', {},
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); show(x.id); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, x.mode === 'ideen' ? 'Ideen finden' : x.prompt.slice(0, 90)),
        h('small', { class: x.status === 'ok' ? 'muted' : 'warn-text' }, `${x.status === 'ok' ? `${x.response.vorschlaege?.length ?? 0} Vorschläge, ${Object.keys(x.applied).length} übernommen` : x.status} · ${x.user_name || ''} · ${relTime(x.created_at)}`))))) : null);
  }

  clear(el,
    h('section', { class: 'card pad' },
      h('h2', {}, icon('zap', 18), ' Automatisierungen mit KI entwerfen'),
      h('p', { class: 'small' }, 'Beschreibe in eigenen Worten, was die App dir abnehmen soll. Claude schlägt passende Regeln oder fertige Katalog-Abläufe vor. Jeder Vorschlag wird von der App gegen Sperrliste und Höchststufen geprüft; angelegt wird nur, was du übernimmst – und neue Regeln laufen erst nach der üblichen Freigabe.'),
      statusBox, input, examples,
      h('div', { class: 'btn-row mt' }, askBtn, ideasBtn), preview),
    results, history);
  loadHistory();
}
