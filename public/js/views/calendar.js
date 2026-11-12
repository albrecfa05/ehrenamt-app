// Terminansicht (AUF-11), Jahreskalender je Amt (AUF-4, AUF-5) und Kalender-Abo.

import { api, qs } from '../api.js';
import { h, clear, pageHeader, tabs, button, iconButton, select, input, textarea, field, modal, toast, errorToast, confirmDialog, areaChip, fmtDate, addDays, today, MONTHS, WEEKDAYS, FREQ, icon, copyText, fmtMinutes, statusPill } from '../ui.js';
import { state, isAdmin, areaOptions, officeOptions, templateOptions, userOptions, autoOn, refreshMe } from '../state.js';

export default async function calendar(el, { tab = 'monat', query = {} }) {
  const head = pageHeader('Kalender', 'Fristen, Termine und der Jahreskalender aller Ämter.',
    button('Termin eintragen', () => eventDialog({}, () => calendar(el, { tab, query })), { kind: 'primary', iconName: 'plus' }));
  const nav = tabs([['monat', 'Monat'], ['jahr', 'Jahreskalender'], ['abo', 'Kalender-Abo']], tab, (k) => { location.hash = `#/kalender/${k}`; });
  const body = h('div');
  clear(el, head, nav, body);
  if (tab === 'jahr') return yearView(body);
  if (tab === 'abo') return aboView(body);
  return monthView(body, query);
}

// ---------- Monatsansicht ----------

async function monthView(el, query) {
  let month = /^\d{4}-\d{2}$/.test(query.m || '') ? query.m : today().slice(0, 7);
  let area = query.area || '';
  const draw = async () => {
    const first = `${month}-01`;
    const startWd = (new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7;
    const from = addDays(first, -startWd);
    const to = addDays(from, 41);
    const data = await api.get('/api/calendar' + qs({ from, to, area }));
    const byDay = new Map();
    const add = (d, item) => { if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(item); };
    data.events.forEach(e => add(e.date, { kind: 'event', ...e }));
    data.tasks.forEach(t => add(t.date, { kind: 'task', ...t }));
    data.recurring.forEach(r => add(r.date, { kind: 'rec', ...r }));
    const [y, m] = month.split('-').map(Number);
    const label = `${MONTHS[m - 1]} ${y}`;
    const shift = (n) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); month = d.toISOString().slice(0, 7); history.replaceState(null, '', `#/kalender/monat?m=${month}${area ? '&area=' + area : ''}`); draw(); };
    const areaSel = select(areaOptions(), area);
    areaSel.addEventListener('change', () => { area = areaSel.value; draw(); });
    const t = today();
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays(from, i);
      const items = (byDay.get(d) || []).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      cells.push(h('div', { class: ['cal-cell', d.slice(0, 7) !== month ? 'other' : '', d === t ? 'today' : ''].join(' ') },
        h('div', { class: 'cal-day' }, Number(d.slice(8))),
        items.slice(0, 5).map(it => calItem(it)),
        items.length > 5 ? h('div', { class: 'cal-more' }, `+${items.length - 5} weitere`) : null));
    }
    clear(el,
      h('div', { class: 'cal-toolbar' },
        iconButton('chevronLeft', () => shift(-1), 'Voriger Monat'), h('h2', {}, label), iconButton('chevronRight', () => shift(1), 'Nächster Monat'),
        button('Heute', () => { month = today().slice(0, 7); draw(); }, { kind: 'ghost' }), h('span', { class: 'spacer' }), areaSel),
      h('div', { class: 'cal-legend small muted' }, h('span', { class: 'lg lg-event' }, 'Termin'), h('span', { class: 'lg lg-task' }, 'Frist einer Aufgabe'), h('span', { class: 'lg lg-rec' }, 'aus dem Jahreskalender (noch keine Aufgabe)'), h('span', { class: 'lg lg-match' }, 'Spielplan (🏠 = Heimspiel)')),
      h('div', { class: 'cal-grid' }, WEEKDAYS.map(w => h('div', { class: 'cal-wd' }, w.slice(0, 2))), cells));
  };
  const calItem = (it) => {
    const col = it.area_color || '#64748b';
    let node;
    if (it.kind === 'task') node = h('a', { class: `cal-item task ${['erledigt', 'verworfen'].includes(it.status) ? 'done' : ''}`, href: `#/aufgabe/${it.id}`, title: `${it.title} (${it.area_name})` }, it.kind === 'task' && it.status === 'erledigt' ? '✓ ' : '', it.title);
    else if (it.kind === 'rec') node = h('a', { class: 'cal-item rec', href: '#/kalender/jahr', title: `${it.title} – wiederkehrend${it.assumption ? ' (Datum ist Annahme)' : ''}` }, '↻ ', it.title);
    else node = h('button', { class: `cal-item event ${it.source === 'spielplan' ? 'match' : ''}`, type: 'button', title: `${it.title}${it.location ? ' · ' + it.location : ''}`, onclick: () => eventDialog(it, draw) }, it.time ? h('b', {}, it.time + ' ') : null, it.title);
    node.style.setProperty('--c', col);
    return node;
  };
  await draw();
}

async function eventDialog(ev, done) {
  const area = select(areaOptions(null), ev.area_id || state.me.areas[0].id);
  const title = input({ value: ev.title || '' });
  const date = input({ type: 'date', value: ev.date || today() });
  const time = input({ type: 'time', value: ev.time || '' });
  const end = input({ type: 'time', value: ev.end_time || '' });
  const loc = input({ value: ev.location || '' });
  const notes = textarea({ rows: 3, value: ev.notes || '' });
  if (ev.source === 'spielplan') {
    await modal({ title: ev.title, body: h('div', {},
      h('p', {}, `${fmtDate(ev.date)}${ev.time ? ', ' + ev.time + ' Uhr' : ''}${ev.location ? ' · ' + ev.location : ''}`),
      ev.notes ? h('p', { class: 'small muted pre' }, ev.notes) : null,
      h('p', { class: 'hint' }, 'Aus einem Spielplan-Abo. Änderungen kommen automatisch aus click-TT/nuLiga; hier wird nichts bearbeitet.')) });
    return;
  }
  const actions = [{ label: 'Abbrechen', kind: 'ghost' }];
  if (ev.id && !ev.remote_id && autoOn('m365_kalender')) actions.push({ label: 'In Outlook eintragen', kind: 'ghost', onClick: async () => {
    await api.post(`/api/events/${ev.id}/outlook`); toast('Freigabe angefragt'); refreshMe().catch(() => {});
  } });
  if (ev.id) actions.push({ label: 'Löschen', kind: 'danger', onClick: async () => { if (!(await confirmDialog('Termin löschen?', { danger: true, ok: 'Löschen' }))) return false; await api.del(`/api/events/${ev.id}`); } });
  actions.push({ label: 'Speichern', kind: 'primary', onClick: () => {
    const b = { area_id: Number(area.value), title: title.value, date: date.value, time: time.value, end_time: end.value, location: loc.value, notes: notes.value };
    return ev.id ? api.put(`/api/events/${ev.id}`, b) : api.post('/api/events', b);
  } });
  const ok = await modal({ title: ev.id ? 'Termin' : 'Termin eintragen', body: h('div', { class: 'form-grid' },
    h('div', { class: 'span-2' }, field('Titel', title)), field('Bereich', area), field('Datum', date), field('Beginn', time), field('Ende', end),
    h('div', { class: 'span-2' }, field('Ort', loc)), h('div', { class: 'span-2' }, field('Notiz', notes)),
    ev.approval_id ? h('p', { class: 'hint span-2' }, `Über Freigabe #${ev.approval_id} eingetragen.`) : null,
    ev.remote_id ? h('p', { class: 'hint span-2' }, '✓ Steht auch im Outlook-Kalender.') : null), actions });
  if (ok) { toast('Gespeichert'); done?.(); }
}

// ---------- Jahreskalender ----------

async function yearView(el) {
  const rows = await api.get('/api/recurring');
  const admin = isAdmin();
  const byArea = new Map();
  for (const r of rows) { if (!byArea.has(r.area_name)) byArea.set(r.area_name, []); byArea.get(r.area_name).push(r); }
  const when = (r) => {
    if (r.freq === 'woechentlich') return `jeden ${WEEKDAYS[(r.day || 1) - 1]}`;
    if (r.freq === 'monatlich') return `monatlich am ${r.day}.`;
    if (r.freq === 'quartalsweise') return `quartalsweise ab ${r.day}. ${MONTHS[(r.month || 1) - 1]}`;
    if (r.freq === 'halbjaehrlich') return `halbjährlich ab ${r.day}. ${MONTHS[(r.month || 1) - 1]}`;
    return `${r.day}. ${MONTHS[(r.month || 1) - 1]}`;
  };
  clear(el,
    h('div', { class: 'toolbar' },
      h('p', { class: 'muted' }, 'Wiederkehrende Aufgaben je Amt. Die App legt sie mit dem eingestellten Vorlauf automatisch an. Mit ', h('span', { class: 'badge badge-gelb' }, 'Annahme'), ' markierte Daten bitte prüfen.'),
      admin ? h('div', { class: 'btn-row' },
        button('Jetzt prüfen', async () => { const r = await api.post('/api/recurring/generate'); toast(`${r.created} Aufgabe(n) angelegt`); yearView(el); }, { kind: 'ghost', iconName: 'refresh' }),
        button('Neuer Eintrag', () => recurringDialog({}, () => yearView(el)), { kind: 'primary', iconName: 'plus' })) : null),
    [...byArea].map(([name, list]) => h('section', { class: 'card' },
      h('header', { class: 'card-head' }, h('h2', {}, areaChip(name, list[0].area_color))),
      h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Was'), h('th', {}, 'Wann'), h('th', {}, 'Amt'), h('th', {}, 'Nächste Fälligkeit'), h('th', {}, 'Letzter Durchlauf'), admin ? h('th', {}) : null)),
        h('tbody', {}, list.map(r => h('tr', { class: r.active ? '' : 'inactive' },
          h('td', {}, h('strong', {}, r.title), r.template_name ? h('div', { class: 'small muted' }, r.template_name) : null, r.description ? h('div', { class: 'small muted' }, r.description) : null),
          h('td', {}, when(r), r.assumption ? h('span', { class: 'badge badge-gelb', title: 'Datum ist eine Annahme' }, 'Annahme') : null, h('div', { class: 'small muted' }, `Vorlauf ${r.lead_days} Tage`)),
          h('td', {}, r.office_name || '—', r.owner_name ? h('div', { class: 'small muted' }, r.owner_name) : null),
          h('td', {}, r.active ? fmtDate(r.next_due) : h('span', { class: 'muted' }, 'pausiert')),
          h('td', {}, r.last_task ? h('a', { href: `#/aufgabe/${r.last_task.id}` }, statusPill(r.last_task.status, true)) : '—',
            r.experience ? h('div', { class: 'small muted' }, [r.experience.days != null ? `${r.experience.days} Tage` : null, r.experience.minutes ? fmtMinutes(r.experience.minutes) : null].filter(Boolean).join(' · ')) : null),
          admin ? h('td', { class: 'actions' }, iconButton('edit', () => recurringDialog(r, () => yearView(el)), 'Bearbeiten')) : null)))))),
    !rows.length ? h('p', { class: 'muted' }, 'Noch keine Einträge.') : null);
}

async function recurringDialog(r, done) {
  const area = select(areaOptions(null), r.area_id || state.me.areas[0].id);
  const office = select(officeOptions(area.value), r.office_id);
  const tpl = select(templateOptions(area.value), r.template_id);
  area.addEventListener('change', () => { office.replaceChildren(...select(officeOptions(area.value), '').children); tpl.replaceChildren(...select(templateOptions(area.value), '').children); });
  const title = input({ value: r.title || '' });
  const desc = textarea({ rows: 2, value: r.description || '' });
  const freq = select(Object.entries(FREQ), r.freq || 'jaehrlich');
  const month = select(MONTHS.map((m, i) => [i + 1, m]), r.month || 1);
  const day = input({ type: 'number', min: 1, max: 31, value: r.day || 1 });
  const lead = input({ type: 'number', min: 0, max: 180, value: r.lead_days ?? 14 });
  const owner = select(userOptions('— Inhaber des Amts —'), r.owner_id);
  const assumption = h('input', { type: 'checkbox', checked: !!r.assumption });
  const active = h('input', { type: 'checkbox', checked: r.active !== 0 });
  const dayHint = h('div', { class: 'hint' });
  const upd = () => { dayHint.textContent = freq.value === 'woechentlich' ? 'Wochentag: 1 = Montag … 7 = Sonntag' : 'Tag im Monat'; month.disabled = ['monatlich', 'woechentlich'].includes(freq.value); };
  freq.addEventListener('change', upd); upd();
  const ok = await modal({ title: r.id ? 'Eintrag im Jahreskalender' : 'Neuer Eintrag im Jahreskalender', wide: true,
    body: h('div', { class: 'form-grid' },
      h('div', { class: 'span-2' }, field('Titel', title)), field('Bereich', area), field('Amt', office),
      h('div', { class: 'span-2' }, field('Vorgangsvorlage (Teilschritte werden übernommen)', tpl)),
      field('Rhythmus', freq), field('Monat', month), h('div', {}, field('Tag', day), dayHint), field('Vorlauf in Tagen', lead, 'So früh wird die Aufgabe angelegt.'),
      field('Verantwortlich', owner), h('div', { class: 'stack-sm' }, h('label', { class: 'check' }, assumption, h('span', {}, 'Datum ist eine Annahme')), h('label', { class: 'check' }, active, h('span', {}, 'aktiv'))),
      h('div', { class: 'span-2' }, field('Beschreibung', desc))),
    actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Speichern', kind: 'primary', onClick: () => {
      const b = { area_id: Number(area.value), office_id: office.value ? Number(office.value) : null, template_id: tpl.value ? Number(tpl.value) : null, title: title.value, description: desc.value,
        freq: freq.value, month: Number(month.value), day: Number(day.value), lead_days: Number(lead.value), owner_id: owner.value ? Number(owner.value) : null, assumption: assumption.checked, active: active.checked };
      return r.id ? api.put(`/api/recurring/${r.id}`, b) : api.post('/api/recurring', b);
    } }] });
  if (ok) { toast('Gespeichert'); done(); }
}

// ---------- Kalender-Abo ----------

async function aboView(el) {
  const { path } = await api.get('/api/me/calendar');
  const url = location.origin + path;
  clear(el, h('section', { class: 'card pad narrow' },
    h('h2', {}, icon('calendar', 18), 'Kalender abonnieren'),
    h('p', {}, 'Mit diesem persönlichen Link erscheinen eingetragene und freigegebene Termine sowie die Fristen deiner Aufgaben in deinem Kalender (Outlook, Google, Apple). Der Link enthält nur Titel und Bereich.'),
    h('div', { class: 'copy-row' }, h('code', { class: 'url' }, url), button('Kopieren', () => copyText(url), { iconName: 'copy' })),
    h('ul', { class: 'small muted' },
      h('li', {}, 'Outlook: Kalender hinzufügen → Aus dem Internet abonnieren.'),
      h('li', {}, 'Google: Weitere Kalender → Per URL.'),
      h('li', {}, 'Apple: Ablage → Neues Kalenderabonnement.')),
    h('p', { class: 'hint' }, 'Wer den Link kennt, sieht diese Termine. Bei Verdacht den Link erneuern – der alte wird sofort ungültig.'),
    button('Link erneuern', async () => { await api.post('/api/me/calendar/renew'); toast('Neuer Link erstellt'); aboView(el); }, { kind: 'ghost', iconName: 'refresh' })));
}

export { errorToast };
