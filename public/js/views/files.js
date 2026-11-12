// Zentrale Ablage mit Suche (ABL-1, ABL-2, DAT-1).

import { api, qs } from '../api.js';
import { h, clear, pageHeader, button, iconButton, select, input, field, modal, toast, errorToast, confirmDialog, emptyState, debounce, fmtDate, fmtBytes, areaChip, dataBadge } from '../ui.js';
import { state, isAdmin, areaOptions, autoOn, refreshMe } from '../state.js';
import { icon } from '../ui.js';
import { uploadDialog } from './shared.js';

export default async function files(el, { query = {} }) {
  const f = { q: query.q || '', area: query.area || '', data_class: '', year: '' };
  const list = h('div');
  const load = async () => {
    const rows = await api.get('/api/files' + qs(f));
    if (!rows.length) return clear(list, emptyState(f.q ? 'Nichts gefunden.' : 'Die Ablage ist noch leer.', button('Datei ablegen', upload, { kind: 'primary', iconName: 'upload' })));
    clear(list, h('table', { class: 'table files-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Datei'), h('th', {}, 'Bereich'), h('th', {}, 'Datum'), h('th', {}, 'Aufgabe'), h('th', {}, 'Ampel'), h('th', {}, 'Größe'), h('th', {}))),
      h('tbody', {}, rows.map(r => h('tr', {},
        h('td', {}, h('a', { href: `/api/files/${r.id}/download${/^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)/.test(r.mime) ? '?inline=1' : ''}`, target: '_blank', rel: 'noopener' }, r.filename),
          r.remote_url ? h('div', { class: 'small' }, h('a', { href: r.remote_url.startsWith('http') ? r.remote_url : '#', target: '_blank', rel: 'noopener' }, icon('cloud', 12), ' in der Vereinsablage')) : null,
          r.snippet ? h('div', { class: 'small muted' }, r.snippet) : null, r.tags ? h('div', { class: 'small muted' }, r.tags) : null),
        h('td', {}, areaChip(r.area_name, r.area_color)),
        h('td', {}, fmtDate(r.doc_date)),
        h('td', {}, r.task_id ? h('a', { href: `#/aufgabe/${r.task_id}` }, r.task_title) : h('span', { class: 'muted' }, '—')),
        h('td', {}, dataBadge(r.data_class)),
        h('td', { class: 'num' }, fmtBytes(r.size)),
        h('td', { class: 'actions' }, !r.remote_url && autoOn('ablage_spiegeln') ? iconButton('cloud', async () => {
            try { await api.post(`/api/files/${r.id}/mirror`); toast('Kopie in die Vereinsablage zur Freigabe vorgeschlagen'); refreshMe().catch(() => {}); } catch (e) { errorToast(e); }
          }, 'Nach SharePoint/OneDrive kopieren (nach Freigabe)') : null,
          iconButton('edit', () => editFile(r, load), 'Angaben ändern'),
          (isAdmin() || r.uploaded_by_name === state.me.user.name) ? iconButton('trash', async () => {
            if (!(await confirmDialog(`„${r.filename}“ löschen? Die Datei wird aus dem Speicher entfernt; der Protokolleintrag bleibt.`, { danger: true, ok: 'Löschen' }))) return;
            try { await api.del(`/api/files/${r.id}`); toast('Gelöscht'); load(); } catch (e) { errorToast(e); }
          }, 'Löschen') : null))))));
  };
  const upload = async () => { if (await uploadDialog({ areaId: f.area ? Number(f.area) : undefined })) load(); };
  const search = input({ type: 'search', placeholder: 'Name, Aussteller, Anlass oder Inhalt …', value: f.q, class: 'grow' });
  search.addEventListener('input', debounce(() => { f.q = search.value; load(); }, 300));
  const areaSel = select(areaOptions(), f.area); areaSel.addEventListener('change', () => { f.area = areaSel.value; load(); });
  const cls = select([['', 'Jede Ampel'], ['gruen', 'Grün'], ['gelb', 'Gelb']], ''); cls.addEventListener('change', () => { f.data_class = cls.value; load(); });
  const y = new Date().getFullYear();
  const year = select([['', 'Jedes Jahr'], ...[0, 1, 2, 3, 4].map(i => [y - i, y - i])], ''); year.addEventListener('change', () => { f.year = year.value; load(); });
  clear(el, pageHeader('Ablage', 'Eine gemeinsame Ablage statt privater Konten. Einheitliche Namen: JJJJ-MM-TT - Aussteller - Anlass.',
    button('Datei ablegen', upload, { kind: 'primary', iconName: 'upload' })),
  h('div', { class: 'filters' }, search, areaSel, cls, year), list);
  await load();
}

async function editFile(r, done) {
  const date = input({ type: 'date', value: r.doc_date || '' });
  const issuer = input({ value: r.issuer });
  const occasion = input({ value: r.occasion });
  const tags = input({ value: r.tags, placeholder: 'Schlagwörter' });
  const cls = select([['gruen', 'Grün'], ['gelb', 'Gelb']], r.data_class);
  const rename = h('input', { type: 'checkbox', checked: true });
  const ok = await modal({ title: 'Angaben zur Datei', body: h('div', { class: 'form-grid' },
    field('Datum', date), field('Datenklasse', cls), field('Aussteller', issuer), field('Anlass', occasion), h('div', { class: 'span-2' }, field('Schlagwörter', tags)),
    h('label', { class: 'check span-2' }, rename, h('span', {}, 'Dateinamen nach dem Schema neu bilden'))),
    actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Speichern', kind: 'primary', onClick: () => api.put(`/api/files/${r.id}`, { doc_date: date.value, issuer: issuer.value, occasion: occasion.value, tags: tags.value, data_class: cls.value, rename: rename.checked }) }] });
  if (ok) { toast('Gespeichert'); done(); }
}
