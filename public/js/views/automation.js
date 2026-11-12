// Automatisierungen (Kap. 6): Regeln mit Stufe und Freigabe, Freigabe-Warteschlange, Läufe, Berichte.

import { api } from '../api.js';
import kiTab from './ki.js';
import { h, clear, pageHeader, tabs, button, iconButton, select, input, textarea, field, modal, toast, errorToast, confirmDialog, emptyState, fmtDateTime, relTime, fmtDate, LEVELS, LEVEL_HINT, WEEKDAYS, levelBadge, icon, statusPill, areaChip } from '../ui.js';
import { state, isAdmin, areaOptions, templateOptions, userOptions, officeOptions, refreshMe } from '../state.js';

const PAYLOAD_LABEL = { title: 'Titel', date: 'Datum', time: 'Uhrzeit', location: 'Ort', notes: 'Notiz' };
const OUTCOME = { ok: ['ausgeführt', 'st-erledigt'], freigabe_angefragt: ['Freigabe angefragt', 'st-wartet'], gesperrt: ['gesperrt', 'st-verworfen'], fehler: ['Fehler', 'st-over'], nichts_zu_tun: ['nichts zu tun', 'st-offen'] };

export default async function automation(el, { tab = 'regeln', query = {} }) {
  const meta = await api.get('/api/automation/meta');
  const body = h('div');
  clear(el,
    pageHeader('Automatisierungen', 'Nichts verlässt die App ohne Rückfrage und Freigabe durch einen Admin.'),
    h('div', { class: 'levels' }, LEVELS.map((l, i) => h('div', { class: `level lv${i}` }, h('strong', {}, l), h('span', {}, LEVEL_HINT[i])))),
    h('div', { class: 'blocked-banner' }, icon('lock', 16), h('span', {}, h('strong', {}, 'Technisch gesperrt: '), meta.blocked.join(', '), '. Mails entstehen nur als Entwurf.'),
      meta.yellowAllowed ? null : h('span', { class: 'muted' }, ' · Vorgänge mit gelben Daten laufen erst nach Klärung der Datenschutzfrage automatisch.')),
    tabs([['regeln', 'Regeln'], ...(isAdmin() ? [['ki', 'Mit KI erstellen']] : []), ['freigaben', 'Freigaben', state.me.counts.approvals], ['laeufe', 'Läufe'], ['berichte', 'Übersichten']], tab, (k) => { location.hash = `#/automatisierung/${k}`; }),
    body);
  if (tab === 'ki' && isAdmin()) return kiTab(body);
  if (tab === 'freigaben') return approvals(body);
  if (tab === 'laeufe') return runs(body);
  if (tab === 'berichte') return reports(body, query.id);
  return rules(body, meta);
}

// ---------- Regeln ----------

function describeTrigger(r) {
  const c = r.trigger_config || {};
  switch (r.trigger_type) {
    case 'zeitplan': return `${c.rhythmus === 'woechentlich' ? `jeden ${WEEKDAYS[(c.wochentag || 1) - 1]}` : c.rhythmus === 'monatlich' ? `monatlich am ${c.tag || 1}.` : 'täglich'} um ${c.stunde} Uhr`;
    case 'frist': return `${c.tage_vorher} Tag(e) vor Fälligkeit`;
    case 'eingang': return 'wenn ein Eingang zur Aufgabe wird';
    case 'statuswechsel': return `bei Statuswechsel${c.von ? ` von „${c.von}“` : ''}${c.zu ? ` zu „${c.zu}“` : ''}`;
    default: return 'nur auf Zuruf';
  }
}

async function rules(el, meta) {
  const rows = await api.get('/api/rules');
  const selected = new Set();
  const admin = isAdmin();
  const seqBtn = button('Ausgewählte hintereinander ausführen', async () => {
    try {
      const r = await api.post('/api/rules/run-sequence', { ids: [...selected] });
      await modal({ title: 'Ergebnis', body: h('ol', {}, r.results.map(x => h('li', {}, h('strong', {}, x.name), ': ', OUTCOME[x.outcome]?.[0] || x.outcome, ' – ', x.detail))) });
      rules(el, meta);
    } catch (e) { errorToast(e); }
  }, { kind: 'primary', iconName: 'play', disabled: true });
  const card = (r) => {
    const chk = h('input', { type: 'checkbox', 'aria-label': 'Auswählen', onchange: (e) => { e.target.checked ? selected.add(r.id) : selected.delete(r.id); seqBtn.disabled = !selected.size; } });
    const state_ = !r.approved ? ['wartet auf Freigabe', 'st-wartet'] : r.active ? ['aktiv', 'st-erledigt'] : ['pausiert', 'st-offen'];
    return h('article', { class: `card rule ${r.active ? '' : 'inactive'}` },
      h('header', { class: 'card-head' },
        h('div', { class: 'rule-title' }, admin ? chk : null, h('h3', {}, r.name), levelBadge(r.level, r.template_max_level), h('span', { class: `pill ${state_[1]}` }, state_[0])),
        admin ? h('div', { class: 'btn-row' },
          !r.approved ? button('Freigeben', async () => {
            if (!(await confirmDialog(`Regel „${r.name}“ (Stufe ${r.level}) freigeben und aktivieren? Die Freigabe wird mit deinem Namen und Zeitpunkt protokolliert.`, { ok: 'Freigeben' }))) return;
            try { await api.post(`/api/rules/${r.id}/approve`, { approve: true }); toast('Freigegeben'); rules(el, meta); } catch (e) { errorToast(e); }
          }, { kind: 'primary', iconName: 'check' }) :
            button(r.active ? 'Pausieren' : 'Aktivieren', async () => { await api.post(`/api/rules/${r.id}/toggle`, { active: !r.active }); rules(el, meta); }, { kind: 'ghost' }),
          button('Jetzt ausführen', async () => {
            try { const x = await api.post(`/api/rules/${r.id}/run`); toast(`${OUTCOME[x.outcome]?.[0] || x.outcome}: ${x.detail}`, x.outcome === 'ok' || x.outcome === 'freigabe_angefragt' ? 'ok' : 'error', 6000); rules(el, meta); refreshMe(); }
            catch (e) { errorToast(e); }
          }, { kind: 'ghost', iconName: 'play' }),
          iconButton('edit', () => ruleEditor(r, meta, () => rules(el, meta)), 'Bearbeiten')) : null),
      h('div', { class: 'pad rule-body' },
        r.description ? h('p', {}, r.description) : null,
        h('div', { class: 'rule-flow' }, h('span', { class: 'rf-when' }, icon('clock', 14), describeTrigger(r)), icon('chevronRight', 14), h('span', { class: 'rf-do' }, icon('zap', 14), meta.actions[r.action_type]?.label || r.action_type)),
        h('div', { class: 'small muted' }, [r.area_name ? `Bereich: ${r.area_name}` : 'alle Bereiche', r.template_name ? `Vorgang: ${r.template_name} (Höchststufe ${r.template_max_level})` : null,
          r.approved ? `freigegeben von ${r.approved_by_name} am ${fmtDate(r.approved_at)}` : null, r.last_run_at ? `zuletzt ${relTime(r.last_run_at)} (${OUTCOME[r.last_outcome]?.[0] || r.last_outcome})` : 'noch nie gelaufen', `v${r.version}`].filter(Boolean).join(' · '))));
  };
  clear(el,
    admin ? h('div', { class: 'toolbar' }, seqBtn, button('Neue Regel', () => ruleEditor(null, meta, () => rules(el, meta)), { kind: 'primary', iconName: 'plus' })) : null,
    rows.length ? h('div', { class: 'stack' }, rows.map(card)) : emptyState('Noch keine Regeln.'));
}

async function ruleEditor(r, meta, done) {
  r = r || { trigger_type: 'manuell', action_type: 'erinnern', level: 1, trigger_config: {}, action_config: {} };
  const texts = await api.get('/api/text-templates');
  const name = input({ value: r.name || '' });
  const desc = textarea({ rows: 2, value: r.description || '' });
  const area = select(areaOptions('Alle Bereiche'), r.area_id || '');
  const tpl = select(templateOptions(null, '— kein bestimmter Vorgang —'), r.template_id || '');
  const level = select(LEVELS.map((l, i) => [i, l]), r.level);
  const trigger = select(Object.entries(meta.triggers), r.trigger_type);
  const action = select(Object.entries(meta.actions).filter(([, a]) => a.ruleable !== false).map(([k, a]) => [k, `${a.label} (ab Stufe ${a.minLevel})`]), r.action_type);
  const tBox = h('div', { class: 'form-grid' });
  const aBox = h('div', { class: 'form-grid' });
  const levelInfo = h('div', { class: 'hint' });
  const tc = { ...r.trigger_config }, ac = { ...r.action_config };
  const bind = (obj, key, ctl, num = false) => { ctl.addEventListener('change', () => { obj[key] = ctl.type === 'checkbox' ? ctl.checked : ctl.value === '' ? null : num ? Number(ctl.value) : ctl.value; }); return ctl; };

  const drawTrigger = () => {
    clear(tBox);
    if (trigger.value === 'zeitplan') {
      tc.rhythmus ||= 'woechentlich'; tc.stunde ??= 7;
      tBox.append(field('Rhythmus', bind(tc, 'rhythmus', select([['taeglich', 'täglich'], ['woechentlich', 'wöchentlich'], ['monatlich', 'monatlich']], tc.rhythmus))),
        field('Wochentag', bind(tc, 'wochentag', select(WEEKDAYS.map((w, i) => [i + 1, w]), tc.wochentag || 1), true)),
        field('Tag im Monat', bind(tc, 'tag', input({ type: 'number', min: 1, max: 28, value: tc.tag || 1 }), true)),
        field('Uhrzeit (Stunde)', bind(tc, 'stunde', input({ type: 'number', min: 0, max: 23, value: tc.stunde }), true)));
    } else if (trigger.value === 'frist') {
      tc.tage_vorher ??= 3;
      tBox.append(field('Tage vor der Fälligkeit', bind(tc, 'tage_vorher', input({ type: 'number', min: 0, max: 90, value: tc.tage_vorher }), true)));
    } else if (trigger.value === 'statuswechsel') {
      const st = [['', 'egal'], ['offen', 'Offen'], ['in_arbeit', 'In Arbeit'], ['wartet', 'Wartet'], ['erledigt', 'Erledigt']];
      tBox.append(field('Von', bind(tc, 'von', select(st, tc.von || ''))), field('Zu', bind(tc, 'zu', select(st, tc.zu || ''))));
    } else tBox.append(h('p', { class: 'hint span-2' }, trigger.value === 'eingang' ? 'Läuft, wenn im Eingang eine Nachricht als Aufgabe übernommen wird.' : 'Läuft nur, wenn ein Admin sie startet (einzeln oder hintereinander).'));
  };
  const drawAction = () => {
    clear(aBox);
    const a = action.value;
    if (a === 'aufgabe_anlegen') {
      const ar = Number(area.value) || state.me.areas[0].id;
      aBox.append(h('div', { class: 'span-2' }, field('Titel', bind(ac, 'title', input({ value: ac.title || '', placeholder: 'z. B. Wochenplanung Hallenbelegung' })))),
        field('Bereich der Aufgabe', bind(ac, 'area_id', select(areaOptions(null), ac.area_id || ar), true)),
        field('Vorgangsvorlage', bind(ac, 'template_id', select(templateOptions(null), ac.template_id || ''), true)),
        field('Verantwortlich', bind(ac, 'owner_id', select(userOptions('— über das Amt —'), ac.owner_id || ''), true)),
        field('Fällig in … Tagen', bind(ac, 'faellig_in_tagen', input({ type: 'number', min: 0, value: ac.faellig_in_tagen ?? 7 }), true)),
        h('div', { class: 'span-2' }, field('Beschreibung', bind(ac, 'description', textarea({ rows: 2, value: ac.description || '' })))));
    } else if (a === 'entwurf_erzeugen') {
      aBox.append(h('div', { class: 'span-2' }, field('Textvorlage', bind(ac, 'text_template_id', select([['', 'wählen …'], ...texts.map(t => [t.id, t.name])], ac.text_template_id || ''), true))),
        h('p', { class: 'hint span-2' }, 'Bei Frist- und Statuswechsel-Regeln wird der Entwurf an die jeweilige Aufgabe gehängt. Variablen ohne Wert bleiben als [[name]] sichtbar.'));
    } else if (a === 'erinnern') {
      const v = h('input', { type: 'checkbox', checked: !!ac.auch_vertretung });
      aBox.append(h('div', { class: 'span-2' }, field('Nachricht (optional)', bind(ac, 'message', input({ value: ac.message || '', placeholder: 'Standard: „Erinnerung: {{aufgabe}} ist am {{frist}} fällig.“' })))),
        h('label', { class: 'check span-2' }, bind(ac, 'auch_vertretung', v), h('span', {}, 'auch die Vertretung erinnern')));
    } else if (a === 'uebersicht') {
      aBox.append(h('p', { class: 'hint span-2' }, 'Erstellt eine Übersicht offener, überfälliger, wartender und lange liegender Aufgaben und benachrichtigt die Admins.'));
    } else if (a === 'kalendereintrag') {
      aBox.append(h('div', { class: 'span-2' }, field('Titel', bind(ac, 'title', input({ value: ac.title || '' })))),
        field('Datum (leer = Fälligkeit der Aufgabe)', bind(ac, 'datum', input({ type: 'date', value: ac.datum || '' }))),
        field('Uhrzeit', bind(ac, 'uhrzeit', input({ type: 'time', value: ac.uhrzeit || '' }))),
        h('div', { class: 'span-2' }, field('Ort', bind(ac, 'ort', input({ value: ac.ort || '' })))),
        h('p', { class: 'hint span-2' }, 'Stufe 3: Vor jeder Ausführung entsteht eine Freigabe-Anfrage. Erst nach dem Ja eines Admins erscheint der Termin im Kalender-Abo.'));
    }
    const min = meta.actions[a]?.minLevel ?? 0;
    [...level.options].forEach(o => { o.disabled = Number(o.value) < min; });
    if (Number(level.value) < min) level.value = String(min);
    updLevel();
  };
  const updLevel = () => {
    const t = state.processTemplates.find(x => String(x.id) === tpl.value);
    levelInfo.textContent = `${LEVEL_HINT[level.value]}${t ? ` · Höchststufe von „${t.name}“: ${t.max_level}` : ''}`;
    levelInfo.classList.toggle('warn-text', !!t && Number(level.value) > t.max_level);
  };
  trigger.addEventListener('change', () => { Object.keys(tc).forEach(k => delete tc[k]); drawTrigger(); });
  action.addEventListener('change', () => { Object.keys(ac).forEach(k => delete ac[k]); drawAction(); });
  level.addEventListener('change', updLevel); tpl.addEventListener('change', updLevel);
  drawTrigger(); drawAction();
  const note = input({ placeholder: 'Was wurde geändert?' });
  const ok = await modal({ title: r.id ? `Regel „${r.name}“` : 'Neue Regel', wide: true,
    body: h('div', {},
      h('div', { class: 'form-grid' }, h('div', { class: 'span-2' }, field('Name', name)), h('div', { class: 'span-2' }, field('Beschreibung', desc)),
        field('Bereich', area), field('Vorgangstyp', tpl, 'Die Stufe darf dessen Höchststufe nicht überschreiten.')),
      h('h4', { class: 'mt' }, 'Auslöser'), field('Wann?', trigger), tBox,
      h('h4', { class: 'mt' }, 'Aktion'), field('Was?', action), aBox,
      h('h4', { class: 'mt' }, 'Stufe'), field('Automatisierungsstufe', level), levelInfo,
      r.id ? field('Änderungsnotiz', note, 'Nach einer Änderung muss die Regel erneut freigegeben werden.') : h('p', { class: 'hint' }, 'Neue Regeln sind zunächst inaktiv und müssen von einem Admin freigegeben werden.')),
    actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Speichern', kind: 'primary', onClick: async () => {
      const check = await api.post('/api/automation/check', { action_type: action.value, action_config: ac });
      if (!check.allowed) throw new Error(check.reason);
      const b = { name: name.value, description: desc.value, area_id: area.value ? Number(area.value) : null, template_id: tpl.value ? Number(tpl.value) : null,
        trigger_type: trigger.value, trigger_config: tc, action_type: action.value, action_config: ac, level: Number(level.value), note: note.value };
      return r.id ? api.put(`/api/rules/${r.id}`, b) : api.post('/api/rules', b);
    } }] });
  if (ok) { toast(r.id ? 'Gespeichert – bitte erneut freigeben' : 'Regel angelegt – wartet auf Freigabe'); done(); }
}

// ---------- Freigaben (AUT-6, AUT-7) ----------

async function approvals(el) {
  let status = 'offen';
  const list = h('div', { class: 'stack' });
  const selected = new Set();
  const bulk = h('div', { class: 'bulk-bar', hidden: true });
  const updBulk = (rows) => {
    bulk.hidden = !selected.size;
    clear(bulk, h('strong', {}, `${selected.size} ausgewählt`),
      button('Ausgewählte ablehnen', () => batch(false), { kind: 'ghost' }),
      button('Ausgewählte freigeben', () => batch(true), { kind: 'primary', iconName: 'check' }));
  };
  const batch = async (approve) => {
    const items = [...selected];
    const ok = await confirmDialog(`${items.length} Ausführung(en) ${approve ? 'freigeben' : 'ablehnen'}? Jede Freigabe wird einzeln mit deinem Namen protokolliert. Nachrichten an viele Empfänger musst du einzeln bestätigen.`, { ok: approve ? 'Freigeben' : 'Ablehnen', danger: !approve });
    if (!ok) return;
    const r = await api.post('/api/approvals/decide-batch', { ids: items, approve });
    const done = r.results.filter(x => ['ausgefuehrt', 'abgelehnt'].includes(x.status)).length;
    const failed = r.results.filter(x => !['ausgefuehrt', 'abgelehnt'].includes(x.status));
    toast(`${done} erledigt${failed.length ? `, ${failed.length} mit Hinweis: ${failed.map(f => f.result).join('; ')}` : ''}`, failed.length ? 'warn' : 'ok', 7000);
    selected.clear(); load(); refreshMe();
  };
  const load = async () => {
    const rows = await api.get(`/api/approvals?status=${status}`);
    selected.clear(); updBulk();
    clear(list, rows.length ? rows.map(a => h('article', { class: `card pad approval ap-${a.status}` },
      h('div', { class: 'ap-head' }, h('div', { class: 'rule-title' },
        a.status === 'offen' && isAdmin() ? h('input', { type: 'checkbox', 'aria-label': 'Auswählen', onchange: (e) => { e.target.checked ? selected.add(a.id) : selected.delete(a.id); updBulk(); } }) : null,
        h('strong', {}, a.summary)), h('span', { class: `pill ap-${a.status}` }, a.status)),
      h('div', { class: 'small muted' }, [a.area_name, a.rule_name ? `Regel „${a.rule_name}“` : null, a.task_id ? null : null, `angefragt ${fmtDateTime(a.requested_at)}${a.requested_by_name ? ' von ' + a.requested_by_name : ' automatisch'}`].filter(Boolean).join(' · '),
        a.task_id ? [' · ', h('a', { href: `#/aufgabe/${a.task_id}` }, a.task_title)] : null),
      a.recipients.length ? h('details', {}, h('summary', {}, `${a.recipients.length} Empfänger`), h('ol', {}, a.recipients.map(n => h('li', {}, n)))) : null,
      h('pre', { class: 'payload small' }, Object.entries(a.payload).filter(([k]) => PAYLOAD_LABEL[k] && a.payload[k]).map(([k, v]) => `${PAYLOAD_LABEL[k]}: ${k === 'date' ? fmtDate(v) : v}`).join('\n')),
      a.decided_at ? h('div', { class: `small ${a.status === 'fehler' ? 'warn-text' : ''}` }, `${a.status === 'abgelehnt' ? 'Abgelehnt' : 'Freigegeben'} von ${a.decided_by_name} am ${fmtDateTime(a.decided_at)}${a.decision_note ? ' – ' + a.decision_note : ''}`, a.result ? h('div', { class: 'muted' }, a.result) : null) : null,
      a.status === 'offen' && isAdmin() ? h('div', { class: 'btn-row' },
        button('Ablehnen', () => decide(a, false), { kind: 'ghost' }),
        button('Ja, ausführen', () => decide(a, true), { kind: 'primary', iconName: 'check' })) : null))
      : emptyState(status === 'offen' ? 'Keine offenen Freigaben.' : 'Nichts in dieser Liste.'));
  };
  const decide = async (a, approve) => {
    const note = input({ placeholder: 'Notiz (optional)' });
    let confirmRecipients = false;
    const body = h('div', {}, h('p', {}, approve ? 'Du gibst diese Ausführung frei. Person und Zeitpunkt werden protokolliert.' : 'Ausführung ablehnen?'), h('p', {}, h('strong', {}, a.summary)), field('Notiz', note));
    if (approve && a.recipients.length >= 5) {
      const c = h('input', { type: 'checkbox' });
      body.append(h('div', { class: 'warn-box' }, h('div', {}, h('strong', {}, `${a.recipients.length} Empfänger:`), h('ol', {}, a.recipients.map(n => h('li', {}, n))), h('label', { class: 'check' }, c, h('span', {}, 'Empfängerliste geprüft')))));
      c.addEventListener('change', () => { confirmRecipients = c.checked; });
    }
    const ok = await modal({ title: approve ? 'Freigeben' : 'Ablehnen', body, actions: [{ label: 'Abbrechen', kind: 'ghost' },
      { label: approve ? 'Freigeben' : 'Ablehnen', kind: approve ? 'primary' : 'danger', onClick: () => api.post(`/api/approvals/${a.id}/decide`, { approve, note: note.value, confirmRecipients }) }] });
    if (ok) { toast(!approve ? 'Abgelehnt' : ok.status === 'fehler' ? `Fehler bei der Ausführung: ${ok.result}` : `Ausgeführt: ${ok.result || ''}`, ok.status === 'fehler' ? 'error' : 'ok', 6000); load(); refreshMe(); }
  };
  const render = () => {
    clear(el, tabs([['offen', 'Offen'], ['ausgefuehrt', 'Ausgeführt'], ['abgelehnt', 'Abgelehnt'], ['fehler', 'Fehler'], ['alle', 'Alle']], status, (k) => { status = k; render(); }), bulk, list);
    load().catch(errorToast);
  };
  render();
}

async function runs(el) {
  const rows = await api.get('/api/rule-runs');
  clear(el, rows.length ? h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Zeit'), h('th', {}, 'Regel'), h('th', {}, 'Anlass'), h('th', {}, 'Ergebnis'), h('th', {}, 'Details'))),
    h('tbody', {}, rows.map(r => h('tr', {}, h('td', { class: 'nowrap' }, fmtDateTime(r.started_at)), h('td', {}, r.rule_name || '—'), h('td', { class: 'small' }, r.trigger),
      h('td', {}, h('span', { class: `pill ${OUTCOME[r.outcome]?.[1] || ''}` }, OUTCOME[r.outcome]?.[0] || r.outcome)), h('td', { class: 'small' }, r.detail))))) : emptyState('Noch keine Läufe.'));
}

async function reports(el, id) {
  const list = await api.get('/api/reports');
  const view = h('div');
  const show = async (rid) => {
    const r = await api.get(`/api/reports/${rid}`);
    const c = r.content;
    const LABEL = { offen: 'offen', ueberfaellig: 'überfällig', diese_woche: 'diese Woche', wartet: 'warten', liegt_lange: 'liegen lange', eingang: 'im Eingang', freigaben: 'Freigaben',
      erledigt: 'erledigt', begonnen: 'begonnen', stunden: 'Stunden erfasst' };
    const k = c.kennzahlen;
    clear(view, h('section', { class: 'card pad report' }, h('h2', {}, c.title),
      h('div', { class: 'stats small-stats' }, Object.entries(c.totals).map(([key, v]) => h('div', { class: 'stat' }, h('strong', {}, (v ?? 0).toLocaleString('de-DE')), h('span', {}, LABEL[key] || key)))),
      k ? h('p', {}, `Mittlere Liegezeit ${k.liegezeit_mittel ?? '—'} Tage (Ziel ${k.ziel}${k.ziel_erreicht == null ? '' : k.ziel_erreicht ? ', erreicht' : ', verfehlt'}) · mittlere Durchlaufzeit ${k.durchlaufzeit_mittel ?? '—'} Tage`) : null,
      c.sections.map(s => h('div', { class: 'mt' }, h('h3', {}, s.title, h('span', { class: 'count' }, s.items.length)),
        s.items.length ? h('ul', { class: 'mini-list' }, s.items.map(t => h('li', {}, h('a', { href: `#/aufgabe/${t.id}` }, t.title), h('small', { class: 'muted' }, [t.area, t.owner, t.due_date ? fmtDate(t.due_date) : null, t.waiting_who ? `wartet auf ${t.waiting_who}` : null].filter(Boolean).join(' · '))))) : h('p', { class: 'muted small' }, '—')))));
  };
  clear(el, h('div', { class: 'toolbar' }, h('p', { class: 'muted' }, 'Übersichten offener Aufgaben und Anfragen (AUT-13).'), h('div', { class: 'btn-row' }, isAdmin() ? button('Monatsbericht erstellen', async () => { const r = await api.post('/api/reports/monthly'); reports(el, r.id); }, { kind: 'ghost', iconName: 'chart' }) : null,
      button('Übersicht erstellen', async () => { const r = await api.post('/api/reports/overview', {}); reports(el, r.id); }, { kind: 'primary', iconName: 'plus' }))),
    h('div', { class: 'split' }, h('nav', { class: 'list-nav' }, list.map(r => h('a', { href: `#/automatisierung/berichte?id=${r.id}`, class: `list-link ${String(r.id) === String(id) ? 'active' : ''}`, onclick: (e) => { e.preventDefault(); show(r.id); } }, r.title, h('small', {}, fmtDateTime(r.created_at))))),
      view));
  if (id || list[0]) await show(id || list[0].id);
  else clear(view, emptyState('Noch keine Übersicht erstellt.'));
}

export { areaChip, statusPill, officeOptions };
