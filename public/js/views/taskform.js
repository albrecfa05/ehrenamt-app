// Dialog „Neue Aufgabe“ und gemeinsame Darstellung einer Aufgabenzeile.

import { api } from '../api.js';
import { h, modal, field, input, textarea, select, toast, statusPill, areaChip, dueLabel, icon, dataBadge, CHANNELS, LEVELS, formValues } from '../ui.js';
import { state, areaOptions, userOptions, officeOptions, templateOptions } from '../state.js';

export async function openTaskForm(preset = {}) {
  const areas = state.me.areas;
  if (!areas.length) { toast('Dir ist noch kein Bereich zugeordnet.', 'error'); return null; }
  let last = null;
  try { last = Number(localStorage.getItem('lastArea')); } catch { /* privates Fenster */ }
  const areaId = preset.area_id || (areas.some(a => a.id === last) ? last : areas[0].id);
  const areaSel = select(areaOptions(null), areaId, { name: 'area_id', required: true });
  const officeSel = select(officeOptions(areaId), preset.office_id, { name: 'office_id' });
  const tplSel = select(templateOptions(areaId), preset.template_id, { name: 'template_id' });
  const tplInfo = h('div', { class: 'hint' });
  const title = input({ name: 'title', required: true, value: preset.title || '', placeholder: preset.kind === 'idee' ? 'Worum geht es bei der Idee?' : 'Was ist zu tun?' });
  const ownerSel = select(userOptions('— automatisch über das Amt —'), preset.owner_id ?? state.me.user.id, { name: 'owner_id' });
  const deputySel = select(userOptions('— keine —'), preset.deputy_id, { name: 'deputy_id' });
  const due = input({ name: 'due_date', type: 'date', value: preset.due_date || '' });
  const channel = select(Object.entries(CHANNELS).filter(([k]) => !['automatisierung', 'asana', 'jahreskalender'].includes(k)), preset.channel || 'manuell', { name: 'channel' });
  const dataClass = select([['gruen', 'Grün: dauerhaft unkritisch'], ['gelb', 'Gelb: personenbezogen, nur im Vorgang']], preset.data_class || 'gruen', { name: 'data_class' });
  const level = select(LEVELS.map((l, i) => [i, l]), preset.level ?? 0, { name: 'level' });
  const desc = textarea({ name: 'description', rows: 4, value: preset.description || '', placeholder: 'Details, Hintergrund, Links …' });

  const refreshArea = () => {
    const id = areaSel.value;
    officeSel.replaceChildren(...select(officeOptions(id), '').children);
    const prevTpl = tplSel.value;
    tplSel.replaceChildren(...select(templateOptions(id), prevTpl).children);
    updateTpl();
  };
  const updateTpl = () => {
    const t = state.processTemplates.find(x => String(x.id) === tplSel.value);
    tplInfo.replaceChildren();
    if (!t) return;
    tplInfo.append(`${t.steps_count} Teilschritte · Höchststufe ${t.max_level}${t.never_execute ? ' · nie ausführen' : ''} · Daten ${t.data_class === 'gelb' ? 'gelb' : 'grün'}`);
    if (!title.value) title.value = t.name;
    if (t.data_class === 'gelb') dataClass.value = 'gelb';
    level.value = String(Math.min(Number(level.value), t.max_level));
    [...level.options].forEach(o => { o.disabled = Number(o.value) > t.max_level; });
  };
  areaSel.addEventListener('change', refreshArea);
  tplSel.addEventListener('change', updateTpl);

  const form = h('div', { class: 'form-grid' },
    h('div', { class: 'span-2' }, field('Titel', title)),
    field('Bereich', areaSel), field('Amt', officeSel),
    preset.kind === 'idee' ? null : h('div', { class: 'span-2' }, field('Vorgangsvorlage', tplSel, tplInfo)),
    field('Verantwortlich', ownerSel), field('Vertretung', deputySel),
    field('Fällig am', due), field('Eingangskanal', channel),
    field('Datenklasse (Ampel)', dataClass, 'Rote Daten (Gesundheit, Zugangsdaten) nimmt die App nicht an.'),
    preset.kind === 'idee' ? null : field('Automatisierungsstufe', level),
    h('div', { class: 'span-2' }, field('Beschreibung', desc)));
  if (preset.template_id) updateTpl();

  const id = await modal({
    title: preset.kind === 'idee' ? 'Neue Idee' : 'Neue Aufgabe', body: form, wide: true,
    actions: [
      { label: 'Abbrechen', kind: 'ghost', value: null },
      { label: 'Anlegen', kind: 'primary', submit: true, onClick: async () => {
        const v = formValues(form);
        for (const k of ['office_id', 'owner_id', 'deputy_id', 'template_id']) v[k] = v[k] ? Number(v[k]) : null;
        v.area_id = Number(v.area_id); v.level = Number(v.level || 0);
        if (preset.kind) v.kind = preset.kind;
        const r = await api.post('/api/tasks', v);
        try { localStorage.setItem('lastArea', v.area_id); } catch { /* egal */ }
        return r.id;
      } },
    ],
  });
  if (id) {
    toast(preset.kind === 'idee' ? 'Idee gespeichert' : 'Aufgabe angelegt');
    if (preset.onCreated) preset.onCreated(id);
    else location.hash = `#/aufgabe/${id}`;
  }
  return id;
}

/** Eine Zeile in Aufgabenlisten. */
export function taskRow(t, { selectable = false, selected, onSelect, compact = false } = {}) {
  const cls = ['task-row', t.overdue ? 'is-overdue' : '', t.stale && !t.overdue ? 'is-stale' : '', ['erledigt', 'verworfen'].includes(t.status) ? 'is-done' : ''];
  const meta = h('div', { class: 'task-meta' },
    areaChip(t.area_name, t.area_color),
    t.office_name ? h('span', {}, t.office_name) : null,
    t.owner_name ? h('span', { class: 'who' }, icon('user', 13), t.owner_name) : h('span', { class: 'warn-text' }, 'niemand zuständig'),
    t.status === 'wartet' && t.waiting_who ? h('span', { class: 'wait' }, `wartet auf ${t.waiting_who}`) : null,
    t.steps_total ? h('span', { class: 'steps-mini', title: 'Teilschritte' }, progress(t.steps_done, t.steps_total), `${t.steps_done}/${t.steps_total}`) : null,
    t.comments_count ? h('span', { title: 'Kommentare' }, `💬 ${t.comments_count}`) : null,
    t.files_count ? h('span', { title: 'Anhänge' }, icon('paperclip', 13), t.files_count) : null,
    t.data_class === 'gelb' && !compact ? dataBadge('gelb') : null,
  );
  const due = t.due_date ? h('span', { class: `due ${t.overdue ? 'due-over' : t.due_today ? 'due-today' : ''}`, title: t.due_date }, icon('clock', 13), dueLabel(t.due_date)) : null;
  const flags = h('div', { class: 'task-flags' },
    t.stale && !['erledigt', 'verworfen'].includes(t.status) ? h('span', { class: 'flag flag-stale', title: 'Ohne Bewegung' }, `${t.idle_days} T. still`) : null,
    statusPill(t.status, true), due);
  const row = h('div', { class: cls },
    selectable ? h('input', { type: 'checkbox', class: 'row-check', checked: selected, 'aria-label': 'Auswählen', onclick: (e) => { e.stopPropagation(); onSelect?.(e.target.checked); } }) : null,
    h('a', { class: 'task-main', href: `#/aufgabe/${t.id}` }, h('div', { class: 'task-title' }, t.priority ? h('span', { class: 'prio', title: 'Wichtig' }, '!') : null, t.title), compact ? null : meta),
    flags);
  return row;
}

export function progress(done, total) {
  const bar = h('span', { class: 'progress' }, h('span', {}));
  bar.firstChild.style.width = `${total ? Math.round(done / total * 100) : 0}%`;
  return bar;
}
