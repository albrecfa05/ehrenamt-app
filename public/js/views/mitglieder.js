// Mitgliederliste und Auslosung (Trainingspaare, Doppel, Gruppen, KO-Baum, Reihenfolge).

import { api } from '../api.js';
import { h, clear, pageHeader, tabs, button, iconButton, select, input, textarea, field, toast, errorToast, confirmDialog, copyText, emptyState, fmtDateTime } from '../ui.js';
import { state, areaOptions, isAdmin } from '../state.js';

export default async function mitglieder(el, { query = {} }) {
  let tab = query.tab || 'auslosung';
  const body = h('div');
  const draw = () => {
    clear(el, pageHeader('Mitglieder & Auslosung', 'Trainingspaare, Doppel, Gruppen oder einen Turnierbaum auslosen – aus der Mitgliederliste oder mit eingefügten Namen.'),
      tabs([['auslosung', 'Auslosen'], ['liste', 'Mitgliederliste'], ['verlauf', 'Gespeicherte Auslosungen']], tab, (k) => { tab = k; history.replaceState(null, '', `#/mitglieder?tab=${k}`); draw(); }),
      body);
    ({ auslosung, liste, verlauf })[tab](body).catch(errorToast);
  };
  draw();
}

// ---------- Auslosen ----------

async function auslosung(el) {
  const [{ enabled, members, teams }, modes] = await Promise.all([api.get('/api/members'), api.get('/api/draws/modes')]);
  const areaSel = select(areaOptions('Alle Bereiche'), '');
  const teamSel = select([['', 'Alle Mannschaften/Gruppen'], ...teams.map(t => [t, t])], '');
  const search = input({ type: 'search', placeholder: 'Namen filtern …' });
  const chosen = new Set();
  const listBox = h('div', { class: 'pick-list' });
  const pasted = textarea({ rows: 6, placeholder: 'Ein Name je Zeile, optional mit Spielstärke: „Anna Ahorn; 1350“' });
  const mode = select(modes.map(m => [m.key, m.label]), 'paare');
  const groups = input({ type: 'number', min: 2, max: 32, value: 4, class: 'w-small' });
  const strong = h('input', { type: 'checkbox' });
  const strongLabel = h('span', {});
  const title = input({ placeholder: 'z. B. Trainingspaare Dienstag, Vereinsmeisterschaft Gruppen' });
  const out = h('div');
  let last = null;

  const visible = () => members.filter(m => (!areaSel.value || String(m.area_id) === areaSel.value) && (!teamSel.value || m.team === teamSel.value)
    && (!search.value || `${m.first_name} ${m.last_name}`.toLowerCase().includes(search.value.toLowerCase())));
  const drawList = () => {
    const v = visible();
    clear(listBox, v.length ? [
      h('div', { class: 'pick-head' }, h('span', {}, `${[...chosen].length} ausgewählt`), h('span', { class: 'spacer' }),
        button('Alle sichtbaren', () => { v.forEach(m => chosen.add(m.id)); drawList(); }, { kind: 'mini' }),
        button('Keine', () => { chosen.clear(); drawList(); }, { kind: 'mini' })),
      v.map(m => {
        const cb = h('input', { type: 'checkbox', checked: chosen.has(m.id) });
        cb.addEventListener('change', () => { cb.checked ? chosen.add(m.id) : chosen.delete(m.id); drawList(); });
        return h('label', { class: `pick ${chosen.has(m.id) ? 'on' : ''}` }, cb, h('span', {}, `${m.first_name} ${m.last_name}`), h('small', {}, [m.team, m.birth_year, m.ttr ? `TTR ${m.ttr}` : ''].filter(Boolean).join(' · ')));
      })] : h('p', { class: 'muted small' }, enabled ? 'Keine Mitglieder in dieser Auswahl. Mitgliederliste importieren oder rechts Namen einfügen.' : 'Mitgliederliste ist aus (Schalter „Gelb lokal“). Namen einfach rechts einfügen.'));
  };
  [areaSel, teamSel].forEach(s => s.addEventListener('change', drawList));
  search.addEventListener('input', drawList);
  const syncOpts = () => {
    groups.closest('.field').hidden = mode.value !== 'gruppen';
    strongLabel.textContent = mode.value === 'paare' ? 'Ausgeglichen nach Spielstärke (stark mit schwach)' : mode.value === 'reihenfolge' ? '' : 'Nach Spielstärke setzen (Lostöpfe/Setzliste)';
    strong.closest('label').hidden = mode.value === 'reihenfolge';
  };
  mode.addEventListener('change', syncOpts);

  const participants = () => {
    const fromList = members.filter(m => chosen.has(m.id)).map(m => ({ name: `${m.first_name} ${m.last_name}`.trim(), ttr: m.ttr, team: m.team }));
    const fromText = pasted.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => { const [n, t] = l.split(/[;\t]/); return { name: n.trim(), ttr: Number(String(t || '').replace(/\D/g, '')) || null }; });
    return [...fromList, ...fromText];
  };
  const run = async (save = false, seed = null) => {
    try {
      const p = participants();
      last = await api.post('/api/draws', { mode: mode.value, participants: p, groups: Number(groups.value), seeded: strong.checked, balance: strong.checked, title: title.value, save, seed, area_id: areaSel.value ? Number(areaSel.value) : null });
      renderResult(out, last, { onAgain: () => run(false), onSave: enabled ? () => run(true, last.seed) : null });
      if (save) toast('Auslosung gespeichert');
    } catch (e) { errorToast(e); }
  };

  clear(el, h('div', { class: 'grid-2' },
    h('section', { class: 'card pad' }, h('h3', {}, '1. Wer macht mit?'),
      h('div', { class: 'inline-form' }, areaSel, teamSel), search, listBox,
      h('h4', { class: 'mt' }, '… und/oder Namen einfügen'), pasted,
      !enabled ? h('p', { class: 'hint' }, 'Eingefügte Namen werden nur für die Auslosung benutzt und nicht gespeichert.') : null),
    h('section', { class: 'card pad' }, h('h3', {}, '2. Wie wird gelost?'),
      h('div', { class: 'form-grid' }, field('Art', mode), field('Anzahl Gruppen', groups), h('div', { class: 'span-2' }, field('Titel (optional)', title))),
      h('label', { class: 'check' }, strong, strongLabel),
      h('div', { class: 'btn-row mt' }, button('Auslosen', () => run(false), { kind: 'primary', iconName: 'zap' })),
      h('p', { class: 'hint' }, 'Jede Auslosung hat einen Zufallswert. Mit demselben Wert und denselben Teilnehmenden kommt dasselbe Ergebnis heraus – so ist sie nachprüfbar. Ins Protokoll kommt nur Art, Anzahl und Zufallswert.'),
      out)));
  drawList(); syncOpts();
}

function renderResult(el, d, { onAgain, onSave } = {}) {
  const n = (p) => p ? h('span', { class: 'draw-name' }, p.name, p.ttr ? h('small', {}, ` ${p.ttr}`) : null) : h('span', { class: 'draw-name bye' }, 'Freilos');
  const r = d.result;
  const content = d.mode === 'paare' ? h('ol', { class: 'draw-list' }, r.pairs.map(p => h('li', {}, p.map((x, i) => [i ? h('span', { class: 'vs' }, '/') : null, n(x)]))))
    : d.mode === 'gruppen' ? h('div', { class: 'draw-groups' }, r.groups.map(g => h('div', { class: 'draw-group' }, h('strong', {}, g.name), h('ol', {}, g.members.map(m => h('li', {}, n(m)))))))
    : d.mode === 'ko' ? h('ol', { class: 'draw-list' }, r.matches.map(m => h('li', {}, n(m[0]), h('span', { class: 'vs' }, '–'), n(m[1]))))
    : h('ol', { class: 'draw-list' }, r.order.map(p => h('li', {}, n(p))));
  clear(el, h('div', { class: 'draw-result mt' },
    h('div', { class: 'row' }, h('h3', {}, d.title), h('span', { class: 'spacer' }), h('span', { class: 'badge' }, `${d.count} Teilnehmende · Zufallswert ${d.seed}`)),
    d.mode === 'ko' && r.byes ? h('p', { class: 'small muted' }, `${r.byes} Freilos(e) – ${r.size}er-Feld.`) : null,
    content,
    h('div', { class: 'btn-row' },
      onAgain ? button('Neu auslosen', onAgain, { kind: 'ghost', iconName: 'refresh' }) : null,
      button('Kopieren', () => copyText(`${d.title}\n${d.text}`), { kind: 'ghost', iconName: 'copy' }),
      button('Drucken', () => window.print(), { kind: 'ghost', iconName: 'printer' }),
      onSave && !d.id ? button('Speichern', onSave, { kind: 'primary', iconName: 'check' }) : null)));
}

// ---------- Mitgliederliste ----------

async function liste(el) {
  const d = await api.get('/api/members');
  if (!d.enabled) {
    clear(el, h('section', { class: 'card pad' }, h('h3', {}, 'Mitgliederliste ist aus'),
      h('p', {}, 'Namen, Jahrgang und Spielstärke der Mitglieder sind gelbe Daten. Gespeichert werden sie nur, wenn ihr in den Einstellungen „Gelbe Daten lokal automatisch verarbeiten“ einschaltet – sie verlassen den Server dabei nicht.'),
      h('p', {}, 'Auslosen geht auch ohne Liste: unter „Auslosen“ einfach Namen einfügen.'),
      isAdmin() ? h('a', { href: '#/admin/einstellungen' }, 'Zu den Einstellungen →') : null));
    return;
  }
  const area = select(areaOptions(null), state.me.areas.find(a => a.type === 'verein')?.id);
  const fi = h('input', { type: 'file', accept: '.csv,.txt,text/csv' });
  const text = textarea({ rows: 4, placeholder: 'CSV aus meinVerein/click-TT einfügen – oder je Zeile „Vorname Nachname; Jahrgang; TTR; Mannschaft“' });
  const replace = h('input', { type: 'checkbox' });
  const doImport = async () => {
    try {
      const t = fi.files[0] ? await fi.files[0].text() : text.value;
      if (replace.checked && !(await confirmDialog('Die bisherige Liste dieses Bereichs wird ersetzt. Fortfahren?', { danger: true, ok: 'Ersetzen' }))) return;
      const r = await api.post('/api/members/import', { area_id: Number(area.value), text: t, replace: replace.checked });
      toast(`Importiert: ${r.added} neu, ${r.updated} aktualisiert`);
      liste(el);
    } catch (e) { errorToast(e); }
  };
  const rows = d.members;
  clear(el,
    isAdmin() ? h('section', { class: 'card pad' }, h('h3', {}, 'Importieren'),
      h('div', { class: 'form-grid' }, field('Bereich', area), field('Datei (CSV)', fi), h('div', { class: 'span-2' }, field('… oder einfügen', text))),
      h('label', { class: 'check' }, replace, h('span', {}, 'Bisherige Liste des Bereichs ersetzen (sonst ergänzen und aktualisieren)')),
      h('div', { class: 'btn-row' }, button('Importieren', doImport, { kind: 'primary', iconName: 'upload' })),
      h('p', { class: 'hint' }, 'Übernommen werden nur Name, Jahrgang, Geschlecht, Mannschaft/Gruppe und Spielstärke. Adressen, Bankdaten oder Telefonnummern im Export werden ignoriert.')) : null,
    h('section', { class: 'card mt' }, h('header', { class: 'card-head' }, h('h2', {}, 'Mitglieder', h('span', { class: 'count' }, rows.length))),
      rows.length ? h('div', { class: 'table-scroll' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Jahrgang'), h('th', {}, 'Mannschaft/Gruppe'), h('th', {}, 'TTR'), h('th', {}, 'Bereich'), h('th', {}))),
        h('tbody', {}, rows.map(m => {
          const team = input({ value: m.team, class: 'w-mid' });
          const ttr = input({ type: 'number', value: m.ttr ?? '', class: 'w-small' });
          const save = async () => { try { await api.put(`/api/members/${m.id}`, { team: team.value, ttr: ttr.value }); toast('Gespeichert'); } catch (e) { errorToast(e); } };
          team.addEventListener('change', save); ttr.addEventListener('change', save);
          return h('tr', {}, h('td', {}, `${m.first_name} ${m.last_name}`), h('td', {}, m.birth_year || '–'), h('td', {}, isAdmin() ? team : m.team), h('td', {}, isAdmin() ? ttr : m.ttr ?? '–'), h('td', { class: 'small' }, m.area_name),
            h('td', { class: 'actions' }, isAdmin() ? iconButton('trash', async () => {
              if (!(await confirmDialog(`${m.first_name} ${m.last_name} aus der Liste entfernen?`, { danger: true, ok: 'Entfernen' }))) return;
              try { await api.del(`/api/members/${m.id}`); toast(`${m.first_name} ${m.last_name} entfernt`); liste(el); } catch (e) { errorToast(e); }
            }, 'Entfernen') : null));
        })))) : emptyState('Noch keine Mitglieder. Oben importieren.')));
}

// ---------- Gespeicherte Auslosungen ----------

async function verlauf(el) {
  const list = await api.get('/api/draws');
  const detail = h('div');
  clear(el, h('section', { class: 'card' }, list.length ? h('div', { class: 'task-list' }, list.map(d => h('div', { class: 'jp-game' },
    h('div', {}, h('strong', {}, d.title), h('div', { class: 'small muted' }, `${fmtDateTime(d.created_at)} · ${d.count} Teilnehmende · ${d.created_by_name || ''} · Zufallswert ${d.seed}`)),
    h('div', { class: 'btn-row' },
      button('Ansehen', async () => { try { const x = await api.get(`/api/draws/${d.id}`); renderResult(detail, { ...x, count: x.input.length }); detail.scrollIntoView({ behavior: 'smooth' }); } catch (e) { errorToast(e); } }, { kind: 'mini' }),
      iconButton('trash', async () => {
        if (!(await confirmDialog(`Auslosung „${d.title}“ löschen?`, { danger: true, ok: 'Löschen' }))) return;
        try { await api.del(`/api/draws/${d.id}`); toast('Auslosung gelöscht'); verlauf(el); } catch (e) { errorToast(e); }
      }, 'Löschen'))))) : emptyState('Noch nichts gespeichert. Gespeichert werden Auslosungen nur auf Wunsch (und nur mit Schalter „Gelb lokal“).')), detail);
}
