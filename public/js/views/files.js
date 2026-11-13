// Zentrale Ablage mit Themen-Ordnern und Suche (ABL-1, ABL-2, DAT-1).

import { api, qs } from '../api.js';
import { h, clear, pageHeader, button, iconButton, select, input, field, modal, toast, errorToast, confirmDialog, emptyState, debounce, fmtDate, fmtBytes, areaChip, dataBadge, icon } from '../ui.js';
import { state, isAdmin, areaOptions, autoOn, refreshMe } from '../state.js';
import { uploadDialog } from './shared.js';
import { folderInput, forgetFolders } from './folders.js';

export default async function files(el, { query = {} }) {
  const f = { q: query.q || '', area: query.area || '', data_class: '', year: '', folder: query.folder || '' };
  const list = h('div');
  const tree = h('nav', { class: 'list-nav folder-nav', 'aria-label': 'Ordner' });
  const selected = new Set();
  const bulk = h('div', { class: 'bulk-bar', hidden: true });

  const loadTree = async () => {
    const d = await api.get('/api/files/folders' + qs({ area: f.area }));
    const link = (folder, label, n, depth = 0) => h('a', { href: '#', class: `list-link folder-link ${f.folder === folder ? 'active' : ''}`, onclick: (e) => { e.preventDefault(); f.folder = folder; loadTree(); load(); } },
      (() => { const s = h('span', { class: 'folder-label' }, icon(folder === '' ? 'layers' : 'folder', 14), label); s.style.paddingLeft = `${depth * 14}px`; return s; })(),
      h('small', {}, n));
    clear(tree,
      link('', 'Alle Dateien', d.folders.filter(x => x.depth === 0).reduce((a, b) => a + b.n, 0) + d.none),
      d.none ? link('-', 'Ohne Ordner', d.none) : null,
      h('div', { class: 'nav-title' }, 'Ordner'),
      d.folders.length ? d.folders.map(x => link(x.folder, x.folder.split('/').pop(), x.n, x.depth)) : h('p', { class: 'small muted pad-x' }, 'Noch keine Ordner. Beim Ablegen oder per Ablageregel anlegen.'));
  };

  const updBulk = async () => {
    bulk.hidden = !selected.size;
    if (!selected.size) return;
    const fo = await folderInput('', { class: 'w-folder' });
    clear(bulk, h('strong', {}, `${selected.size} ausgewählt`), h('span', {}, 'verschieben nach'), fo.el,
      button('Verschieben', async () => {
        try { const r = await api.post('/api/files/move', { ids: [...selected], folder: fo.input.value }); toast(`${r.moved} Datei(en) verschoben`); selected.clear(); forgetFolders(); loadTree(); load(); }
        catch (e) { errorToast(e); }
      }, { kind: 'primary' }),
      button('Auswahl aufheben', () => { selected.clear(); load(); }, { kind: 'ghost' }));
  };

  const load = async () => {
    const rows = await api.get('/api/files' + qs(f));
    selected.clear(); updBulk();
    if (!rows.length) return clear(list, emptyState(f.q ? 'Nichts gefunden.' : f.folder ? 'Dieser Ordner ist leer.' : 'Die Ablage ist noch leer.', button('Datei ablegen', upload, { kind: 'primary', iconName: 'upload' })));
    const canEdit = (r) => isAdmin() || r.uploaded_by === state.me.user.id;
    clear(list, h('table', { class: 'table files-table' },
      h('thead', {}, h('tr', {}, h('th', {}), h('th', {}, 'Datei'), h('th', {}, 'Ordner'), h('th', {}, 'Bereich'), h('th', {}, 'Datum'), h('th', {}, 'Aufgabe'), h('th', {}, 'Ampel'), h('th', {}, 'Größe'), h('th', {}))),
      h('tbody', {}, rows.map(r => h('tr', {},
        h('td', {}, canEdit(r) ? h('input', { type: 'checkbox', 'aria-label': 'Auswählen', onchange: (e) => { e.target.checked ? selected.add(r.id) : selected.delete(r.id); updBulk(); } }) : null),
        h('td', {}, h('a', { href: `/api/files/${r.id}/download${/^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)/.test(r.mime) ? '?inline=1' : ''}`, target: '_blank', rel: 'noopener' }, r.filename),
          r.remote_url ? h('div', { class: 'small' }, h('a', { href: r.remote_url.startsWith('http') ? r.remote_url : '#', target: '_blank', rel: 'noopener' }, icon('cloud', 12), ' in der Vereinsablage')) : null,
          r.snippet ? h('div', { class: 'small muted' }, r.snippet) : null, r.tags ? h('div', { class: 'small muted' }, r.tags) : null),
        h('td', { class: 'small' }, r.folder ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); f.folder = r.folder; loadTree(); load(); } }, r.folder) : h('span', { class: 'muted' }, '—')),
        h('td', {}, areaChip(r.area_name, r.area_color)),
        h('td', {}, fmtDate(r.doc_date)),
        h('td', {}, r.task_id ? h('a', { href: `#/aufgabe/${r.task_id}` }, r.task_title) : h('span', { class: 'muted' }, '—')),
        h('td', {}, dataBadge(r.data_class)),
        h('td', { class: 'num' }, fmtBytes(r.size)),
        h('td', { class: 'actions' }, !r.remote_url && autoOn('ablage_spiegeln') ? iconButton('cloud', async () => {
            try { await api.post(`/api/files/${r.id}/mirror`); toast('Kopie in die Vereinsablage zur Freigabe vorgeschlagen'); refreshMe().catch(() => {}); } catch (e) { errorToast(e); }
          }, 'Nach SharePoint/OneDrive kopieren (nach Freigabe)') : null,
          canEdit(r) ? iconButton('edit', () => editFile(r, () => { forgetFolders(); loadTree(); load(); }), 'Angaben ändern') : null,
          canEdit(r) ? iconButton('trash', async () => {
            if (!(await confirmDialog(`„${r.filename}“ löschen? Die Datei wird aus dem Speicher entfernt; der Protokolleintrag bleibt.`, { danger: true, ok: 'Löschen' }))) return;
            try { await api.del(`/api/files/${r.id}`); toast('Gelöscht'); loadTree(); load(); } catch (e) { errorToast(e); }
          }, 'Löschen') : null))))));
  };
  const upload = async () => {
    if (await uploadDialog({ areaId: f.area ? Number(f.area) : undefined, folder: f.folder && f.folder !== '-' ? f.folder : '' })) { forgetFolders(); loadTree(); load(); }
  };
  const search = input({ type: 'search', placeholder: 'Name, Ordner, Aussteller, Anlass oder Inhalt …', value: f.q, class: 'grow' });
  search.addEventListener('input', debounce(() => { f.q = search.value; load(); }, 300));
  const areaSel = select(areaOptions(), f.area); areaSel.addEventListener('change', () => { f.area = areaSel.value; loadTree(); load(); });
  const cls = select([['', 'Jede Ampel'], ['gruen', 'Grün'], ['gelb', 'Gelb']], ''); cls.addEventListener('change', () => { f.data_class = cls.value; load(); });
  const y = new Date().getFullYear();
  const year = select([['', 'Jedes Jahr'], ...[0, 1, 2, 3, 4].map(i => [y - i, y - i])], ''); year.addEventListener('change', () => { f.year = year.value; load(); });
  clear(el, pageHeader('Ablage', 'Eine gemeinsame Ablage statt privater Konten. Ordner nach Themen, einheitliche Namen: JJJJ-MM-TT - Aussteller - Anlass.',
    isAdmin() ? button('Ablageregeln', () => { location.hash = '#/eingang?tab=regeln'; }, { kind: 'ghost', iconName: 'flow' }) : null,
    button('Datei ablegen', upload, { kind: 'primary', iconName: 'upload' })),
  h('div', { class: 'filters' }, search, areaSel, cls, year),
  h('div', { class: 'split' }, tree, h('div', { class: 'list-main' }, bulk, list)));
  await Promise.all([loadTree(), load()]);
}

async function editFile(r, done) {
  const date = input({ type: 'date', value: r.doc_date || '' });
  const issuer = input({ value: r.issuer });
  const occasion = input({ value: r.occasion });
  const tags = input({ value: r.tags, placeholder: 'Schlagwörter' });
  const cls = select([['gruen', 'Grün'], ['gelb', 'Gelb']], r.data_class);
  const fo = await folderInput(r.folder || '');
  const rename = h('input', { type: 'checkbox', checked: true });
  const ok = await modal({ title: 'Angaben zur Datei', body: h('div', { class: 'form-grid' },
    h('div', { class: 'span-2' }, field('Ordner', fo.el, 'Unterordner mit „/“, z. B. Sponsoring/Verträge')),
    field('Datum', date), field('Datenklasse', cls), field('Aussteller', issuer), field('Anlass', occasion), h('div', { class: 'span-2' }, field('Schlagwörter', tags)),
    h('label', { class: 'check span-2' }, rename, h('span', {}, 'Dateinamen nach dem Schema neu bilden'))),
    actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Speichern', kind: 'primary', onClick: () => api.put(`/api/files/${r.id}`, { doc_date: date.value, issuer: issuer.value, occasion: occasion.value, tags: tags.value, data_class: cls.value, folder: fo.input.value, rename: rename.checked }) }] });
  if (ok) { toast('Gespeichert'); done(); }
}
