// Einrichtungsassistent: Schritt für Schritt von der leeren App bis zum Betrieb.

import { api } from '../api.js';
import { h, clear, pageHeader, button, iconButton, select, input, textarea, field, modal, toast, errorToast, confirmDialog, copyText, icon, MONTHS, FREQ } from '../ui.js';
import { state, loadState, refreshLookups, refreshCatalog, userOptions } from '../state.js';

export default async function setup(el, { query = {} }) {
  let st = await api.get('/api/setup');
  let current = query.schritt || st.steps.find(s => !s.marked && !s.ok)?.key || st.steps[0].key;
  const nav = h('nav', { class: 'list-nav setup-nav' });
  const panel = h('div', { class: 'list-main' });

  const refresh = async () => { st = await api.get('/api/setup'); drawNav(); };
  const mark = async (key, done = true) => { st = await api.post('/api/setup/step', { key, done }); drawNav(); };
  const next = async (key) => {
    await mark(key);
    const i = st.steps.findIndex(s => s.key === key);
    if (i < st.steps.length - 1) go(st.steps[i + 1].key);
    else draw();
  };
  const go = (key) => { current = key; history.replaceState(null, '', `#/einrichtung?schritt=${key}`); drawNav(); draw(); };

  function drawNav() {
    const doneCount = st.steps.filter(s => s.marked || s.ok).length;
    clear(nav, h('div', { class: 'setup-progress' }, h('strong', {}, `${doneCount} von ${st.steps.length}`), h('span', { class: 'muted small' }, ' Schritten erledigt'),
      (() => { const p = h('span', { class: 'progress wide' }, h('span', {})); p.firstChild.style.width = `${Math.round(doneCount / st.steps.length * 100)}%`; return p; })()),
    st.steps.map((s, i) => h('a', { href: '#', class: `list-link setup-step ${s.key === current ? 'active' : ''}`, onclick: (e) => { e.preventDefault(); go(s.key); } },
      h('span', { class: `step-no ${s.marked || s.ok ? 'done' : ''}` }, s.marked || s.ok ? '✓' : i + 1),
      h('span', {}, s.title, h('small', {}, s.text)))));
  }

  async function draw() {
    const s = st.steps.find(x => x.key === current);
    const footer = (extra) => h('div', { class: 'btn-row setup-footer' }, extra || null, h('span', { class: 'spacer' }),
      s.marked ? button('Als offen markieren', () => mark(s.key, false).then(draw), { kind: 'ghost' }) : null,
      button(s.key === 'start' ? 'Einrichtung abschließen' : 'Erledigt – weiter', () => next(s.key).then(() => { if (s.key === 'start') { toast('Einrichtung abgeschlossen. Viel Erfolg!'); location.hash = '#/start'; } }), { kind: 'primary', iconName: 'check' }));
    const head = h('header', { class: 'setup-head' }, h('h2', {}, s.title), h('p', { class: 'muted' }, s.hint), h('div', { class: `conn-status ${s.ok ? 'ok' : 'off'}` }, icon(s.ok ? 'check' : 'clock', 16), h('div', {}, s.text)));
    const body = h('div', { class: 'setup-body' }, h('div', { class: 'loading' }, h('span', { class: 'spin' }), 'Lädt …'));
    clear(panel, h('section', { class: 'card pad' }, head, body, footer()));
    // refresh: Schritt neu zeichnen; refreshNav: nur den Stand links aktualisieren (offene Felder bleiben offen)
    try { await STEP_VIEWS[s.key](body, { refresh: async () => { await refresh(); await draw(); }, refreshNav: refresh }); }
    catch (e) { clear(body, h('p', { class: 'warn-text' }, e.message)); }
  }

  clear(el, pageHeader('Einrichtung', 'Von der leeren App bis zum Betrieb. Jeder Schritt lässt sich später im Adminpanel ändern; nichts davon ist endgültig.'),
    h('div', { class: 'split setup-split' }, nav, panel));
  drawNav();
  await draw();
}

// ---------- Schritte ----------

const STEP_VIEWS = {
  async verein(el, { refresh }) {
    const areas = await api.get('/api/areas');
    const name = input({ placeholder: 'z. B. TTC Beispielstadt' });
    const type = select([['verein', 'Verein'], ['bezirk', 'Bezirk']], 'verein');
    clear(el,
      h('p', {}, 'Je Verein ein Bereich, dazu einer für den Bezirk. Daten sind je Bereich getrennt (Mitgliederdaten, Finanzen, Protokolle); Vorlagen und Regelwissen sind teilbar. Neue Bereiche bekommen die üblichen Ämter und den Jahreskalender.'),
      h('table', { class: 'table' }, h('tbody', {}, areas.map(a => {
        const n = input({ value: a.name });
        const c = input({ type: 'color', value: a.color });
        const save = async () => { try { await api.put(`/api/areas/${a.id}`, { name: n.value, color: c.value }); await loadState(); toast('Gespeichert'); } catch (e) { errorToast(e); } };
        n.addEventListener('change', save); c.addEventListener('change', save);
        return h('tr', { class: a.active ? '' : 'inactive' }, h('td', {}, n), h('td', {}, a.type === 'bezirk' ? 'Bezirk' : 'Verein'), h('td', {}, c),
          h('td', { class: 'actions' }, iconButton('trash', async () => {
            if (!(await confirmDialog(`Bereich „${a.name}“ entfernen? Das geht nur, solange er leer ist.`, { danger: true, ok: 'Entfernen' }))) return;
            try { await api.del(`/api/areas/${a.id}`); toast(`Bereich „${a.name}“ entfernt`); await loadState(); await refresh(); } catch (e) { errorToast(e); }
          }, 'Leeren Bereich entfernen')));
      }))),
      h('div', { class: 'inline-form mt' }, name, type, button('Bereich hinzufügen', async () => {
        try { await api.post('/api/areas', { name: name.value, type: type.value }); await loadState(); await refresh(); } catch (e) { errorToast(e); }
      }, { kind: 'ghost', iconName: 'plus' })));
  },

  async personen(el, { refresh, refreshNav }) {
    const [users, offices] = await Promise.all([api.get('/api/users'), api.get('/api/offices')]);
    const name = input({ placeholder: 'Vor- und Nachname' });
    const login = input({ placeholder: 'anmeldename' });
    const role = select([['admin', 'Admin'], ['zuarbeit', 'Zuarbeit']], 'admin');
    const byArea = new Map();
    for (const o of offices) { if (!byArea.has(o.area_name)) byArea.set(o.area_name, []); byArea.get(o.area_name).push(o); }
    clear(el,
      h('h4', {}, 'Konten'),
      h('ul', { class: 'mini-list' }, users.filter(u => u.active).map(u => h('li', {}, h('span', {}, u.name), h('small', { class: 'muted' }, `${u.login} · ${u.role === 'admin' ? 'Admin' : 'Zuarbeit'}`)))),
      h('div', { class: 'inline-form' }, name, login, role, button('Konto anlegen', async () => {
        try {
          const r = await api.post('/api/users', { name: name.value, login: login.value.toLowerCase(), role: role.value, areas: state.me.areas.map(a => a.id) });
          await modal({ title: 'Vorläufiges Passwort', body: h('div', {}, h('p', {}, `Für ${name.value}. Es muss bei der ersten Anmeldung geändert werden und wird nur jetzt angezeigt.`),
            h('div', { class: 'copy-row' }, h('code', { class: 'pw' }, r.temporaryPassword), button('Kopieren', () => copyText(r.temporaryPassword), { iconName: 'copy' }))) });
          await refreshLookups(); await refresh();
        } catch (e) { errorToast(e); }
      }, { kind: 'ghost', iconName: 'plus' })),
      h('p', { class: 'hint' }, 'Empfehlung: mindestens zwei Admins, damit Freigaben und Vertretung funktionieren.'),
      h('h4', { class: 'mt' }, 'Ämter: Inhaber und Vertretung'),
      [...byArea].map(([area, list]) => h('details', { class: 'card pad-sm', open: byArea.size === 1 }, h('summary', {}, h('strong', {}, area), h('span', { class: 'muted small office-count' }, ` · ${list.filter(o => o.holder_id).length}/${list.length} besetzt`)),
        h('table', { class: 'table small' }, h('tbody', {}, list.map(o => {
          const hs = select(userOptions('— unbesetzt —'), o.holder_id);
          const ds = select(userOptions('— keine —'), o.deputy_id);
          const save = async () => {
            try {
              await api.put(`/api/offices/${o.id}`, { holder_id: hs.value ? Number(hs.value) : null, deputy_id: ds.value ? Number(ds.value) : null });
              await refreshLookups();
              const box = hs.closest('details');
              box.querySelector('.office-count').textContent = ` · ${[...box.querySelectorAll('tr')].filter(tr => tr.querySelector('select').value).length}/${box.querySelectorAll('tr').length} besetzt`;
              await refreshNav();
            } catch (e) { errorToast(e); }
          };
          hs.addEventListener('change', save); ds.addEventListener('change', save);
          return h('tr', {}, h('td', {}, o.name), h('td', {}, hs), h('td', {}, ds));
        }))))));
  },

  async satzung(el) {
    const s = await api.get('/api/settings');
    const keys = ['einladung_frist_tage', 'antrag_frist_tage', 'kuendigung_frist_monate', 'budget_reserve', 'liegezeit_ziel_tage'];
    const inputs = Object.fromEntries(keys.map(k => [k, input({ type: 'number', value: s[k].value ?? '' })]));
    const stufen = (s.beitragsstufen.value || []).map(x => ({ ...x }));
    const tbl = h('div');
    const drawStufen = () => clear(tbl, h('table', { class: 'table small' }, h('thead', {}, h('tr', {}, h('th', {}, 'Stufe'), h('th', {}, 'ab Alter'), h('th', {}, 'bis Alter'), h('th', {}, '€ / Jahr'), h('th', {}))),
      h('tbody', {}, stufen.map((st, i) => {
        const mk = (k, t = 'text') => { const x = input({ type: t, value: st[k] ?? '' }); x.addEventListener('input', () => { st[k] = x.value; }); return x; };
        return h('tr', {}, h('td', {}, mk('name')), h('td', {}, mk('ab_alter', 'number')), h('td', {}, mk('bis_alter', 'number')), h('td', {}, mk('beitrag', 'number')), h('td', {}, iconButton('trash', () => { stufen.splice(i, 1); drawStufen(); }, 'Entfernen')));
      }))), button('Stufe hinzufügen', () => { stufen.push({ name: '', ab_alter: 0, bis_alter: '', beitrag: 0 }); drawStufen(); }, { kind: 'ghost', iconName: 'plus' }));
    drawStufen();
    clear(el, h('p', {}, 'Diese Werte stehen in eurer Satzung bzw. Beitragsordnung. Die Rechner (Einladungsfrist, Kündigung, Beitragsstufe, Budget) und die Kennzahlen verwenden sie.'),
      h('div', { class: 'form-grid' }, keys.map(k => field(s[k].label, inputs[k]))), h('h4', {}, 'Beitragsstufen'), tbl,
      button('Speichern', async () => {
        const b = { beitragsstufen: stufen };
        for (const k of keys) b[k] = inputs[k].value;
        try { await api.put('/api/settings', b); toast('Gespeichert'); } catch (e) { errorToast(e); }
      }, { kind: 'primary' }));
  },

  async datenschutz(el) {
    const s = await api.get('/api/settings');
    const sw = (k) => { const c = h('input', { type: 'checkbox', class: 'switch', checked: !!s[k].value }); c.addEventListener('change', async () => { try { await api.put('/api/settings', { [k]: c.checked }); await refreshCatalog(); toast('Gespeichert'); } catch (e) { errorToast(e); } }); return c; };
    clear(el,
      h('ul', { class: 'ampel' },
        h('li', { class: 'rot' }, h('strong', {}, 'Rot – nie: '), 'Gesundheitsangaben, Zugangsdaten. Die App nimmt sie nicht an.'),
        h('li', { class: 'gelb' }, h('strong', {}, 'Gelb – nur im einzelnen Vorgang: '), 'Stammdaten, Bankdaten, Daten Minderjähriger.'),
        h('li', { class: 'gruen' }, h('strong', {}, 'Grün – dauerhaft: '), 'Satzung, Ordnungen, Vorlagen, öffentliche Spielpläne.')),
      h('div', { class: 'privacy-switch' }, sw('gelb_lokal'), h('div', {}, h('strong', {}, 'Gelbe Daten lokal automatisch verarbeiten'),
        h('p', { class: 'small muted' }, 'Regeln für gelbe Vorgänge (z. B. Willkommensmail-Entwurf bei Neuaufnahme), meinVerein-Prüfung der Beitragsstufen, Löschfrist für gelbe Anhänge. Die Daten verlassen diesen Server dabei nicht. Das könnt ihr als Verein selbst entscheiden.'))),
      h('div', { class: 'privacy-switch' }, sw('gelb_extern'), h('div', {}, h('strong', {}, 'Gelbe Daten an Microsoft 365 geben'),
        h('p', { class: 'small muted' }, 'Gelbe Dateien als SharePoint-Kopie, Entwürfe gelber Vorgänge ins Postfach. Jeweils nur nach Freigabe. Erst einschalten, wenn die Auftragsverarbeitung geklärt ist (Anfrage beim Verband/Sportbund).'))),
      h('p', { class: 'hint' }, 'Der KI-Assistent bekommt unabhängig davon nie gelbe Daten.'));
  },

  async verbindungen(el) {
    const [c, ki] = await Promise.all([api.get('/api/connections'), api.get('/api/ki/status')]);
    const row = (ok, title, text, href, linkText) => h('div', { class: `conn-status ${ok ? 'ok' : 'off'}` }, icon(ok ? 'check' : 'alert', 16),
      h('div', {}, h('strong', {}, title), h('div', { class: 'small muted' }, text), href ? h('a', { href, class: 'small' }, linkText) : null));
    clear(el, h('p', {}, 'Alles hier ist optional. Ohne Verbindungen arbeitet die App mit Eingang per Hand oder .eml-Datei und dem Kalender-Abo.'),
      row(c.m365.configured, 'Microsoft 365 (Postfach, Kalender, Ablage)', c.m365.configured ? `${c.m365.settings.mailboxes.length} Postfach/Postfächer verbunden` : c.m365.credentials ? 'Zugangsdaten sind in der .env – jetzt Postfächer eintragen.' : 'App-Registrierung anlegen, Zugangsdaten in die .env (Anleitung docs/MICROSOFT-365.md).', '#/admin/verbindungen', 'Zu den Verbindungen →'),
      row(c.feeds.length > 0, 'Spielpläne (click-TT/nuLiga)', c.feeds.length ? `${c.feeds.length} Spielplan-Abo(s)` : 'Je Mannschaft den Kalender-Export (iCal) eintragen – dann kommen Heimspiele als Aufgaben.', '#/admin/verbindungen', 'Spielplan hinzufügen →'),
      row(ki.key && ki.sdk, 'Claude (KI-Assistent)', ki.key ? (ki.sdk ? `Schlüssel vorhanden, Modell ${ki.model}` : ki.sdkError) : 'ANTHROPIC_API_KEY in die .env eintragen (docs/KI.md). Optional.', '#/automatisierung/ki', 'Zum KI-Assistenten →'),
      row(true, 'Kalender-Abo', 'Jede Person findet ihren persönlichen Abo-Link unter Kalender → Kalender-Abo.', '#/kalender/abo', 'Abo-Link →'));
  },

  async automatisierung(el, { refresh }) {
    const st = await api.get('/api/setup');
    const approve = h('input', { type: 'checkbox', checked: true });
    clear(el, h('p', {}, 'Eine Voreinstellung für den Automatisierungskatalog. Jede Automatik lässt sich danach einzeln ändern (Adminpanel → Automatisierungen).'),
      h('div', { class: 'preset-grid' }, Object.entries(st.presets).map(([k, p]) => h('article', { class: `card pad preset ${st.preset === k ? 'chosen' : ''}` },
        h('h3', {}, p.label, k === 'empfohlen' ? h('span', { class: 'badge badge-level' }, 'Empfehlung') : null), h('p', { class: 'small' }, p.description),
        button(st.preset === k ? 'Gewählt' : 'Wählen', async () => {
          try { const r = await api.post('/api/setup/preset', { preset: k, approve_examples: approve.checked }); await refreshCatalog(); toast(`${p.label}: ${r.changes.length} Änderung(en)${r.approved ? `, ${r.approved} Beispielregel(n) freigegeben` : ''}`); refresh(); } catch (e) { errorToast(e); }
        }, { kind: st.preset === k ? 'ghost' : 'primary' })))),
      h('label', { class: 'check mt' }, approve, h('span', {}, 'Beispielregeln (Wochenübersicht, Erinnerung 3 Tage vor Frist, Willkommensmail-Entwurf) gleich freigeben')));
  },

  async kalender(el, { refresh }) {
    const rows = await api.get('/api/recurring');
    const sel = new Set(rows.filter(r => r.assumption).map(r => r.id));
    clear(el, h('p', {}, 'Diese Termine sind Schätzungen. Bitte Monat und Tag anpassen, dann bestätigen. Aufgaben entstehen jeweils mit dem Vorlauf vor dem Termin.'),
      h('table', { class: 'table small' }, h('thead', {}, h('tr', {}, h('th', {}), h('th', {}, 'Bereich'), h('th', {}, 'Was'), h('th', {}, 'Rhythmus'), h('th', {}, 'Monat'), h('th', {}, 'Tag'), h('th', {}, 'Vorlauf'))),
        h('tbody', {}, rows.map(r => {
          const cb = h('input', { type: 'checkbox', checked: !!r.assumption, disabled: !r.assumption, 'aria-label': 'Bestätigen' });
          cb.addEventListener('change', () => { cb.checked ? sel.add(r.id) : sel.delete(r.id); });
          const m = select(MONTHS.map((x, i) => [i + 1, x]), r.month || 1, { disabled: ['monatlich', 'woechentlich'].includes(r.freq) });
          const d = input({ type: 'number', min: 1, max: 31, value: r.day || 1, class: 'w-small' });
          const l = input({ type: 'number', min: 0, max: 180, value: r.lead_days, class: 'w-small' });
          const save = async () => { try { await api.put(`/api/recurring/${r.id}`, { month: Number(m.value), day: Number(d.value), lead_days: Number(l.value) }); } catch (e) { errorToast(e); } };
          m.addEventListener('change', save); d.addEventListener('change', save); l.addEventListener('change', save);
          return h('tr', {}, h('td', {}, r.assumption ? cb : h('span', { class: 'good-text' }, '✓')), h('td', {}, r.area_name), h('td', {}, r.title), h('td', {}, FREQ[r.freq]), h('td', {}, m), h('td', {}, d), h('td', {}, l));
        }))),
      button('Markierte Termine bestätigen', async () => { await api.post('/api/setup/confirm-calendar', { ids: [...sel] }); toast('Bestätigt'); refresh(); }, { kind: 'primary', iconName: 'check' }));
  },

  async wissen(el, { refresh }) {
    const docs = await api.get('/api/kb/documents');
    const title = input({ placeholder: 'z. B. Satzung TTC Beispielstadt' });
    const type = select([['satzung', 'Satzung'], ['ordnung', 'Ordnung'], ['beschluss', 'Vorstandsbeschluss']], 'satzung');
    const area = select([['', 'Alle Bereiche (teilbar)'], ...state.me.areas.map(a => [a.id, a.name])], state.me.areas.find(a => a.type === 'verein')?.id || '');
    const text = textarea({ rows: 10, class: 'mono', placeholder: '§ 1 Name und Sitz\nDer Verein führt den Namen …\n\n§ 2 Zweck\n…' });
    clear(el, h('p', {}, 'Satzung und Ordnungen sind die Grundlage für die Auskunft: Jede Antwort nennt ihre Fundstelle. Text aus dem PDF kopieren und einfügen – Überschriften wie „§ 5 …“ werden automatisch zu Fundstellen.'),
      docs.length ? h('ul', { class: 'mini-list' }, docs.map(d => h('li', {}, h('span', {}, d.title), h('small', { class: 'muted' }, `${d.sections} Abschnitte`)))) : null,
      h('div', { class: 'form-grid' }, field('Titel', title), field('Art', type), field('Bereich', area), h('div', { class: 'span-2' }, field('Text', text))),
      button('In die Wissensbasis aufnehmen', async () => {
        try { await api.post('/api/kb/documents', { title: title.value, source_type: type.value, area_id: area.value ? Number(area.value) : null, text: text.value }); toast('Aufgenommen'); refresh(); }
        catch (e) { errorToast(e); }
      }, { kind: 'primary', iconName: 'book' }));
  },

  async start(el) {
    const link = (href, ic, title, text) => h('a', { class: 'card pad start-link', href }, icon(ic, 18), h('div', {}, h('strong', {}, title), h('div', { class: 'small muted' }, text)));
    clear(el, h('p', {}, 'Die Grundlagen stehen. Ein paar gute erste Schritte:'),
      h('div', { class: 'preset-grid' },
        link('#/admin/import', 'upload', 'Asana übernehmen', 'Bestehende Aufgaben einmalig importieren.'),
        link('#/eingang?tab=regeln', 'folder', 'Ablageregeln', 'Wohin Mailanhänge kommen sollen.'),
        link('#/vorgaenge', 'flow', 'Vorgangsvorlagen prüfen', 'Anleitungen an eure Abläufe anpassen.'),
        link('#/automatisierung/ki', 'zap', 'Mit KI automatisieren', 'Anliegen beschreiben, Vorschläge übernehmen.'),
        link('#/hilfe', 'help', 'Hilfe und FAQ', 'Grundsätze, Tastenkürzel, Antworten.'),
        link('#/start', 'home', 'Zur Übersicht', 'Mit der täglichen Arbeit beginnen.')));
  },
};
