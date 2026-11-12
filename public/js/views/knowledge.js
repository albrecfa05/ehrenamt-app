// Auskunft (VOR-11, AUT-11, NFA-11) und Pflege der Wissensbasis, Lernprotokoll, Systemlandkarte.

import { api } from '../api.js';
import { h, clear, pageHeader, tabs, button, iconButton, select, input, textarea, field, modal, toast, errorToast, emptyState, fmtDate, fmtDateTime, icon, relTime } from '../ui.js';
import { state, isAdmin, areaOptions, templateOptions } from '../state.js';

const SOURCE = { satzung: 'Satzung', ordnung: 'Ordnung', beschluss: 'Vorstandsbeschluss', formular: 'Formular', website: 'Website', sonstiges: 'Sonstiges' };

export default async function knowledge(el, { tab = 'fragen', query = {} }) {
  const body = h('div');
  clear(el, pageHeader('Auskunft', 'Antworten nur aus hinterlegten Dokumenten – immer mit Fundstelle. Bei Widersprüchen gilt: Satzung, Ordnungen, Vorstandsbeschluss, Formulare, Website.'),
    tabs([['fragen', 'Frage stellen'], ['dokumente', 'Wissensbasis'], ['lernprotokoll', 'Lernprotokoll'], ['systeme', 'Systemlandkarte']], tab, (k) => { location.hash = `#/auskunft/${k}`; }),
    body);
  if (tab === 'dokumente') return documents(body);
  if (tab === 'lernprotokoll') return learnings(body);
  if (tab === 'systeme') return systems(body);
  return ask(body, query);
}

async function ask(el, query) {
  const q = input({ type: 'search', placeholder: 'z. B. Wie lange ist die Einladungsfrist zur Mitgliederversammlung?', class: 'grow ask-input' });
  const area = select(areaOptions('Alle Bereiche'), query.area || '');
  const out = h('div', { class: 'stack' });
  const history = h('div');
  const run = async () => {
    if (q.value.trim().length < 3) return;
    try {
      const r = await api.post('/api/kb/ask', { question: q.value, area_id: area.value ? Number(area.value) : null });
      if (r.empty) return clear(out, h('div', { class: 'card pad warn-box' }, icon('alert', 16), h('div', {}, h('strong', {}, 'Keine Fundstelle gefunden – ungeprüft.'), h('p', {}, 'Die Wissensbasis enthält dazu nichts. Bitte im Original nachsehen und das Dokument ggf. aufnehmen lassen.'))));
      clear(out,
        h('div', { class: `answer-head ${r.verified ? 'ok' : 'unverified'}` }, icon(r.verified ? 'check' : 'alert', 16), r.verified ? 'Treffer mit Fundstelle' : 'Ungeprüft: Der beste Treffer hat keine Fundstelle oder ist als Annahme markiert.'),
        r.note ? h('p', { class: 'hint' }, r.note) : null,
        r.results.map((x, i) => h('article', { class: `card answer ${i === 0 ? 'best' : ''}` },
          h('header', { class: 'answer-meta' }, h('span', { class: 'badge' }, x.source_label), h('strong', {}, x.document), x.reference ? h('span', { class: 'ref' }, x.reference) : h('span', { class: 'badge badge-red' }, 'ohne Fundstelle'),
            x.assumption ? h('span', { class: 'badge badge-gelb' }, 'Annahme') : null, h('span', { class: 'muted small' }, x.area)),
          x.heading ? h('h3', {}, x.heading) : null,
          h('p', { class: 'excerpt' }, x.excerpt),
          h('details', {}, h('summary', { class: 'small' }, 'ganzen Abschnitt zeigen'), h('pre', { class: 'full' }, x.full)),
          x.citation ? h('div', { class: 'citation small' }, icon('book', 12), 'Fundstelle: ', x.citation) : null)));
      loadHistory();
    } catch (e) { errorToast(e); }
  };
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  const loadHistory = async () => {
    const rows = await api.get('/api/kb/questions');
    clear(history, rows.length ? h('details', { class: 'mt' }, h('summary', {}, 'Letzte Fragen'), h('ul', { class: 'mini-list' }, rows.slice(0, 20).map(r => h('li', {},
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); q.value = r.question; run(); } }, r.question), h('small', { class: r.verified ? 'muted' : 'warn-text' }, `${r.verified ? 'mit Fundstelle' : 'ungeprüft'} · ${r.user_name} · ${relTime(r.created_at)}`))))) : null);
  };
  clear(el, h('div', { class: 'ask-bar' }, q, area, button('Fragen', run, { kind: 'primary', iconName: 'search' })), out, history);
  q.focus();
  if (query.q) { q.value = query.q; run(); } else loadHistory();
}

async function documents(el) {
  const docs = await api.get('/api/kb/documents');
  clear(el,
    h('div', { class: 'toolbar' }, h('p', { class: 'muted' }, 'Nur grüne Daten: Satzung, Ordnungen, Beschlüsse, Formulare, öffentliche Informationen. Keine Mitglieder- oder Bankdaten (DAT-2).'),
      isAdmin() ? button('Dokument aufnehmen', () => docEditor(null, () => documents(el)), { kind: 'primary', iconName: 'plus' }) : null),
    docs.length ? h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Dokument'), h('th', {}, 'Art'), h('th', {}, 'Bereich'), h('th', {}, 'Abschnitte'), h('th', {}, 'Stand'), h('th', {}))),
      h('tbody', {}, docs.map(d => h('tr', { class: d.active ? '' : 'inactive' },
        h('td', {}, h('strong', {}, d.title), d.notes ? h('div', { class: 'small muted' }, d.notes) : null),
        h('td', {}, SOURCE[d.source_type]), h('td', {}, d.area_name || 'alle (teilbar)'), h('td', { class: 'num' }, d.sections),
        h('td', {}, `v${d.version}`, h('div', { class: 'small muted' }, d.valid_from ? `gültig ab ${fmtDate(d.valid_from)}` : fmtDate(d.updated_at))),
        h('td', { class: 'actions' }, iconButton('book', () => showDoc(d.id), 'Ansehen'), isAdmin() ? iconButton('edit', async () => docEditor(await api.get(`/api/kb/documents/${d.id}`), () => documents(el)), 'Bearbeiten') : null))))) : emptyState('Noch keine Dokumente.'));
}

async function showDoc(id) {
  const d = await api.get(`/api/kb/documents/${id}`);
  await modal({ title: d.document.title, wide: true, body: h('div', { class: 'doc-view' }, d.sections.map(s => h('section', {},
    h('h4', {}, h('span', { class: 'ref' }, s.reference || 'ohne Fundstelle'), ' ', s.heading, s.assumption ? h('span', { class: 'badge badge-gelb' }, 'Annahme') : null), h('p', { class: 'pre' }, s.body)))) });
}

async function docEditor(d, done) {
  const doc = d?.document || { source_type: 'satzung' };
  const title = input({ value: doc.title || '' });
  const type = select(Object.entries(SOURCE), doc.source_type);
  const area = select(areaOptions('Alle Bereiche (Regelwissen, teilbar)'), doc.area_id || '');
  const valid = input({ type: 'date', value: doc.valid_from || '' });
  const notes = input({ value: doc.notes || '' });
  const text = textarea({ rows: 14, class: 'mono', placeholder: '§ 1 Name und Sitz\nDer Verein führt den Namen …\n\n§ 2 Zweck\n…', value: d ? d.sections.map(s => { const ref = s.reference.replace(/^Lastenheft /, '').replace(/, S\. \d+$/, ''); return `${/^§|^\d/.test(ref) ? ref : '##'} ${s.heading}\n${s.body}`; }).join('\n\n') : '' });
  const note = input({ placeholder: 'Was hat sich geändert?' });
  const preview = h('div', { class: 'small' });
  const doPreview = async () => {
    const secs = await api.post('/api/kb/documents/preview', { text: text.value });
    clear(preview, h('p', { class: 'muted' }, `${secs.length} Abschnitte erkannt:`), h('ol', { class: 'sec-preview' }, secs.slice(0, 40).map(s => h('li', {}, h('span', { class: 'ref' }, s.reference || 'ohne Fundstelle'), ' ', s.heading || s.body.slice(0, 60)))));
  };
  const ok = await modal({ title: d ? `„${doc.title}“ bearbeiten` : 'Dokument in die Wissensbasis aufnehmen', wide: true,
    body: h('div', { class: 'form-grid' }, h('div', { class: 'span-2' }, field('Titel', title)), field('Art der Quelle', type), field('Bereich', area),
      field('Gültig ab', valid), field('Hinweis', notes),
      h('div', { class: 'span-2' }, field('Text', text, 'Überschriften wie „§ 5 Mitgliedschaft“, „## Abschnitt“ oder „5.2 Frist“ werden zu Fundstellen. „Seite 3“ auf eigener Zeile ergänzt die Seitenzahl.')),
      h('div', { class: 'span-2' }, button('Abschnitte prüfen', () => doPreview().catch(errorToast), { kind: 'ghost' }), preview),
      d ? h('div', { class: 'span-2' }, field('Änderungsnotiz (Pflicht)', note)) : null),
    actions: [{ label: 'Abbrechen', kind: 'ghost' }, d ? { label: doc.active ? 'Archivieren' : 'Aktivieren', kind: 'ghost', onClick: () => api.put(`/api/kb/documents/${doc.id}`, { active: !doc.active }) } : null,
      { label: 'Speichern', kind: 'primary', onClick: () => {
        const b = { title: title.value, source_type: type.value, area_id: area.value ? Number(area.value) : null, valid_from: valid.value || null, notes: notes.value, text: text.value, note: note.value };
        return d ? api.put(`/api/kb/documents/${doc.id}`, b) : api.post('/api/kb/documents', b);
      } }].filter(Boolean) });
  if (ok) { toast('Gespeichert'); done(); }
}

async function learnings(el) {
  const rows = await api.get('/api/learnings');
  const add = async () => {
    const topic = input(); const rule = textarea({ rows: 3 }); const origin = input({ placeholder: 'z. B. Vorstandssitzung 10.11.' });
    const tpl = select(templateOptions(null, '— alle Vorgänge im Bereich —'), '');
    const area = select(areaOptions('— alle Bereiche —'), '');
    const ok = await modal({ title: 'Eintrag im Lernprotokoll', body: h('div', { class: 'form-grid' },
      h('div', { class: 'span-2' }, field('Thema', topic)), h('div', { class: 'span-2' }, field('Regel / Korrektur', rule)), field('Herkunft', origin), field('Vorgangstyp', tpl), field('Bereich', area)),
      actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Speichern', kind: 'primary', onClick: () => api.post('/api/learnings', { topic: topic.value, rule: rule.value, origin: origin.value, template_id: tpl.value ? Number(tpl.value) : null, area_id: area.value ? Number(area.value) : null }) }] });
    if (ok) learnings(el);
  };
  clear(el, h('div', { class: 'toolbar' }, h('p', { class: 'muted' }, 'Korrekturen und Entscheidungen (Datum, Thema, Regel, Herkunft). Sie erscheinen beim nächsten Durchlauf des Vorgangs (AUT-15).'),
    button('Eintrag hinzufügen', add, { kind: 'primary', iconName: 'plus' })),
  rows.length ? h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Datum'), h('th', {}, 'Thema'), h('th', {}, 'Regel'), h('th', {}, 'Gilt für'), h('th', {}, 'Herkunft'), isAdmin() ? h('th', {}) : null)),
    h('tbody', {}, rows.map(l => h('tr', { class: l.active ? '' : 'inactive' }, h('td', {}, fmtDate(l.date)), h('td', {}, h('strong', {}, l.topic)), h('td', {}, l.rule),
      h('td', {}, l.template_name || l.area_name || 'alle'), h('td', { class: 'small muted' }, l.origin, l.created_by_name ? ` · ${l.created_by_name}` : ''),
      isAdmin() ? h('td', {}, button(l.active ? 'deaktivieren' : 'aktivieren', async () => { await api.put(`/api/learnings/${l.id}`, { active: !l.active }); learnings(el); }, { kind: 'mini' })) : null)))) : emptyState('Noch keine Einträge.'));
}

async function systems(el) {
  const rows = await api.get('/api/systems');
  const edit = async (s = {}) => {
    const fields = ['name', 'purpose', 'leading_data', 'access', 'export_path', 'account', 'notes'];
    const labels = { name: 'System', purpose: 'Zweck', leading_data: 'Führende Daten', access: 'Zugriff der App', export_path: 'Exportweg', account: 'Konto der App', notes: 'Hinweise' };
    const inputs = Object.fromEntries(fields.map(f => [f, input({ value: s[f] || '' })]));
    const ok = await modal({ title: s.id ? s.name : 'System ergänzen', wide: true, body: h('div', { class: 'form-grid' }, fields.map(f => field(labels[f], inputs[f]))),
      actions: [{ label: 'Abbrechen', kind: 'ghost' }, s.id ? { label: 'Entfernen', kind: 'danger', onClick: () => api.del(`/api/systems/${s.id}`) } : null,
        { label: 'Speichern', kind: 'primary', onClick: () => { const b = Object.fromEntries(fields.map(f => [f, inputs[f].value])); return s.id ? api.put(`/api/systems/${s.id}`, b) : api.post('/api/systems', b); } }].filter(Boolean) });
    if (ok) systems(el);
  };
  clear(el, h('div', { class: 'toolbar' }, h('p', { class: 'muted' }, 'Je System: Zweck, führende Daten, Zugriff und Exportweg (DAT-7). Vereins- und Verbandssysteme werden nur gelesen (DAT-3).'),
    isAdmin() ? button('System ergänzen', () => edit(), { kind: 'primary', iconName: 'plus' }) : null),
  h('div', { class: 'sys-grid' }, rows.map(s => h('article', { class: 'card pad sys-card' },
    h('header', { class: 'card-head-plain' }, h('h3', {}, s.name), isAdmin() ? iconButton('edit', () => edit(s), 'Bearbeiten') : null),
    h('dl', {}, [['Zweck', s.purpose], ['Führende Daten', s.leading_data], ['Zugriff', s.access], ['Exportweg', s.export_path], ['Konto', s.account], ['Hinweise', s.notes]]
      .filter(([, v]) => v).map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))))));
}

export { state, fmtDateTime };
