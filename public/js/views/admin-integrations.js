// Adminpanel: Automatisierungskatalog, Verbindungen (Microsoft 365, Spielpläne, meinVerein), Datenschutz-Auskunft.

import { api, qs } from '../api.js';
import { h, clear, button, iconButton, select, input, textarea, field, modal, toast, errorToast, confirmDialog, emptyState, fmtDateTime, fmtDate, relTime, icon, LEVELS, levelBadge, today } from '../ui.js';
import { state, areaOptions, userOptions, templateOptions, refreshCatalog } from '../state.js';

// ---------- Automatisierungskatalog ----------

export async function catalogTab(el) {
  const items = await api.get('/api/catalog');
  const changes = {};
  const saveBtn = button('Änderungen speichern', save, { kind: 'primary', disabled: true });
  const mark = () => { saveBtn.disabled = !Object.keys(changes).length; };
  const set = (key, part, name, value) => {
    changes[key] ||= {};
    if (part === 'enabled') changes[key].enabled = value;
    else changes[key].params = { ...(changes[key].params || {}), [name]: value };
    mark();
  };
  async function save() {
    try {
      const r = await api.put('/api/catalog', changes);
      toast(r.changes.length ? `${r.changes.length} Änderung(en) gespeichert` : 'Keine Änderungen');
      await refreshCatalog();
      catalogTab(el);
    } catch (e) { errorToast(e); }
  }
  const groups = [...new Set(items.map(i => i.group))];
  const card = (c) => {
    const toggle = h('input', { type: 'checkbox', class: 'switch', checked: c.enabled, 'aria-label': `${c.label} einschalten` });
    toggle.addEventListener('change', () => set(c.key, 'enabled', null, toggle.checked));
    const params = c.params.map(p => {
      let ctl;
      if (p.type === 'boolean') { ctl = h('input', { type: 'checkbox', checked: !!p.value }); ctl.addEventListener('change', () => set(c.key, 'param', p.name, ctl.checked)); return h('label', { class: 'check small' }, ctl, h('span', {}, p.label)); }
      if (p.type === 'select') ctl = select(p.options, p.value);
      else ctl = input({ type: p.type === 'number' ? 'number' : 'text', value: p.value ?? '', min: 0, class: 'w-small' });
      ctl.addEventListener('change', () => set(c.key, 'param', p.name, p.type === 'number' ? (ctl.value === '' ? null : Number(ctl.value)) : ctl.value));
      return h('label', { class: 'param' }, h('span', {}, p.label), ctl);
    });
    const state_ = c.active ? ['aktiv', 'st-erledigt'] : c.enabled && c.missing.length ? ['wartet auf Voraussetzung', 'st-wartet'] : ['aus', 'st-offen'];
    return h('article', { class: `auto-item ${c.active ? 'on' : ''}` },
      h('div', { class: 'auto-toggle' }, toggle),
      h('div', { class: 'auto-body' },
        h('div', { class: 'auto-title' }, h('strong', {}, c.label), levelBadge(c.level), h('span', { class: `pill ${state_[1]}` }, state_[0]), c.source ? h('span', { class: 'muted small' }, c.source) : null),
        h('p', { class: 'small' }, c.description),
        c.missing.length ? h('div', { class: 'small warn-text' }, icon('alert', 12), ' ', c.missing.join(' · ')) : null,
        params.length ? h('div', { class: 'auto-params' }, params) : null));
  };
  clear(el,
    h('div', { class: 'toolbar' }, h('p', { class: 'muted' }, 'Alles, was die App selbstständig tun kann. Stufe 3 bedeutet: Die App schlägt vor, ausgeführt wird erst nach dem Ja eines Admins (Freigaben). Zahlungen, Bestellungen und Mailversand gibt es hier bewusst nicht.'), saveBtn),
    groups.map(g => h('section', { class: 'card auto-group' }, h('header', { class: 'card-head' }, h('h2', {}, g)), h('div', {}, items.filter(i => i.group === g).map(card)))),
    h('p', { class: 'muted small mt' }, 'Frei konfigurierbare Regeln (Auslöser → Aktion) stehen unter Automatisierungen → Regeln.'));
}

// ---------- Verbindungen ----------

export async function connectionsTab(el) {
  const d = await api.get('/api/connections');
  const s = d.m365.settings;
  const rows = s.mailboxes.map(m => ({ ...m }));
  const mbBox = h('div', { class: 'stack-sm full' });
  const drawMb = () => clear(mbBox, rows.map((m, i) => {
    const a = input({ value: m.address, placeholder: 'info@verein.de', type: 'email' }); a.addEventListener('input', () => { m.address = a.value.trim(); });
    const ar = select(areaOptions('— Bereich erkennen —'), m.area_id || ''); ar.addEventListener('change', () => { m.area_id = ar.value ? Number(ar.value) : null; });
    return h('div', { class: 'row-3' }, a, ar, iconButton('trash', () => { rows.splice(i, 1); drawMb(); }, 'Entfernen'));
  }), button('Postfach hinzufügen', () => { rows.push({ address: '', area_id: null }); drawMb(); }, { kind: 'ghost', iconName: 'plus' }));
  drawMb();
  const kal = input({ value: s.kalender_postfach, placeholder: 'termine@verein.de', type: 'email' });
  const ziel = input({ value: s.ablage_ziel, placeholder: 'users/ablage@verein.de/drive' });
  const ordner = input({ value: s.ablage_ordner });
  const testOut = h('div');
  const cred = d.m365.credentials;
  const lp = d.lastPoll;

  const m365Card = h('section', { class: 'card pad' },
    h('h2', {}, icon('cloud', 18), ' Microsoft 365'),
    h('div', { class: `conn-status ${d.m365.configured ? 'ok' : cred ? 'half' : 'off'}` },
      icon(d.m365.configured ? 'check' : 'alert', 16),
      h('div', {}, h('strong', {}, d.m365.configured ? 'Verbunden' : cred ? 'Zugangsdaten vorhanden – Postfach fehlt' : 'Nicht eingerichtet'),
        h('div', { class: 'small muted' }, cred ? `Mandant ${d.m365.tenant} · App ${d.m365.clientId}` : 'Zugangsdaten (Mandant, App-ID, geheimer Schlüssel) gehören in die Datei .env auf dem Server – nie in die Oberfläche. Anleitung: docs/MICROSOFT-365.md'),
        lp ? h('div', { class: 'small muted' }, `Letzter Postfach-Abruf ${relTime(lp.at)}: ${lp.created} neue Mail(s)${lp.errors?.length ? ' · Fehler: ' + lp.errors.join('; ') : ''}`) : null)),
    h('h4', {}, 'Funktionspostfächer (werden nur gelesen)'), mbBox,
    h('div', { class: 'form-grid mt' },
      field('Kalender-Postfach für Termine', kal, 'Hier landen freigegebene Termine (Stufe 3).'),
      field('Ablageort in SharePoint/OneDrive', ziel, 'z. B. users/ablage@verein.de/drive oder sites/<site-id>/drive'),
      field('Ordner in der Ablage', ordner, 'Darunter: Bereich/Jahr/Datei')),
    h('div', { class: 'btn-row' },
      button('Speichern', async () => {
        try { await api.put('/api/connections/m365', { mailboxes: rows.filter(r => r.address), kalender_postfach: kal.value, ablage_ziel: ziel.value, ablage_ordner: ordner.value }); toast('Gespeichert'); await refreshCatalog(); connectionsTab(el); }
        catch (e) { errorToast(e); }
      }, { kind: 'primary' }),
      button('Verbindung testen', async () => {
        clear(testOut, h('div', { class: 'loading' }, h('span', { class: 'spin' }), 'Teste …'));
        const r = await api.post('/api/connections/m365/test');
        clear(testOut, h('ul', { class: 'mini-list' }, r.results.map(x => h('li', {}, h('span', {}, x.ok ? '✓ ' : '✗ ', x.address), h('small', { class: x.ok ? 'good-text' : 'warn-text' }, x.info)))));
      }, { kind: 'ghost', disabled: !cred }),
      button('Postfächer jetzt abrufen', async () => {
        try { const r = await api.post('/api/inbox/poll'); toast(`${r.created} neue Mail(s)${r.errors?.length ? ' – Fehler: ' + r.errors.join('; ') : ''}`, r.errors?.length ? 'warn' : 'ok'); }
        catch (e) { errorToast(e); }
      }, { kind: 'ghost', iconName: 'inbox', disabled: !d.m365.configured })),
    testOut,
    h('p', { class: 'hint mt' }, 'Was die App mit Microsoft 365 darf: Mails lesen, nach Freigabe Entwürfe im Postfach ablegen, Termine eintragen und Dateien in die Ablage kopieren. Sie verschickt nie selbst und verändert keine Mails. Was davon aktiv ist, steuert der Automatisierungskatalog.'));

  // Spielpläne
  const feedCard = h('section', { class: 'card' },
    h('header', { class: 'card-head' }, h('h2', {}, icon('calendar', 18), ' Spielpläne (Kalender-Abos)'), button('Spielplan hinzufügen', () => feedDialog({}, () => connectionsTab(el)), { kind: 'primary', iconName: 'plus' })),
    d.feeds.length ? h('div', { class: 'table-scroll' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Bereich'), h('th', {}, 'Heimspiele'), h('th', {}, 'Letzter Abruf'), h('th', {}))),
      h('tbody', {}, d.feeds.map(f => h('tr', { class: f.active ? '' : 'inactive' },
        h('td', {}, h('strong', {}, f.name), h('div', { class: 'small muted' }, `${f.upcoming} künftige Termine`)),
        h('td', {}, f.area_name),
        h('td', { class: 'small' }, f.home_pattern ? `erkannt an „${f.home_pattern}“` : '—', f.create_tasks ? h('div', {}, `Aufgabe ${f.lead_days} Tage vorher${f.template_name ? ` · ${f.template_name}` : ''}`) : null),
        h('td', { class: 'small' }, f.last_fetch_at ? relTime(f.last_fetch_at) : 'noch nie', h('div', { class: f.last_status.startsWith('Fehler') ? 'warn-text' : 'muted' }, f.last_status)),
        h('td', { class: 'actions' },
          button('Jetzt abrufen', async () => { try { const r = await api.post(`/api/feeds/${f.id}/sync`); toast(`${r.read} gelesen, ${r.added} neu, ${r.changed} geändert, ${r.tasks} Aufgabe(n)`); connectionsTab(el); } catch (e) { errorToast(e); } }, { kind: 'mini' }),
          iconButton('edit', () => feedDialog(f, () => connectionsTab(el)), 'Bearbeiten'))))))) :
      h('p', { class: 'muted pad' }, 'Noch kein Spielplan. In click-TT/nuLiga gibt es je Mannschaft einen Kalender-Export (iCal/ICS) – dessen Adresse hier eintragen.'));

  // meinVerein
  const mvCard = h('section', { class: 'card pad' },
    h('h2', {}, icon('upload', 18), ' meinVerein: Beitragsstufen prüfen'),
    h('p', { class: 'small' }, 'Export aus meinVerein (CSV, Spalten z. B. Vorname, Nachname, Geburtsdatum, Beitragsart) hochladen. Die App ermittelt, wer zum Stichtag in eine andere Beitragsstufe wechselt, und legt dafür eine Aufgabe mit den Namen an. Der Export selbst wird nicht gespeichert.'),
    state.auto.mitglieder_pruefung ? membersForm() : h('p', { class: 'warn-text small' }, icon('lock', 12), ' Gesperrt, bis die Datenschutzfrage geklärt und die Automatisierung eingeschaltet ist (gelbe Daten).'));

  clear(el, h('div', { class: 'grid-2' }, h('div', { class: 'col' }, m365Card, await jugendplanerCard(() => connectionsTab(el))), h('div', { class: 'col' }, feedCard, mvCard)));
}

// ---------- Jugendplaner ----------
async function jugendplanerCard(reload) {
  const d = await api.get('/api/jugendplaner');
  const c = d.connection, st = d.stand;
  const area = select(areaOptions('— Bereich wählen —'), d.settings.area_id || '');
  area.addEventListener('change', async () => { try { await api.put('/api/jugendplaner', { area_id: area.value ? Number(area.value) : null }); toast('Gespeichert'); reload(); } catch (e) { errorToast(e); } });
  return h('section', { class: 'card pad' },
    h('h2', {}, icon('layers', 18), ' Jugendplaner (Spielbetrieb Jugend)'),
    h('div', { class: `conn-status ${c.configured && st && !st.error ? 'ok' : c.configured ? 'half' : 'off'}` }, icon(c.configured && st && !st.error ? 'check' : 'alert', 16),
      h('div', {}, h('strong', {}, !c.configured ? 'Nicht eingerichtet' : !st ? 'Zugang vorhanden – noch nicht abgeglichen' : st.error ? 'Letzter Abgleich fehlgeschlagen' : `Verbunden · ${st.club || ''} ${st.season || ''}`),
        h('div', { class: 'small muted' }, c.configured ? `${c.host} · Anmeldung über ${c.auth === 'schluessel' ? 'gemeinsamen Schlüssel (mit automatischer Anmeldung)' : 'PIN (ohne automatische Anmeldung)'}` : 'JUGENDPLANER_URL und JUGENDPLANER_SECRET in die .env eintragen (Anleitung: docs/JUGENDPLANER.md).'),
        st ? h('div', { class: `small ${st.error ? 'warn-text' : 'muted'}` }, st.error ? st.error : `Letzter Abgleich ${relTime(st.at)}: ${st.counts.spiele} künftige Spiele, ${st.counts.kritisch} mit kritischem Hinweis`) : null)),
    h('div', { class: 'form-grid' }, field('Bereich', area, 'Hier entstehen die Aufgaben (an das Amt „Jugendwart“).')),
    h('div', { class: 'btn-row' },
      button('Jetzt abgleichen', async () => { try { const r = await api.post('/api/jugendplaner/sync'); toast(`${r.counts.spiele} Spiele, ${r.counts.kritisch} kritisch · ${r.created} Aufgabe(n) neu, ${r.closed} erledigt${r.area ? '' : ' – ohne Bereich keine Aufgaben'}`); reload(); } catch (e) { errorToast(e); } }, { kind: 'primary', iconName: 'refresh', disabled: !c.configured }),
      button(d.feed ? 'Spielplan-Abo vorhanden' : 'Spielplan-Abo anlegen', async () => { try { await api.post('/api/jugendplaner/feed'); toast('Spielplan-Abo angelegt – die Jugendspiele erscheinen im Kalender'); reload(); } catch (e) { errorToast(e); } }, { kind: 'ghost', iconName: 'calendar', disabled: !st || d.feed }),
      button('Zum Jugendplaner', async () => { try { const r = await api.get('/api/jugendplaner/open'); window.open(r.url, 'jugendplaner'); } catch (e) { errorToast(e); } }, { kind: 'ghost', iconName: 'external', disabled: !c.url })),
    h('p', { class: 'hint mt' }, 'Die App liest nur. Übernommen werden Spieltermine und Hinweise ohne Namen; Kinder-, Eltern- und Fahrernamen bleiben im Jugendplaner.'));
}

async function feedDialog(f, done) {
  const name = input({ value: f.name || '', placeholder: 'z. B. Herren I' });
  const url = input({ value: f.url || '', placeholder: 'https://… oder webcal://…' });
  const area = select(areaOptions(null), f.area_id || state.me.areas[0].id);
  const home = input({ value: f.home_pattern ?? '', placeholder: 'z. B. Hohberg' });
  const tasks = h('input', { type: 'checkbox', checked: f.id ? !!f.create_tasks : true });
  const vor16 = state.processTemplates.find(t => t.key === 'VOR-16');
  const tpl = select(templateOptions(area.value), f.template_id ?? vor16?.id ?? '');
  const lead = input({ type: 'number', min: 0, max: 60, value: f.lead_days ?? 10 });
  const owner = select(userOptions('— über das Amt —'), f.owner_id);
  const active = h('input', { type: 'checkbox', checked: f.active !== 0 });
  const preview = h('div', { class: 'small' });
  const doPreview = async () => {
    clear(preview, h('div', { class: 'loading' }, h('span', { class: 'spin' }), 'Lese Kalender …'));
    try {
      const r = await api.post('/api/feeds/preview', { url: url.value, home_pattern: home.value });
      clear(preview, h('p', {}, `${r.total} Termine, davon ${r.upcoming} künftig:`),
        h('ul', { class: 'mini-list' }, r.sample.map(e => h('li', {}, h('span', {}, e.home ? '🏠 ' : '', e.summary), h('small', { class: 'muted' }, `${fmtDate(e.date)}${e.time ? ' ' + e.time : ''}`)))));
    } catch (e) { clear(preview, h('p', { class: 'warn-text' }, e.message)); }
  };
  const actions = [{ label: 'Abbrechen', kind: 'ghost' }];
  if (f.id) actions.push({ label: 'Entfernen', kind: 'danger', onClick: async () => { if (!(await confirmDialog('Spielplan-Abo entfernen? Künftige Spieltermine verschwinden aus dem Kalender.', { danger: true, ok: 'Entfernen' }))) return false; await api.del(`/api/feeds/${f.id}`); } });
  actions.push({ label: 'Speichern', kind: 'primary', onClick: () => {
    const b = { name: name.value, url: url.value, area_id: Number(area.value), home_pattern: home.value, create_tasks: tasks.checked, template_id: tpl.value ? Number(tpl.value) : null, lead_days: Number(lead.value), owner_id: owner.value ? Number(owner.value) : null, active: active.checked };
    return f.id ? api.put(`/api/feeds/${f.id}`, b) : api.post('/api/feeds', b);
  } });
  const ok = await modal({ title: f.id ? `Spielplan „${f.name}“` : 'Spielplan abonnieren', wide: true, body: h('div', { class: 'form-grid' },
    field('Name', name), field('Bereich', area),
    h('div', { class: 'span-2' }, field('Kalender-Adresse (ICS)', url, 'In click-TT: Mannschaft → Spielplan → „Kalender (iCal)“. Wird nur gelesen.')),
    field('Heimspiel erkennen an', home, 'Teil des eigenen Vereinsnamens, steht bei Heimspielen vorne („Hohberg - Gast“).'), field('Verantwortlich für Heimspiel-Aufgaben', owner),
    h('label', { class: 'check span-2' }, tasks, h('span', {}, 'Für Heimspiele automatisch eine Aufgabe anlegen')),
    field('Vorgangsvorlage', tpl), field('So viele Tage vorher anlegen', lead),
    h('label', { class: 'check span-2' }, active, h('span', {}, 'aktiv (täglicher Abruf)')),
    h('div', { class: 'span-2' }, button('Vorschau', doPreview, { kind: 'ghost', iconName: 'search' }), preview)), actions });
  if (ok) { toast('Gespeichert'); done(); }
}

function membersForm() {
  const fi = h('input', { type: 'file', accept: '.csv,text/csv' });
  const stichtag = input({ type: 'date', value: `${Number(today().slice(0, 4)) + 1}-01-01` });
  const area = select(areaOptions(null), state.me.areas.find(a => a.type === 'verein')?.id);
  const out = h('div');
  const run = async () => {
    const f = fi.files[0];
    if (!f) return errorToast(new Error('Bitte die Exportdatei wählen.'));
    try {
      const r = await api.post('/api/members/check', { csv: await f.text(), stichtag: stichtag.value });
      fi.value = '';
      clear(out, h('p', {}, `${r.checked} Personen geprüft (Spalten: ${r.columns.name}, ${r.columns.geburt}${r.columns.stufe ? ', ' + r.columns.stufe : ''}). ${r.changes.length} Stufenwechsel:`),
        r.changes.length ? [h('table', { class: 'table small' }, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Alter'), h('th', {}, 'bisher'), h('th', {}, 'neu'))),
          h('tbody', {}, r.changes.map(c => h('tr', {}, h('td', {}, c.name), h('td', { class: 'num' }, c.alter), h('td', {}, c.ist), h('td', {}, c.soll))))),
        button('Aufgabe mit diesen Wechseln anlegen', async () => { const t = await api.post('/api/members/task', { area_id: Number(area.value), stichtag: r.stichtag, changes: r.changes }); location.hash = `#/aufgabe/${t.taskId}`; }, { kind: 'primary', iconName: 'plus' })] : null);
    } catch (e) { errorToast(e); }
  };
  return h('div', {}, h('div', { class: 'form-grid' }, field('Export (CSV)', fi), field('Stichtag', stichtag), field('Bereich', area)), button('Prüfen', run, { kind: 'primary' }), out);
}

// ---------- Datenschutz-Auskunft ----------

export async function privacyTab(el) {
  const name = input({ type: 'search', placeholder: 'Vor- oder Nachname', class: 'grow' });
  const out = h('div');
  const run = async () => {
    if (name.value.trim().length < 3) return;
    try {
      const r = await api.get(`/api/privacy/search${qs({ name: name.value.trim() })}`);
      const kinds = [...new Set(r.hits.map(x => x.kind))];
      clear(out, h('p', {}, `${r.hits.length} Fundstellen für „${r.name}“.`),
        r.hits.length ? h('a', { class: 'btn', href: `/api/privacy/search${qs({ name: r.name, format: 'csv' })}` }, icon('download', 16), 'Als CSV exportieren') : null,
        kinds.map(k => h('section', { class: 'card mt' }, h('header', { class: 'card-head' }, h('h2', {}, k, h('span', { class: 'count' }, r.hits.filter(x => x.kind === k).length))),
          h('ul', { class: 'mini-list' }, r.hits.filter(x => x.kind === k).map(x => h('li', {}, h('a', { href: x.link, target: x.link.startsWith('/api') ? '_blank' : null }, x.title), h('small', { class: 'muted' }, [x.date ? fmtDate(x.date.slice(0, 10)) : null, x.data_class === 'gelb' ? 'gelb' : null].filter(Boolean).join(' · '))))))));
    } catch (e) { errorToast(e); }
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  clear(el, h('section', { class: 'card pad narrow' },
    h('h2', {}, 'Auskunft über gespeicherte Daten einer Person'),
    h('p', { class: 'small' }, 'Für Anfragen nach Art. 15 DSGVO: Die Suche zeigt alle Stellen, an denen ein Name vorkommt – Aufgaben, Teilschritte, Kommentare, Eingang, Entwürfe, Dateien, Sponsoren, Termine, Konten und Protokoll. Jede Suche wird protokolliert.'),
    h('div', { class: 'ask-bar' }, name, button('Suchen', run, { kind: 'primary', iconName: 'search' }))), out);
}

export { fmtDateTime, emptyState, LEVELS, textarea };
