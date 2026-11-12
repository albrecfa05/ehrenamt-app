// Sponsorenregister (VOR-6): Partner, Paten, Laufzeiten, Kontaktpflege. Nur Firmen und Namen, keine Kontaktdaten.

import { api } from '../api.js';
import { h, clear, pageHeader, button, iconButton, select, input, textarea, field, modal, toast, errorToast, emptyState, fmtDate, areaChip, today } from '../ui.js';
import { state, isAdmin, areaOptions, userOptions, autoOn } from '../state.js';

const STATUS = { aktiv: ['aktiv', 'st-erledigt'], verhandlung: ['in Verhandlung', 'st-wartet'], beendet: ['beendet', 'st-verworfen'] };

export default async function sponsors(el) {
  const rows = await api.get('/api/sponsors');
  const active = rows.filter(s => s.status !== 'beendet');
  const soon = active.filter(s => s.days_left != null && s.days_left <= 90);
  const runtime = (s) => {
    if (!s.end_date) return h('span', { class: 'muted' }, 'unbefristet');
    const cls = s.days_left < 0 ? 'warn-text' : s.days_left <= 90 ? 'due-today' : '';
    return h('span', { class: cls }, `bis ${fmtDate(s.end_date)}`, h('div', { class: 'small muted' }, s.days_left < 0 ? `seit ${-s.days_left} Tagen abgelaufen` : `noch ${s.days_left} Tage`));
  };
  clear(el,
    pageHeader('Sponsoren', 'Partner, Paten und Laufzeiten an einer Stelle. Vor dem Laufzeitende legt die App eine Verlängerungsaufgabe an.',
      button('Sponsor erfassen', () => edit({}, () => sponsors(el)), { kind: 'primary', iconName: 'plus' })),
    h('div', { class: 'stats heroes' },
      h('div', { class: 'stat' }, h('strong', {}, active.length), h('span', {}, 'aktive Partner')),
      h('div', { class: `stat ${soon.length ? 'tone-amber' : 'zero'}` }, h('strong', {}, soon.length), h('span', {}, 'laufen in 90 Tagen aus')),
      h('div', { class: `stat ${active.filter(s => !s.godparent_id).length ? 'tone-red' : 'zero'}` }, h('strong', {}, active.filter(s => !s.godparent_id).length), h('span', {}, 'ohne Pate')),
      h('div', { class: 'stat' }, h('strong', {}, autoOn('sponsor_laufzeit') ? 'an' : 'aus'), h('span', {}, 'automatische Verlängerungsaufgabe'))),
    rows.length ? h('table', { class: 'table files-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Partner'), h('th', {}, 'Bereich'), h('th', {}, 'Pate'), h('th', {}, 'Laufzeit'), h('th', {}, 'Letzter Kontakt'), h('th', {}, 'Status'), h('th', {}))),
      h('tbody', {}, rows.map(s => h('tr', { class: s.status === 'beendet' ? 'inactive' : '' },
        h('td', {}, h('strong', {}, s.company), s.category ? h('div', { class: 'small muted' }, s.category) : null, s.contact_name ? h('div', { class: 'small muted' }, `Ansprechpartner: ${s.contact_name}`) : null,
          s.open_task ? h('div', { class: 'small' }, h('a', { href: `#/aufgabe/${s.open_task.id}` }, '→ offene Aufgabe')) : null),
        h('td', {}, areaChip(s.area_name, s.area_color)),
        h('td', {}, s.godparent_name || h('span', { class: 'warn-text' }, 'kein Pate')),
        h('td', {}, runtime(s)),
        h('td', {}, s.last_contact ? fmtDate(s.last_contact) : h('span', { class: 'muted' }, '—')),
        h('td', {}, h('span', { class: `pill ${STATUS[s.status][1]}` }, STATUS[s.status][0])),
        h('td', { class: 'actions' }, button('Kontakt', () => contact(s, () => sponsors(el)), { kind: 'mini', title: 'Kontakt erfassen' }), iconButton('edit', () => edit(s, () => sponsors(el)), 'Bearbeiten')))))) :
      emptyState('Noch keine Sponsoren erfasst.'));
}

async function edit(s, done) {
  const area = select(areaOptions(null), s.area_id || state.me.areas.find(a => a.type === 'verein')?.id);
  const company = input({ value: s.company || '' });
  const contactName = input({ value: s.contact_name || '', placeholder: 'nur Name, keine Telefonnummer/Mail' });
  const god = select(userOptions('— noch kein Pate —'), s.godparent_id);
  const cat = input({ value: s.category || '', placeholder: 'z. B. Bande, Trikot, Jugend, Förderer', list: 'sp-cats' });
  const start = input({ type: 'date', value: s.start_date || '' });
  const end = input({ type: 'date', value: s.end_date || '' });
  const status = select(Object.entries(STATUS).map(([k, v]) => [k, v[0]]), s.status || 'aktiv');
  const notes = textarea({ rows: 4, value: s.notes || '' });
  const actions = [{ label: 'Abbrechen', kind: 'ghost' }];
  if (s.id && isAdmin()) actions.push({ label: 'Löschen', kind: 'danger', onClick: () => api.del(`/api/sponsors/${s.id}`) });
  actions.push({ label: 'Speichern', kind: 'primary', onClick: () => {
    const b = { area_id: Number(area.value), company: company.value, contact_name: contactName.value, godparent_id: god.value ? Number(god.value) : null, category: cat.value,
      start_date: start.value || null, end_date: end.value || null, status: status.value, notes: notes.value };
    return s.id ? api.put(`/api/sponsors/${s.id}`, b) : api.post('/api/sponsors', b);
  } });
  const ok = await modal({ title: s.id ? s.company : 'Sponsor erfassen', wide: true, body: h('div', { class: 'form-grid' },
    h('datalist', { id: 'sp-cats' }, ['Bande', 'Trikot', 'Jugend', 'Förderer', 'Veranstaltung'].map(c => h('option', { value: c }))),
    field('Firma / Partner', company), field('Bereich', area), field('Ansprechpartner (Name)', contactName), field('Pate im Verein', god, 'Fast jede Aufgabe hängt an einer Person – der Pate hält den Kontakt.'),
    field('Art', cat), field('Status', status), field('Beginn', start), field('Laufzeitende', end, 'Vor diesem Datum legt die App eine Verlängerungsaufgabe an (Automatisierungen).'),
    h('div', { class: 'span-2' }, field('Notizen (Vereinbarungen, Gegenleistungen)', notes))), actions });
  if (ok) { toast('Gespeichert'); done(); }
}

async function contact(s, done) {
  const date = input({ type: 'date', value: today() });
  const note = textarea({ rows: 3, placeholder: 'z. B. Weihnachtsgruß überbracht, Interesse an Trikotwerbung' });
  const ok = await modal({ title: `Kontakt mit ${s.company}`, body: h('div', {}, field('Datum', date), field('Notiz', note)),
    actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Speichern', kind: 'primary', onClick: () => api.post(`/api/sponsors/${s.id}/contact`, { date: date.value, note: note.value }) }] });
  if (ok) { toast('Kontakt erfasst'); done(); }
}

export { errorToast };
