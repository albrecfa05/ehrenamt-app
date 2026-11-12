// Textvorlagen mit Variablen (ABL-3, ABL-4, ABL-5). Nur Admins ändern Vorlagen (ROL-2).

import { api } from '../api.js';
import { h, clear, pageHeader, button, select, input, textarea, field, modal, toast, fmtDateTime, icon, debounce } from '../ui.js';
import { isAdmin, areaOptions } from '../state.js';

const KIND = { mail: 'Mail', dokument: 'Dokument', text: 'Text' };

export default async function texts(el, { id }) {
  const list = await api.get('/api/text-templates?all=1');
  let current = id ? Number(id) : list.find(t => t.active)?.id;
  const side = h('nav', { class: 'list-nav' });
  const main = h('div', { class: 'list-main' });
  const cats = [...new Set(list.map(t => t.category))];
  const drawNav = () => clear(side, cats.map(c => h('div', { class: 'list-group' }, h('div', { class: 'nav-title' }, c),
    list.filter(t => t.category === c).map(t => h('a', { href: `#/texte/${t.id}`, class: `list-link ${t.id === current ? 'active' : ''} ${t.active ? '' : 'inactive'}` }, t.name, h('small', {}, KIND[t.kind]))))));
  const show = async () => {
    drawNav();
    if (!current) return clear(main, h('p', { class: 'muted' }, 'Keine Vorlage gewählt.'));
    const d = await api.get(`/api/text-templates/${current}`);
    const t = d.template;
    clear(main, h('section', { class: 'card' },
      h('header', { class: 'card-head' }, h('div', {}, h('h2', {}, t.name), h('div', { class: 'small muted' }, `${KIND[t.kind]} · ${t.category} · v${t.version} · ${t.area_id ? 'nur ' + (t.area_name || 'ein Bereich') : 'für alle Bereiche teilbar'}`)),
        isAdmin() ? h('div', { class: 'btn-row' }, button('Bearbeiten', () => edit(t), { iconName: 'edit' }),
          button(t.active ? 'Archivieren' : 'Aktivieren', async () => { await api.put(`/api/text-templates/${t.id}`, { active: !t.active }); location.reload(); }, { kind: 'ghost' })) : null),
      h('div', { class: 'pad' },
        t.subject ? h('div', { class: 'preview-subject' }, t.subject) : null,
        h('pre', { class: 'preview-body template' }, highlight(t.body)),
        h('div', { class: 'vars' }, h('strong', {}, 'Variablen: '), t.variables.map(v => h('code', { class: v.builtin ? 'builtin' : '' }, v.name, v.default ? `|${v.default}` : ''))),
        t.notes ? h('p', { class: 'hint' }, t.notes) : null,
        h('p', { class: 'small muted' }, 'Eingebaut: heute, jahr, bereich, verein, absender, aufgabe, frist. Adressen, Telefonnummern und Bankdaten sind als Variablen gesperrt (AUT-9).'))),
      d.versions.length ? h('section', { class: 'card' }, h('header', { class: 'card-head' }, h('h2', {}, 'Frühere Versionen')),
        h('ul', { class: 'mini-list pad' }, d.versions.map(v => h('li', {}, h('span', {}, `v${v.version}`), h('span', { class: 'muted small' }, `${fmtDateTime(v.created_at)} · ${v.created_by_name || ''} · ${v.note}`))))) : null);
  };
  const edit = async (t = {}) => {
    const name = input({ value: t.name || '' });
    const category = input({ value: t.category || 'Allgemein', list: 'cats' });
    const kind = select(Object.entries(KIND), t.kind || 'mail');
    const area = select(areaOptions('Alle Bereiche (teilbar)'), t.area_id || '');
    const subject = input({ value: t.subject || '' });
    const body = textarea({ rows: 14, value: t.body || '', class: 'mono' });
    const notes = textarea({ rows: 2, value: t.notes || '' });
    const note = input({ placeholder: 'Was wurde geändert?' });
    const varsOut = h('div', { class: 'vars small' });
    const showVars = debounce(() => {
      const names = [...new Set([...(subject.value + body.value).matchAll(/\{\{\s*([\wÄÖÜäöüß]+)/g)].map(m => m[1]))];
      clear(varsOut, 'Erkannte Variablen: ', names.length ? names.map(n => h('code', {}, n)) : '—');
    }, 200);
    subject.addEventListener('input', showVars); body.addEventListener('input', showVars); showVars();
    const ok = await modal({ title: t.id ? `„${t.name}“ bearbeiten` : 'Neue Textvorlage', wide: true,
      body: h('div', { class: 'form-grid' }, h('datalist', { id: 'cats' }, cats.map(c => h('option', { value: c }))),
        h('div', { class: 'span-2' }, field('Name', name)), field('Kategorie', category), field('Art', kind), h('div', { class: 'span-2' }, field('Bereich', area, 'Vorlagen dürfen zwischen Vereinen geteilt werden (DAT-8).')),
        h('div', { class: 'span-2' }, field('Betreff', subject)),
        h('div', { class: 'span-2' }, field('Text', body, 'Variablen als {{name}} oder mit Standardwert {{name|Wert}}.'), varsOut),
        h('div', { class: 'span-2' }, field('Hinweise für die Bearbeitung', notes)),
        t.id ? h('div', { class: 'span-2' }, field('Änderungsnotiz (Pflicht)', note)) : null),
      actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Speichern', kind: 'primary', onClick: async () => {
        const b = { name: name.value, category: category.value, kind: kind.value, area_id: area.value ? Number(area.value) : null, subject: subject.value, body: body.value, notes: notes.value, note: note.value };
        if (t.id) { await api.put(`/api/text-templates/${t.id}`, b); return t.id; }
        return (await api.post('/api/text-templates', b)).id;
      } }] });
    if (ok) { toast('Gespeichert'); location.hash = `#/texte/${ok}`; texts(el, { id: ok }); }
  };
  clear(el, pageHeader('Textvorlagen', 'Texte, die immer gleich sind – mit Variablen. Je Vorlage gilt genau eine Version.',
    isAdmin() ? button('Neue Vorlage', () => edit(), { kind: 'primary', iconName: 'plus' }) : null),
  h('div', { class: 'split' }, side, main));
  await show();
}

function highlight(text) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(/\{\{[^}]+\}\}/g)) {
    frag.append(text.slice(last, m.index), h('mark', { class: 'var' }, m[0]));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

export { icon };
