// Vorgangsvorlagen: Standardprozesse mit Teilschritten, Anleitung, Höchststufe (AUF-3, AUF-14, AUT-1, Kap. 5).
// Neue Vorgangstypen legen Admins selbst an (7.8). Jede Änderung erzeugt eine neue Version (ABL-4).

import { api } from '../api.js';
import { h, clear, pageHeader, button, iconButton, select, input, textarea, field, modal, toast, errorToast, richText, levelBadge, dataBadge, fmtDateTime, fmtDate, LEVELS, LEVEL_HINT, icon } from '../ui.js';
import { isAdmin, refreshLookups } from '../state.js';
import { openTaskForm } from './taskform.js';

const SCOPE = { verein: 'Verein', bezirk: 'Bezirk', beide: 'Verein und Bezirk' };

export default async function processes(el, { id }) {
  if (id) return detail(el, Number(id));
  const list = await api.get('/api/process-templates?all=1');
  const card = (p) => h('a', { class: `card tpl-card ${p.active ? '' : 'inactive'}`, href: `#/vorgaenge/${p.id}` },
    h('div', { class: 'tpl-key' }, p.key || 'eigener Typ'),
    h('h3', {}, p.name),
    h('p', { class: 'muted small' }, p.summary),
    h('div', { class: 'tpl-meta' }, h('span', { class: 'badge' }, SCOPE[p.scope]), levelBadge(p.max_level), p.never_execute ? h('span', { class: 'badge badge-red' }, 'nie ausführen') : null, dataBadge(p.data_class),
      p.minors ? h('span', { class: 'badge badge-gelb' }, 'Minderjährige') : null),
    h('div', { class: 'tpl-foot small muted' }, `${p.steps_count} Schritte · ${p.open_tasks} offen · ${p.done_tasks} erledigt · v${p.version}`));
  clear(el,
    pageHeader('Vorgangsvorlagen', 'Jeder Standardprozess als Kette fester Teilschritte – mit Anleitung, damit eine zweite Person ihn allein durchführen kann.',
      isAdmin() ? button('Neuer Vorgangstyp', () => editor(null, el), { kind: 'primary', iconName: 'plus' }) : null),
    h('div', { class: 'tpl-grid' }, list.filter(p => p.active).map(card)),
    list.some(p => !p.active) ? h('details', { class: 'mt' }, h('summary', {}, 'Archivierte Vorlagen'), h('div', { class: 'tpl-grid' }, list.filter(p => !p.active).map(card))) : null);
}

async function detail(el, id) {
  const d = await api.get(`/api/process-templates/${id}`);
  const p = d.template;
  clear(el,
    h('a', { class: 'back', href: '#/vorgaenge' }, icon('chevronLeft', 16), 'Vorgangsvorlagen'),
    pageHeader(`${p.key ? p.key + ' · ' : ''}${p.name}`, p.summary,
      button('Vorgang starten', () => openTaskForm({ template_id: p.id }), { kind: 'primary', iconName: 'play' }),
      isAdmin() ? button('Bearbeiten', () => editor(d, el), { iconName: 'edit' }) : null,
      isAdmin() ? button(p.active ? 'Archivieren' : 'Aktivieren', async () => { await api.put(`/api/process-templates/${p.id}`, { active: !p.active }); await refreshLookups(); detail(el, id); }, { kind: 'ghost' }) : null),
    h('div', { class: 'tpl-meta big' }, h('span', { class: 'badge' }, SCOPE[p.scope]), levelBadge(p.max_level), h('span', { class: 'muted small' }, `Höchststufe: ${LEVELS[p.max_level]} – ${LEVEL_HINT[p.max_level]}`),
      p.never_execute ? h('span', { class: 'badge badge-red' }, 'nie ausführen') : null, dataBadge(p.data_class),
      p.office_name ? h('span', { class: 'muted small' }, `Ämter: ${p.office_name}`) : null,
      p.baseline_minutes ? h('span', { class: 'muted small' }, `Vorher-Aufwand: ${p.baseline_minutes} Min.`) : null,
      p.source_ref ? h('span', { class: 'muted small' }, `Quelle im Katalog: ${p.source_ref}`) : null),
    h('div', { class: 'grid-2' },
      h('div', { class: 'col' },
        h('section', { class: 'card' }, h('header', { class: 'card-head' }, h('h2', {}, 'Anleitung')), h('div', { class: 'pad' }, p.guide ? richText(p.guide) : h('p', { class: 'warn-text' }, 'Noch keine Anleitung. Ohne Anleitung ist eine Übergabe schwer (AUF-14).'))),
        h('section', { class: 'card' }, h('header', { class: 'card-head' }, h('h2', {}, 'Teilschritte', h('span', { class: 'count' }, d.steps.length))),
          h('ol', { class: 'steps readonly' }, d.steps.map(s => h('li', { class: 'step' }, h('span', { class: 'step-no' }, s.pos), h('div', { class: 'step-body' },
            h('div', { class: 'step-title' }, s.title, s.manual ? h('span', { class: 'badge badge-manual' }, 'von Hand') : null),
            s.description ? h('div', { class: 'step-desc' }, s.description) : null,
            h('div', { class: 'small muted' }, [s.text_template_name ? `Textvorlage: ${s.text_template_name}` : null, s.calc ? `Rechner: ${s.calc}` : null].filter(Boolean).join(' · ')))))))),
      h('div', { class: 'col' },
        h('section', { class: 'card' }, h('header', { class: 'card-head' }, h('h2', {}, 'Lernprotokoll')),
          d.learnings.length ? h('ul', { class: 'learnings pad' }, d.learnings.map(l => h('li', { class: l.active ? '' : 'inactive' }, h('strong', {}, l.topic, ': '), l.rule, h('small', { class: 'muted' }, ` (${fmtDate(l.date)})`)))) : h('p', { class: 'muted pad' }, 'Noch keine Einträge. Korrekturen aus Vorgängen landen hier und gelten beim nächsten Durchlauf.')),
        h('section', { class: 'card' }, h('header', { class: 'card-head' }, h('h2', {}, 'Automatisierungen')),
          d.rules.length ? h('ul', { class: 'mini-list pad' }, d.rules.map(r => h('li', {}, h('a', { href: '#/automatisierung' }, r.name), levelBadge(r.level), h('span', { class: `pill ${r.active ? 'st-erledigt' : 'st-offen'}` }, r.active ? 'aktiv' : r.approved ? 'pausiert' : 'wartet auf Freigabe')))) : h('p', { class: 'muted pad' }, 'Keine Regeln für diesen Vorgang.')),
        h('section', { class: 'card' }, h('header', { class: 'card-head' }, h('h2', {}, 'Versionen')),
          h('ul', { class: 'mini-list pad' },
            h('li', {}, h('strong', {}, `v${p.version} (gültig)`), h('span', { class: 'muted small' }, `${fmtDateTime(p.updated_at)}${p.updated_by_name ? ' · ' + p.updated_by_name : ''}`)),
            d.versions.map(v => h('li', {}, h('span', {}, `v${v.version}`), h('span', { class: 'muted small' }, `abgelöst ${fmtDateTime(v.created_at)} · ${v.created_by_name || ''} · ${v.note}`))))))));
}

async function editor(d, el) {
  const p = d?.template || { scope: 'verein', max_level: 1, data_class: 'gruen' };
  const texts = await api.get('/api/text-templates');
  const calcs = await api.get('/api/calculators');
  const name = input({ value: p.name || '' });
  const scope = select(Object.entries(SCOPE), p.scope);
  const offices = input({ value: p.office_name || '', placeholder: 'z. B. Kasse, Vorsitz' });
  const summary = textarea({ rows: 2, value: p.summary || '' });
  const guide = textarea({ rows: 10, value: p.guide || '', placeholder: 'Ziel, Vorgehen in nummerierten Schritten, Stolpersteine …' });
  const maxLevel = select(LEVELS.map((l, i) => [i, l]), p.max_level);
  const never = h('input', { type: 'checkbox', checked: !!p.never_execute });
  const dataClass = select([['gruen', 'Grün'], ['gelb', 'Gelb']], p.data_class);
  const minors = h('input', { type: 'checkbox', checked: !!p.minors });
  const baseline = input({ type: 'number', min: 0, value: p.baseline_minutes ?? '', placeholder: 'Minuten' });
  const note = input({ placeholder: 'Was wurde geändert und warum?' });
  const steps = (d?.steps || []).map(s => ({ ...s }));
  const stepsBox = h('div', { class: 'step-editor' });
  const drawSteps = () => {
    clear(stepsBox, steps.map((s, i) => {
      const t = input({ value: s.title, placeholder: 'Titel des Schritts' });
      t.addEventListener('input', () => { s.title = t.value; });
      const dsc = input({ value: s.description || '', placeholder: 'Beschreibung (optional)' });
      dsc.addEventListener('input', () => { s.description = dsc.value; });
      const man = h('input', { type: 'checkbox', checked: !!s.manual });
      man.addEventListener('change', () => { s.manual = man.checked; });
      const tt = select([['', '— keine Textvorlage —'], ...texts.map(x => [x.id, x.name])], s.text_template_id || '');
      tt.addEventListener('change', () => { s.text_template_id = tt.value ? Number(tt.value) : null; });
      const cc = select([['', '— kein Rechner —'], ...calcs.map(x => [x.key, x.label])], s.calc || '');
      cc.addEventListener('change', () => { s.calc = cc.value || null; });
      const move = (dir) => { const j = i + dir; if (j < 0 || j >= steps.length) return; [steps[i], steps[j]] = [steps[j], steps[i]]; drawSteps(); };
      return h('div', { class: 'step-edit-row' },
        h('span', { class: 'step-no' }, i + 1),
        h('div', { class: 'step-edit-fields' }, t, dsc, h('div', { class: 'row-3' }, tt, cc, h('label', { class: 'check' }, man, h('span', {}, 'von Hand')))),
        h('div', { class: 'step-edit-actions' }, iconButton('chevronLeft', () => move(-1), 'nach oben'), iconButton('chevronRight', () => move(1), 'nach unten'), iconButton('trash', () => { steps.splice(i, 1); drawSteps(); }, 'Entfernen')));
    }), button('Schritt hinzufügen', () => { steps.push({ title: '', description: '', manual: 0 }); drawSteps(); }, { kind: 'ghost', iconName: 'plus' }));
  };
  drawSteps();
  const ok = await modal({ title: d ? `„${p.name}“ bearbeiten` : 'Neuer Vorgangstyp', wide: true,
    body: h('div', { class: 'form-grid' },
      h('div', { class: 'span-2' }, field('Name', name)), field('Ebene', scope), field('Zuständige Ämter', offices, 'Für das Handbuch je Amt; mehrere mit Komma.'),
      h('div', { class: 'span-2' }, field('Kurzbeschreibung', summary)),
      field('Höchststufe der Automatisierung', maxLevel, 'Die App überschreitet sie nie (AUT-1).'), field('Datenklasse', dataClass),
      h('div', { class: 'stack-sm' }, h('label', { class: 'check' }, never, h('span', {}, 'nie ausführen (nur Entwurf und Vorbereitung)')), h('label', { class: 'check' }, minors, h('span', {}, 'betrifft Daten Minderjähriger'))),
      field('Aufwand vorher (Minuten je Durchlauf)', baseline, 'Für die Messung der Zeitersparnis (ABN-4).'),
      h('div', { class: 'span-2' }, field('Anleitung (AUF-14)', guide, 'Nummerierte Zeilen werden als Liste dargestellt.')),
      h('div', { class: 'span-2' }, h('h4', {}, 'Teilschritte'), stepsBox),
      d ? h('div', { class: 'span-2' }, field('Änderungsnotiz (Pflicht)', note, 'Erscheint im Update-Fenster für alle Nutzer.')) : null),
    actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Speichern', kind: 'primary', onClick: async () => {
      const body = { name: name.value, scope: scope.value, office_name: offices.value, summary: summary.value, guide: guide.value, max_level: Number(maxLevel.value),
        never_execute: never.checked, data_class: dataClass.value, minors: minors.checked, baseline_minutes: baseline.value === '' ? null : Number(baseline.value),
        source_ref: p.source_ref, steps: steps.filter(s => s.title?.trim()), note: note.value };
      if (d) { await api.put(`/api/process-templates/${p.id}`, body); return p.id; }
      return (await api.post('/api/process-templates', body)).id;
    } }] });
  if (ok) { toast('Gespeichert'); await refreshLookups(); location.hash = `#/vorgaenge/${ok}`; detail(el, ok).catch(errorToast); }
}
