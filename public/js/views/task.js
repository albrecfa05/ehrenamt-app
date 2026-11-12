// Detailansicht einer Aufgabe: alles, um einen Vorgang zu bearbeiten und nach einer Unterbrechung
// ohne neues Eindenken fortzusetzen (AUF-2, AUF-3, AUF-5, AUF-6, AUF-13, AUF-14).

import { api } from '../api.js';
import {
  h, clear, icon, button, iconButton, select, input, textarea, field, toast, errorToast, modal, confirmDialog, richText,
  statusPill, areaChip, dataBadge, levelBadge, fmtDate, fmtDateTime, relTime, dueLabel, fmtMinutes, STATUS, LEVELS, LEVEL_HINT, CHANNELS, today,
} from '../ui.js';
import { state, isAdmin, userOptions, officeOptions, areaOptions, refreshMe, autoOn } from '../state.js';
import { draftDialog, draftCard, calcDialog, uploadDialog, fileLink } from './shared.js';
import { progress } from './taskform.js';

export default async function taskView(el, { id }) {
  const reload = async () => {
    const d = await api.get(`/api/tasks/${id}`);
    render(d);
  };

  const render = (d) => {
    const t = d.task;
    const edit = d.canEdit;
    const save = async (changes, msg) => {
      try { await api.put(`/api/tasks/${t.id}`, changes); if (msg) toast(msg); await reload(); }
      catch (e) { errorToast(e); await reload(); }
    };

    // ----- Kopf -----
    const titleEl = h('h1', { class: 'task-title-big', contenteditable: edit ? 'plaintext-only' : null, spellcheck: 'true' }, t.title);
    if (edit) {
      titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); } });
      titleEl.addEventListener('blur', () => { const v = titleEl.textContent.trim(); if (v && v !== t.title) save({ title: v }, 'Titel gespeichert'); });
    }
    const statusButtons = h('div', { class: 'status-buttons', role: 'group', 'aria-label': 'Status' },
      ['offen', 'in_arbeit', 'wartet', 'erledigt'].map(s => h('button', {
        class: `seg ${t.status === s ? 'active ' + STATUS[s].cls : ''}`, type: 'button', disabled: !edit,
        onclick: () => setStatus(s),
      }, STATUS[s].short || STATUS[s].label)),
      h('button', { class: `seg ${t.status === 'verworfen' ? 'active st-verworfen' : ''}`, type: 'button', disabled: !edit, title: 'Verwerfen', onclick: () => setStatus('verworfen') }, '✕'));

    const setStatus = async (s) => {
      if (s === t.status) return;
      if (s === 'wartet') {
        const who = input({ placeholder: 'z. B. Staffelleitung, Max (Bilder)', value: t.waiting_who || '' });
        const what = input({ placeholder: 'Was fehlt genau?', value: t.waiting_what || '' });
        const ok = await modal({ title: 'Wartet auf Zulieferung', body: h('div', {}, field('Wer schuldet etwas?', who), field('Was fehlt?', what)),
          actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Speichern', kind: 'primary', onClick: async () => {
            if (!who.value.trim()) throw new Error('Bitte angeben, wer etwas schuldet.');
            await api.put(`/api/tasks/${t.id}`, { status: 'wartet', waiting_who: who.value.trim(), waiting_what: what.value.trim() });
          } }] });
        if (ok) reload();
        return;
      }
      if (s === 'erledigt') {
        const open = d.steps.filter(x => !x.done).length;
        const minutes = input({ type: 'number', min: 1, placeholder: 'Minuten' });
        const lessons = textarea({ rows: 3, value: t.lessons || '', placeholder: 'Was war knifflig? Was hilft beim nächsten Mal?' });
        const ok = await modal({ title: 'Aufgabe abschließen', body: h('div', {},
          open ? h('p', { class: 'warn-box' }, icon('alert', 16), `${open} Teilschritt(e) sind noch offen.`) : null,
          d.time.length ? null : field('Zeitaufwand (für die Kennzahlen)', minutes, 'Prüfzeit einrechnen.'),
          field('Erfahrungen für den nächsten Durchlauf', lessons, 'Erscheint beim nächsten Mal als Erfahrungswert (AUF-5).')),
          actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Abschließen', kind: 'primary', onClick: async () => {
            if (Number(minutes.value) > 0) await api.post(`/api/tasks/${t.id}/time`, { minutes: Number(minutes.value) });
            await api.put(`/api/tasks/${t.id}`, { status: 'erledigt', lessons: lessons.value });
          } }] });
        if (ok) { toast('Erledigt'); reload(); }
        return;
      }
      if (s === 'verworfen' && !(await confirmDialog('Aufgabe verwerfen? Sie bleibt im Protokoll sichtbar.', { ok: 'Verwerfen', danger: true }))) return;
      save({ status: s });
    };

    const header = h('header', { class: 'task-head' },
      h('a', { class: 'back', href: t.kind === 'idee' ? '#/ideen' : '#/aufgaben' }, icon('chevronLeft', 16), t.kind === 'idee' ? 'Ideenspeicher' : 'Aufgaben'),
      h('div', { class: 'task-head-row' }, titleEl),
      h('div', { class: 'task-head-meta' },
        areaChip(t.area_name, t.area_color), t.office_name ? h('span', {}, t.office_name) : null,
        t.template_name ? h('a', { href: `#/vorgaenge/${t.template_id}`, class: 'badge' }, icon('flow', 12), t.template_name, t.template_version ? ` v${t.template_version}` : '') : null,
        dataBadge(t.data_class), levelBadge(t.level, d.template?.max_level),
        t.kind === 'idee' ? h('span', { class: 'badge badge-idea' }, 'Idee') : null,
        t.overdue ? h('span', { class: 'flag flag-over' }, `überfällig ${dueLabel(t.due_date)}`) : null,
        t.stale ? h('span', { class: 'flag flag-stale' }, `${t.idle_days} Tage ohne Bewegung`) : null),
      h('div', { class: 'task-head-actions' }, statusButtons,
        t.kind === 'idee' && edit ? button('In Aufgabe umwandeln', () => save({ kind: 'aufgabe' }, 'Aus der Idee wird eine Aufgabe'), { kind: 'ghost' }) : null),
      t.status === 'wartet' ? h('div', { class: 'callout callout-violet' }, icon('clock'), h('span', {}, 'Wartet auf ', h('strong', {}, t.waiting_who || '—'), t.waiting_what ? `: ${t.waiting_what}` : '')) : null);

    // ----- Hauptspalte -----
    const descView = t.description ? richText(t.description) : h('p', { class: 'muted' }, 'Keine Beschreibung.');
    const descSection = h('section', { class: 'card' },
      h('header', { class: 'card-head' }, h('h2', {}, 'Beschreibung'), edit ? iconButton('edit', () => editDesc(), 'Beschreibung bearbeiten') : null),
      h('div', { class: 'pad' }, descView));
    const editDesc = () => {
      const ta = textarea({ rows: 10, value: t.description });
      clear(descSection.lastChild, ta, h('div', { class: 'btn-row' }, button('Abbrechen', () => reload(), { kind: 'ghost' }), button('Speichern', () => save({ description: ta.value }, 'Gespeichert'), { kind: 'primary' })));
      ta.focus();
    };

    const guide = d.template?.guide ? h('details', { class: 'card guide', open: !d.steps.some(s => s.done) },
      h('summary', {}, icon('book', 16), h('strong', {}, 'Anleitung: ', d.template.name), h('small', { class: 'muted' }, ' – so führt auch eine zweite Person den Vorgang ohne Rückfrage durch')),
      h('div', { class: 'pad' }, richText(d.template.guide))) : null;

    const hints = (d.experience || d.learnings.length) ? h('section', { class: 'card card-hint' },
      h('header', { class: 'card-head' }, h('h2', {}, icon('bulb', 16), 'Aus früheren Durchläufen')),
      h('div', { class: 'pad' },
        d.experience ? h('div', { class: 'experience' },
          h('div', { class: 'exp-stats' },
            h('span', {}, 'Letztes Mal: ', h('a', { href: `#/aufgabe/${d.experience.task_id}` }, fmtDate(d.experience.completed_at))),
            d.experience.days != null ? h('span', {}, `Dauer ${d.experience.days} Tage`) : null,
            d.experience.minutes ? h('span', {}, `Aufwand ${fmtMinutes(d.experience.minutes)}`) : null),
          d.experience.lessons ? h('blockquote', {}, d.experience.lessons) : h('p', { class: 'muted small' }, 'Keine Notizen hinterlassen.')) : null,
        d.learnings.length ? h('div', {}, h('h4', {}, 'Lernprotokoll – gilt bei diesem Durchlauf'),
          h('ul', { class: 'learnings' }, d.learnings.map(l => h('li', {}, h('strong', {}, l.topic, ': '), l.rule, h('small', { class: 'muted' }, ` (${fmtDate(l.date)}${l.origin ? ', ' + l.origin : ''})`))))) : null)) : null;

    // Teilschritte
    const done = d.steps.filter(s => s.done).length;
    const nextStep = d.steps.find(s => !s.done);
    const stepsEl = h('ol', { class: 'steps' }, d.steps.map(s => stepItem(s, s === nextStep)));
    function stepItem(s, isNext) {
      const box = h('input', { type: 'checkbox', checked: !!s.done, disabled: !edit, 'aria-label': `Schritt ${s.pos} erledigt` });
      box.addEventListener('change', async () => {
        try { await api.put(`/api/tasks/${t.id}/steps/${s.id}`, { done: box.checked }); reload(); } catch (e) { errorToast(e); box.checked = !box.checked; }
      });
      const noteBtn = edit ? iconButton('edit', async () => {
        const ta = textarea({ rows: 3, value: s.note });
        const ok = await modal({ title: `Notiz zu „${s.title}“`, body: ta, actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Speichern', kind: 'primary', onClick: () => api.put(`/api/tasks/${t.id}/steps/${s.id}`, { note: ta.value }) }] });
        if (ok) reload();
      }, 'Notiz') : null;
      return h('li', { class: ['step', s.done ? 'done' : '', isNext ? 'next' : ''].join(' ') },
        box,
        h('div', { class: 'step-body' },
          h('div', { class: 'step-title' }, s.title, s.manual ? h('span', { class: 'badge badge-manual', title: 'Wird außerhalb der App von Hand erledigt' }, 'von Hand') : null, isNext ? h('span', { class: 'badge badge-next' }, 'als Nächstes') : null),
          s.description ? h('div', { class: 'step-desc' }, s.description) : null,
          s.note ? h('div', { class: 'step-note' }, icon('edit', 12), s.note) : null,
          s.done ? h('div', { class: 'step-done muted small' }, `erledigt ${s.done_by_name ? 'von ' + s.done_by_name + ' ' : ''}${relTime(s.done_at)}`) : null,
          h('div', { class: 'step-actions' },
            s.text_template_id ? button(`Entwurf: ${s.text_template_name}`, async () => { if (await draftDialog(t, s.text_template_id)) reload(); }, { kind: 'mini', iconName: 'mail' }) : null,
            s.calc ? button('Rechner öffnen', async () => { await calcDialog(t, s.calc); reload(); }, { kind: 'mini', iconName: 'calc' }) : null)),
        noteBtn);
    }
    const addStep = edit ? h('form', { class: 'add-step', onsubmit: async (e) => {
      e.preventDefault(); const i = e.target.querySelector('input');
      if (!i.value.trim()) return;
      try { await api.post(`/api/tasks/${t.id}/steps`, { title: i.value.trim() }); reload(); } catch (err) { errorToast(err); }
    } }, input({ placeholder: '+ Teilschritt hinzufügen' })) : null;
    const stepsSection = h('section', { class: 'card' },
      h('header', { class: 'card-head' }, h('h2', {}, 'Teilschritte', d.steps.length ? h('span', { class: 'count' }, `${done}/${d.steps.length}`) : null), d.steps.length ? progress(done, d.steps.length) : null),
      d.steps.length ? stepsEl : h('p', { class: 'muted pad' }, 'Keine Teilschritte. Für Standardprozesse eine Vorgangsvorlage verwenden.'),
      addStep);

    // Entwürfe und Berechnungen
    const draftsSection = h('section', { class: 'card' },
      h('header', { class: 'card-head' }, h('h2', {}, 'Entwürfe', d.drafts.length ? h('span', { class: 'count' }, d.drafts.length) : null),
        button('Entwurf aus Vorlage', async () => { if (await draftDialog(t)) reload(); }, { kind: 'ghost', iconName: 'plus' })),
      d.drafts.length ? h('div', { class: 'pad stack' }, d.drafts.map(x => draftCard(x, reload)))
        : h('p', { class: 'muted pad' }, 'Mails entstehen nur als Entwurf. Den Versand löst immer ein Mensch aus.'));

    const calcSection = d.calcs.length ? h('section', { class: 'card' },
      h('header', { class: 'card-head' }, h('h2', {}, 'Berechnungen')),
      h('div', { class: 'pad stack' }, d.calcs.map(c => h('details', { class: 'calc' },
        h('summary', {}, h('strong', {}, c.calc), ' · ', fmtDateTime(c.created_at), ' · ', c.user_name || ''),
        h('ol', { class: 'calc-steps' }, c.steps.map(s => h('li', {}, s))))))) : null;

    // Kommentare
    const commentBox = textarea({ rows: 2, placeholder: 'Kommentar, Info oder Material zuliefern …' });
    const commentsSection = h('section', { class: 'card' },
      h('header', { class: 'card-head' }, h('h2', {}, 'Kommentare', d.comments.length ? h('span', { class: 'count' }, d.comments.length) : null)),
      h('ul', { class: 'comments' }, d.comments.map(c => h('li', {}, h('div', { class: 'c-head' }, h('strong', {}, c.user_name || 'System'), h('small', { class: 'muted' }, relTime(c.created_at))), h('div', { class: 'c-body' }, c.body)))),
      h('form', { class: 'comment-form', onsubmit: async (e) => {
        e.preventDefault();
        if (!commentBox.value.trim()) return;
        try { await api.post(`/api/tasks/${t.id}/comments`, { body: commentBox.value }); reload(); } catch (err) { errorToast(err); }
      } }, commentBox, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Senden')));

    // Verlauf (AUF-13)
    const historySection = h('details', { class: 'card history' },
      h('summary', {}, icon('shield', 16), h('strong', {}, 'Verlauf'), h('span', { class: 'count' }, d.history.length), h('small', { class: 'muted' }, ' – wer hat wann was getan, entschieden oder freigegeben')),
      h('ol', { class: 'timeline' }, d.history.map(x => h('li', {}, h('time', {}, fmtDateTime(x.at)), h('strong', {}, x.user_name), ' ', x.summary))));

    // ----- Seitenspalte -----
    const sel = (name, options, value, extra = {}) => {
      const s = select(options, value ?? '', { disabled: !edit, ...extra });
      s.addEventListener('change', () => save({ [name]: s.value === '' ? null : (/_id$|^level$|^priority$/.test(name) ? Number(s.value) : s.value) }, 'Gespeichert'));
      return s;
    };
    const dueInput = input({ type: 'date', value: t.due_date || '', disabled: !edit });
    dueInput.addEventListener('change', () => save({ due_date: dueInput.value || null }, 'Fälligkeit gespeichert'));
    const maxLevel = d.template?.max_level ?? 4;
    const levelSel = sel('level', LEVELS.map((l, i) => [i, l]), t.level);
    [...levelSel.options].forEach(o => { o.disabled = Number(o.value) > maxLevel; });

    const minutes = input({ type: 'number', min: 1, max: 600, placeholder: 'Min.', class: 'w-small' });
    const timeNote = input({ placeholder: 'wofür? (optional)' });
    const totalMin = d.time.reduce((a, b) => a + b.minutes, 0);

    const side = h('aside', { class: 'task-side' },
      h('section', { class: 'card pad side-fields' },
        field('Verantwortlich', sel('owner_id', userOptions('— niemand —'), t.owner_id)),
        field('Vertretung', sel('deputy_id', userOptions('— keine —'), t.deputy_id)),
        field('Fällig am', dueInput, t.due_date ? dueLabel(t.due_date) : null),
        field('Bereich', sel('area_id', areaOptions(null), t.area_id)),
        field('Amt', sel('office_id', officeOptions(t.area_id), t.office_id)),
        field('Priorität', sel('priority', [[0, 'Normal'], [1, 'Wichtig'], [2, 'Sehr wichtig']], t.priority)),
        field('Eingangskanal', sel('channel', Object.entries(CHANNELS), t.channel)),
        field('Datenklasse', sel('data_class', [['gruen', 'Grün'], ['gelb', 'Gelb']], t.data_class), t.data_class === 'gelb' ? 'Nur im Vorgang; nie in die Wissensbasis.' : null),
        field('Automatisierungsstufe', levelSel, `${LEVEL_HINT[t.level]}${d.template ? ` · Höchststufe dieses Vorgangs: ${maxLevel}` : ''}`),
        h('div', { class: 'small muted' }, `Angelegt ${fmtDateTime(t.created_at)}`, t.started_at ? ` · begonnen ${fmtDateTime(t.started_at)}` : ' · noch nicht begonnen', t.completed_at ? ` · abgeschlossen ${fmtDateTime(t.completed_at)}` : '', t.parent_source ? ` · Herkunft: ${t.parent_source}` : '')),

      h('section', { class: 'card pad' },
        h('h3', {}, icon('clock', 16), 'Zeit', h('span', { class: 'count' }, fmtMinutes(totalMin))),
        h('form', { class: 'inline-form', onsubmit: async (e) => {
          e.preventDefault();
          if (!(Number(minutes.value) > 0)) return;
          try { await api.post(`/api/tasks/${t.id}/time`, { minutes: Number(minutes.value), note: timeNote.value }); toast('Zeit erfasst'); reload(); } catch (err) { errorToast(err); }
        } }, minutes, timeNote, h('button', { class: 'btn', type: 'submit' }, 'Erfassen')),
        d.time.length ? h('ul', { class: 'mini-list small' }, d.time.slice(0, 5).map(x => h('li', {}, h('span', {}, fmtMinutes(x.minutes)), h('span', { class: 'muted' }, `${x.user_name || ''} · ${fmtDate(x.created_at)}${x.note ? ' · ' + x.note : ''}`)))) : null),

      h('section', { class: 'card pad' },
        h('h3', {}, icon('paperclip', 16), 'Anhänge', d.files.length ? h('span', { class: 'count' }, d.files.length) : null),
        d.files.length ? h('div', { class: 'files' }, d.files.map(fileLink)) : h('p', { class: 'muted small' }, 'Bilder, Mails und Dokumente hier sammeln.'),
        button('Datei anhängen', async () => { if (await uploadDialog({ areaId: t.area_id, taskId: t.id })) reload(); }, { kind: 'ghost', iconName: 'upload' })),

      h('section', { class: 'card pad' },
        h('h3', {}, icon('zap', 16), 'Werkzeuge'),
        h('div', { class: 'stack-sm' },
          button('Rechner (mit Rechenweg)', async () => { await calcDialog(t); reload(); }, { kind: 'ghost', iconName: 'calc' }),
          button('Termin zur Freigabe vorschlagen', () => eventRequest(t, d, reload), { kind: 'ghost', iconName: 'calendar', title: 'Stufe 3: Kalendereintrag erst nach ausdrücklichem Ja eines Admins' }),
          button('Ins Lernprotokoll', () => learningDialog(t), { kind: 'ghost', iconName: 'bulb', title: 'Korrektur oder Entscheidung für künftige Durchläufe festhalten' }),
          button('In der Auskunft nachschlagen', () => { location.hash = `#/auskunft?area=${t.area_id}`; }, { kind: 'ghost', iconName: 'book' })),
        d.approvals.length ? h('ul', { class: 'mini-list small mt' }, d.approvals.map(a => h('li', {}, h('span', {}, a.summary), h('span', { class: `pill ap-${a.status}` }, a.status)))) : null,
        d.events.length ? h('ul', { class: 'mini-list small' }, d.events.map(e => h('li', {}, icon('calendar', 12), `${fmtDate(e.date)} ${e.title}`))) : null),

      h('section', { class: 'card pad' },
        h('h3', {}, 'Notizen für den nächsten Durchlauf'),
        (() => { const ta = textarea({ rows: 3, value: t.lessons, disabled: !edit, placeholder: 'Dauer, Stolpersteine, Kontakte …' }); ta.addEventListener('change', () => save({ lessons: ta.value }, 'Notiz gespeichert')); return ta; })()));

    clear(el, h('div', { class: 'task-page' },
      header,
      h('div', { class: 'task-grid' },
        h('div', { class: 'task-main-col' }, guide, hints, stepsSection, descSection, draftsSection, calcSection, commentsSection, historySection),
        side)));
  };

  await reload();
}

async function eventRequest(t, d, reload) {
  const date = input({ type: 'date', value: t.due_date || today() });
  const time = input({ type: 'time' });
  const title = input({ value: t.title });
  const loc = input({ placeholder: 'Ort (optional)' });
  const outlook = h('input', { type: 'checkbox', checked: true });
  const ok = await modal({ title: 'Termin zur Freigabe vorschlagen',
    body: h('div', {}, h('p', { class: 'hint' }, 'Stufe 3: Der Termin landet erst nach dem ausdrücklichen Ja eines Admins im Kalender-Abo. Die Freigabe wird mit Person und Zeitpunkt protokolliert.'),
      h('div', { class: 'form-grid' }, h('div', { class: 'span-2' }, field('Titel', title)), field('Datum', date), field('Uhrzeit', time), h('div', { class: 'span-2' }, field('Ort', loc)),
        autoOn('m365_kalender') ? h('label', { class: 'check span-2' }, outlook, h('span', {}, 'auch im Outlook-Kalender des Vereins eintragen')) : null)),
    actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Freigabe anfragen', kind: 'primary', onClick: () => api.post(`/api/tasks/${t.id}/event-request`, { title: title.value, date: date.value, time: time.value, location: loc.value, outlook: autoOn('m365_kalender') && outlook.checked }) }] });
  if (ok) { toast('Freigabe angefragt'); refreshMe().catch(() => {}); reload(); }
}

async function learningDialog(t) {
  const topic = input({ placeholder: 'z. B. Kündigungsfrist' });
  const rule = textarea({ rows: 3, placeholder: 'Die Regel oder Korrektur, die künftig gelten soll' });
  const ok = await modal({ title: 'Ins Lernprotokoll übernehmen', body: h('div', {},
    h('p', { class: 'hint' }, 'Der Eintrag erscheint bei jedem künftigen Durchlauf dieses Vorgangstyps (AUT-15).'),
    field('Thema', topic), field('Regel', rule)),
    actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Speichern', kind: 'primary', onClick: () => api.post(`/api/tasks/${t.id}/learning`, { topic: topic.value, rule: rule.value }) }] });
  if (ok) toast('Im Lernprotokoll gespeichert');
}

export { isAdmin, state };
