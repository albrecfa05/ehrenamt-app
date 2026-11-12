// Zentrale Aufgabenübersicht mit Filtern (AUF-1), Sammelbearbeitung (AUF-9) und Ideenspeicher (AUF-8).

import { api, qs } from '../api.js';
import { h, clear, pageHeader, select, input, emptyState, button, debounce, toast, errorToast, modal, field, STATUS, statusPill, areaChip, dueLabel, richText, fmtDate } from '../ui.js';
import { state, areaOptions, userOptions, officeOptions, templateOptions } from '../state.js';
import { taskRow, openTaskForm } from './taskform.js';

export default async function tasks(el, { query = {}, ideas = false }) {
  const f = {
    area: query.area || '', office: query.office || '', owner: query.owner || '', status: query.status || (ideas ? 'aktiv' : 'aktiv'),
    due: query.due || '', q: query.q || '', sort: query.sort || 'faelligkeit', stale: query.stale || '', template: query.template || '',
    group: query.group || '',
  };
  const selected = new Set();
  const listEl = h('div', { class: 'task-list big' });
  const bulkBar = h('div', { class: 'bulk-bar', hidden: true });
  const countEl = h('span', { class: 'muted' });
  let rows = [];

  const syncUrl = () => {
    const base = ideas ? '#/ideen' : '#/aufgaben';
    const clean = Object.fromEntries(Object.entries(f).filter(([k, v]) => v && !(k === 'status' && v === 'aktiv') && !(k === 'sort' && v === 'faelligkeit')));
    history.replaceState(null, '', base + qs(clean));
  };

  const load = async () => {
    syncUrl();
    rows = await api.get('/api/tasks' + qs({ ...f, group: undefined, kind: ideas ? 'idee' : undefined }));
    selected.clear();
    render();
  };

  const render = () => {
    countEl.textContent = `${rows.length} ${ideas ? (rows.length === 1 ? 'Idee' : 'Ideen') : (rows.length === 1 ? 'Aufgabe' : 'Aufgaben')}`;
    updateBulk();
    if (!rows.length) {
      clear(listEl, emptyState(ideas ? 'Der Ideenspeicher ist leer.' : 'Keine Aufgaben für diese Filter.',
        button(ideas ? 'Idee notieren' : 'Neue Aufgabe', () => openTaskForm(ideas ? { kind: 'idee', onCreated: load } : {}), { kind: 'primary', iconName: 'plus' })));
      return;
    }
    const mk = (t) => taskRow(t, { selectable: true, selected: selected.has(t.id), onSelect: (on) => { on ? selected.add(t.id) : selected.delete(t.id); updateBulk(); } });
    if (!f.group) return clear(listEl, rows.map(mk));
    const keyOf = {
      bereich: t => t.area_name, amt: t => t.office_name || 'Ohne Amt', person: t => t.owner_name || 'Ohne Zuständigkeit',
      status: t => STATUS[t.status]?.label, vorlage: t => t.template_name || 'Ohne Vorlage',
    }[f.group];
    const groups = new Map();
    for (const t of rows) { const k = keyOf(t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
    clear(listEl, [...groups].map(([k, list]) => h('div', { class: 'group' }, h('h3', { class: 'group-head' }, k, h('span', { class: 'count' }, list.length)), list.map(mk))));
  };

  const updateBulk = () => {
    bulkBar.hidden = !selected.size;
    if (!selected.size) return;
    const statusSel = select([['', 'Status setzen …'], ['offen', 'Offen'], ['in_arbeit', 'In Arbeit'], ['erledigt', 'Erledigt'], ['verworfen', 'Verworfen']], '');
    const ownerSel = select(userOptions('Zuständig setzen …'), '');
    const apply = async (changes) => {
      try { const r = await api.post('/api/tasks/bulk', { ids: [...selected], changes }); toast(`${r.updated} geändert`); load(); }
      catch (e) { errorToast(e); }
    };
    statusSel.addEventListener('change', () => statusSel.value && apply({ status: statusSel.value }));
    ownerSel.addEventListener('change', () => ownerSel.value && apply({ owner_id: Number(ownerSel.value) }));
    clear(bulkBar, h('strong', {}, `${selected.size} ausgewählt`), statusSel, ownerSel,
      button('Nacheinander abarbeiten', () => batchMode(rows.filter(t => selected.has(t.id)), load), { kind: 'primary', iconName: 'play' }),
      button('Auswahl aufheben', () => { selected.clear(); render(); }, { kind: 'ghost' }));
  };

  // Filterleiste
  const ctl = (name, options) => {
    const s = select(options, f[name], { 'aria-label': name });
    s.addEventListener('change', () => { f[name] = s.value; if (name === 'area') { f.office = ''; refreshOffice(); } load(); });
    return s;
  };
  const officeWrap = h('span');
  const refreshOffice = () => clear(officeWrap, f.area ? ctl('office', officeOptions(f.area, 'Alle Ämter')) : null);
  refreshOffice();
  const search = input({ type: 'search', placeholder: 'Filtern …', value: f.q, 'aria-label': 'Text filtern' });
  search.addEventListener('input', debounce(() => { f.q = search.value; load(); }, 300));

  const filters = h('div', { class: 'filters' },
    search,
    ctl('area', areaOptions()),
    officeWrap,
    ctl('owner', [['', 'Alle Personen'], ['me', 'Ich (inkl. Vertretung)'], ['none', 'Ohne Zuständigkeit'], ...userOptions(null)]),
    ctl('status', [['aktiv', 'Offen + in Arbeit + wartet'], ['offen', 'Offen'], ['in_arbeit', 'In Arbeit'], ['wartet', 'Wartet auf Zulieferung'], ['erledigt', 'Erledigt'], ['verworfen', 'Verworfen'], ['alle', 'Alle']]),
    ideas ? null : ctl('due', [['', 'Jede Fälligkeit'], ['ueberfaellig', 'Überfällig'], ['heute', 'Heute'], ['woche', 'Nächste 7 Tage'], ['monat', 'Nächste 31 Tage'], ['ohne', 'Ohne Fälligkeit']]),
    ideas ? null : ctl('template', templateOptions(null, 'Alle Vorgangstypen')),
    ctl('sort', [['faelligkeit', 'Nach Fälligkeit'], ['bewegung', 'Längste Ruhe zuerst'], ['neu', 'Neueste zuerst'], ['bereich', 'Nach Bereich']]),
    ctl('group', [['', 'Nicht gruppieren'], ['bereich', 'Nach Bereich'], ['amt', 'Nach Amt'], ['person', 'Nach Person'], ['status', 'Nach Status'], ['vorlage', 'Nach Vorgangstyp']]),
    f.stale ? h('button', { class: 'chip active', onclick: () => { f.stale = ''; load(); el.querySelector('.chip')?.remove(); } }, 'nur lange ohne Bewegung ×') : null);

  clear(el,
    pageHeader(ideas ? 'Ideenspeicher' : 'Aufgaben',
      ideas ? 'Ideen ohne Bewegung legt die App regelmäßig zur Entscheidung vor: umsetzen oder verwerfen.' : 'Alle Aufgaben aus Vereinen und Bezirk an einer Stelle.',
      countEl,
      ideas ? button('Idee notieren', () => openTaskForm({ kind: 'idee', onCreated: load }), { kind: 'primary', iconName: 'plus' })
        : button('Neue Aufgabe', () => openTaskForm(), { kind: 'primary', iconName: 'plus' })),
    filters, bulkBar, listEl);
  await load();
}

// ---------- Sammelbearbeitung (AUF-9) ----------

async function batchMode(list, done) {
  let i = 0;
  let changed = 0;
  const next = async () => {
    if (i >= list.length) { toast(`Durchgang beendet: ${changed} von ${list.length} bearbeitet`); done(); return; }
    const t = list[i];
    const full = await api.get(`/api/tasks/${t.id}`);
    const minutes = input({ type: 'number', min: 1, max: 600, placeholder: 'Minuten', class: 'w-small' });
    const who = input({ placeholder: 'Wer schuldet etwas?' });
    const note = input({ placeholder: 'Kommentar (optional)' });
    const body = h('div', { class: 'batch' },
      h('div', { class: 'batch-progress muted' }, `Aufgabe ${i + 1} von ${list.length}`),
      h('h3', {}, t.title),
      h('div', { class: 'task-meta' }, areaChip(t.area_name, t.area_color), statusPill(t.status), t.due_date ? h('span', {}, `fällig ${dueLabel(t.due_date)}`) : null),
      full.task.description ? h('div', { class: 'batch-desc' }, richText(full.task.description.slice(0, 1200))) : null,
      full.steps.length ? h('ul', { class: 'mini-steps' }, full.steps.map(s => h('li', { class: s.done ? 'done' : '' }, s.done ? '✓ ' : '○ ', s.title))) : null,
      h('div', { class: 'form-grid' }, field('Zeitaufwand', minutes), field('Kommentar', note), h('div', { class: 'span-2' }, field('Bei „Wartet“: wer schuldet was?', who))));
    const act = async (changes) => {
      if (note.value.trim()) await api.post(`/api/tasks/${t.id}/comments`, { body: note.value.trim() });
      if (Number(minutes.value) > 0) await api.post(`/api/tasks/${t.id}/time`, { minutes: Number(minutes.value) });
      if (changes) await api.put(`/api/tasks/${t.id}`, changes);
      changed++;
    };
    const r = await modal({ title: 'Sammelbearbeitung', body, wide: true, actions: [
      { label: 'Abbrechen', kind: 'ghost', value: 'stop' },
      { label: 'Überspringen', kind: 'ghost', value: 'skip' },
      { label: 'Wartet', onClick: async () => { if (!who.value.trim()) throw new Error('Bitte angeben, wer etwas schuldet.'); await act({ status: 'wartet', waiting_who: who.value.trim() }); return 'next'; } },
      { label: 'In Arbeit', onClick: async () => { await act({ status: 'in_arbeit' }); return 'next'; } },
      { label: 'Erledigt', kind: 'primary', onClick: async () => { await act({ status: 'erledigt' }); return 'next'; } },
    ] });
    if (r === 'stop' || r === null) { done(); return; }
    i++;
    next();
  };
  next().catch(errorToast);
}

export { fmtDate };
