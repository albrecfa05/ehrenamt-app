// Adminpanel (ROL-5, NFA-5): Konten, Bereiche und Ämter, Einstellungen, Asana-Import.

import { api } from '../api.js';
import { h, clear, pageHeader, tabs, button, iconButton, select, input, textarea, field, modal, toast, errorToast, confirmDialog, fmtDateTime, relTime, copyText, icon, emptyState } from '../ui.js';
import { state, isAdmin, areaOptions, userOptions, refreshLookups, loadState } from '../state.js';
import { catalogTab, connectionsTab, privacyTab } from './admin-integrations.js';

export default async function admin(el, { tab = 'nutzer' }) {
  if (!isAdmin()) { clear(el, emptyState('Nur für Admins.')); return; }
  const body = h('div');
  clear(el, pageHeader('Adminpanel', 'Zugriffe vergeben und entziehen, Bereiche und Ämter pflegen, Einstellungen und Import.'),
    tabs([['nutzer', 'Konten'], ['bereiche', 'Bereiche und Ämter'], ['automatisierungen', 'Automatisierungen'], ['verbindungen', 'Verbindungen'], ['einstellungen', 'Einstellungen'], ['datenschutz', 'Datenschutz'], ['import', 'Asana-Import'], ['faq', 'Hilfe-Texte']], tab, (k) => { location.hash = `#/admin/${k}`; }),
    body);
  if (tab === 'automatisierungen') return catalogTab(body);
  if (tab === 'verbindungen') return connectionsTab(body);
  if (tab === 'datenschutz') return privacyTab(body);
  if (tab === 'bereiche') return areas(body);
  if (tab === 'einstellungen') return settings(body);
  if (tab === 'import') return asana(body);
  if (tab === 'faq') return faq(body);
  return users(body);
}

// ---------- Konten ----------

async function users(el) {
  const rows = await api.get('/api/users');
  const showPw = (name, pw) => modal({ title: 'Vorläufiges Passwort', body: h('div', {},
    h('p', {}, `Gib ${name} dieses Passwort auf sicherem Weg weiter (nicht per Mail an eine Gruppe). Es muss bei der ersten Anmeldung geändert werden.`),
    h('div', { class: 'copy-row' }, h('code', { class: 'pw' }, pw), button('Kopieren', () => copyText(pw), { iconName: 'copy' })),
    h('p', { class: 'hint' }, 'Das Passwort wird nur jetzt angezeigt.')) });
  const edit = async (u = null) => {
    const name = input({ value: u?.name || '' });
    const login = input({ value: u?.login || '', disabled: !!u });
    const role = select([['zuarbeit', 'Zuarbeit: eigene Aufgaben, Material zuliefern'], ['admin', 'Admin: alles']], u?.role || 'zuarbeit');
    const areaBoxes = state.me.areas.map(a => { const c = h('input', { type: 'checkbox', value: a.id, checked: u ? u.areas.includes(a.id) : false }); return { a, c }; });
    const ok = await modal({ title: u ? `Konto „${u.name}“` : 'Neues Konto', body: h('div', {},
      field('Name', name), field('Anmeldename', login, u ? null : 'Kleinbuchstaben, z. B. vorname.nachname'), field('Rolle', role),
      h('fieldset', { class: 'fieldset' }, h('legend', {}, 'Bereiche (für Zuarbeit; Admins sehen alles)'), areaBoxes.map(({ a, c }) => h('label', { class: 'check' }, c, h('span', {}, a.name))))),
      actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Speichern', kind: 'primary', onClick: async () => {
        const areas = areaBoxes.filter(x => x.c.checked).map(x => x.a.id);
        if (u) { await api.put(`/api/users/${u.id}`, { name: name.value, role: role.value, areas }); return true; }
        return api.post('/api/users', { name: name.value, login: login.value, role: role.value, areas });
      } }] });
    if (ok?.temporaryPassword) await showPw(name.value, ok.temporaryPassword);
    if (ok) { await refreshLookups(); users(el); }
  };
  clear(el, h('div', { class: 'toolbar' }, h('p', { class: 'muted' }, 'Beim Ausscheiden aus einem Amt das Konto sperren: Alle Sitzungen enden sofort, Aufgaben bleiben zur Übergabe sichtbar.'),
    button('Neues Konto', () => edit(), { kind: 'primary', iconName: 'plus' })),
  h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Rolle'), h('th', {}, 'Bereiche'), h('th', {}, 'Sitzungen'), h('th', {}, 'Status'), h('th', {}))),
    h('tbody', {}, rows.map(u => h('tr', { class: u.active ? '' : 'inactive' },
      h('td', {}, h('strong', {}, u.name), h('div', { class: 'small muted' }, u.login)),
      h('td', {}, u.role === 'admin' ? 'Admin' : 'Zuarbeit'),
      h('td', { class: 'small' }, u.role === 'admin' ? 'alle' : (u.areas.map(id => state.me.areas.find(a => a.id === id)?.name).filter(Boolean).join(', ') || h('span', { class: 'warn-text' }, 'keine'))),
      h('td', { class: 'small' }, u.sessions.n ? `${u.sessions.n} aktiv, zuletzt ${relTime(u.sessions.last)}` : '—'),
      h('td', {}, u.active ? h('span', { class: 'pill st-erledigt' }, 'aktiv') : h('span', { class: 'pill st-verworfen' }, `gesperrt ${u.deactivated_at ? fmtDateTime(u.deactivated_at) : ''}`)),
      h('td', { class: 'actions' },
        iconButton('edit', () => edit(u), 'Bearbeiten'),
        button('Sitzungen beenden', async () => { if (!(await confirmDialog(`Alle Sitzungen von ${u.name} sofort beenden (z. B. bei Geräteverlust)?`, { ok: 'Beenden', danger: true }))) return; const r = await api.post(`/api/users/${u.id}/revoke`); toast(`${r.revoked} Sitzung(en) beendet`); users(el); }, { kind: 'mini' }),
        button('Passwort zurücksetzen', async () => { if (!(await confirmDialog(`Passwort von ${u.name} zurücksetzen? Alle Sitzungen enden.`, { ok: 'Zurücksetzen' }))) return; const r = await api.post(`/api/users/${u.id}/reset-password`); await showPw(u.name, r.temporaryPassword); users(el); }, { kind: 'mini' }),
        u.id !== state.me.user.id ? button(u.active ? 'Sperren' : 'Entsperren', async () => {
          if (u.active && !(await confirmDialog(`Konto ${u.name} sperren? Der Zugriff endet sofort.`, { ok: 'Sperren', danger: true }))) return;
          try { await api.put(`/api/users/${u.id}`, { active: !u.active }); toast(u.active ? 'Gesperrt' : 'Entsperrt'); await refreshLookups(); users(el); } catch (e) { errorToast(e); }
        }, { kind: u.active ? 'mini-danger' : 'mini' }) : null))))));
}

// ---------- Bereiche und Ämter ----------

async function areas(el) {
  const [all, offices] = await Promise.all([api.get('/api/areas'), api.get('/api/offices')]);
  const areaDlg = async (a = {}) => {
    const name = input({ value: a.name || '' });
    const type = select([['verein', 'Verein'], ['bezirk', 'Bezirk']], a.type || 'verein', { disabled: !!a.id });
    const color = input({ type: 'color', value: a.color || '#2563eb' });
    const ok = await modal({ title: a.id ? a.name : 'Neuer Bereich', body: h('div', {}, field('Name', name), field('Art', type), field('Farbe', color),
      a.id ? null : h('p', { class: 'hint' }, 'Jeder Bereich hat getrennte Daten (NFA-8). Danach Ämter anlegen und Zuarbeitenden den Bereich zuordnen.')),
      actions: [{ label: 'Abbrechen', kind: 'ghost' }, a.id ? { label: a.active ? 'Deaktivieren' : 'Aktivieren', kind: 'ghost', onClick: () => api.put(`/api/areas/${a.id}`, { active: !a.active }) } : null,
        { label: 'Speichern', kind: 'primary', onClick: () => a.id ? api.put(`/api/areas/${a.id}`, { name: name.value, color: color.value }) : api.post('/api/areas', { name: name.value, type: type.value, color: color.value }) }].filter(Boolean) });
    if (ok) { await loadState(); areas(el); }
  };
  const officeDlg = async (o) => {
    const name = input({ value: o.name || '' });
    const holder = select(userOptions('— unbesetzt —'), o.holder_id);
    const deputy = select(userOptions('— keine —'), o.deputy_id);
    const ok = await modal({ title: o.id ? `Amt „${o.name}“` : 'Neues Amt', body: h('div', {}, field('Name', name), field('Inhaber (Standard-Verantwortung)', holder), field('Vertretung', deputy, 'Fast jede Aufgabe hängt an einer Person – eine Vertretung macht das Amt übergabefähig.')),
      actions: [{ label: 'Abbrechen', kind: 'ghost' }, o.id ? { label: 'Löschen', kind: 'danger', onClick: () => api.del(`/api/offices/${o.id}`) } : null,
        { label: 'Speichern', kind: 'primary', onClick: () => { const b = { name: name.value, holder_id: holder.value ? Number(holder.value) : null, deputy_id: deputy.value ? Number(deputy.value) : null };
          return o.id ? api.put(`/api/offices/${o.id}`, b) : api.post('/api/offices', { ...b, area_id: o.area_id }); } }].filter(Boolean) });
    if (ok) { await refreshLookups(); areas(el); }
  };
  clear(el, h('div', { class: 'toolbar' }, h('p', { class: 'muted' }, 'Daten sind je Verein und Bezirk getrennt. Teilbar sind nur Vorlagen, Abläufe und Regelwissen (DAT-8).'), button('Neuer Bereich', () => areaDlg(), { kind: 'primary', iconName: 'plus' })),
    h('div', { class: 'grid-3' }, all.map(a => h('section', { class: `card ${a.active ? '' : 'inactive'}` },
      h('header', { class: 'card-head' }, h('h2', {}, (() => { const d = h('span', { class: 'dot big' }); d.style.background = a.color; return d; })(), a.name, h('small', { class: 'muted' }, a.type === 'bezirk' ? ' Bezirk' : ' Verein')), iconButton('edit', () => areaDlg(a), 'Bearbeiten')),
      h('ul', { class: 'mini-list pad' }, offices.filter(o => o.area_id === a.id).map(o => h('li', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); officeDlg(o); } }, o.name),
        h('small', { class: o.holder_name ? 'muted' : 'warn-text' }, o.holder_name || 'unbesetzt', o.deputy_name ? ` · Vertretung ${o.deputy_name}` : '')))),
      h('div', { class: 'pad-x pad-b' }, button('Amt hinzufügen', () => officeDlg({ area_id: a.id }), { kind: 'ghost', iconName: 'plus' }))))));
}

// ---------- Einstellungen ----------

async function settings(el) {
  const s = await api.get('/api/settings');
  const inputs = {};
  const rows = [];
  for (const [k, def] of Object.entries(s)) {
    if (def.type === 'json' || def.catalog) continue;
    let ctl;
    if (def.type === 'boolean') { ctl = h('input', { type: 'checkbox', checked: !!def.value }); rows.push(h('label', { class: 'check setting-check' }, ctl, h('span', {}, def.label))); }
    else { ctl = input({ type: 'number', value: def.value ?? '' }); rows.push(field(def.label, ctl)); }
    inputs[k] = ctl;
  }
  const stufen = (s.beitragsstufen.value || []).map(x => ({ ...x }));
  const stufenBox = h('div');
  const drawStufen = () => clear(stufenBox, h('table', { class: 'table small' }, h('thead', {}, h('tr', {}, h('th', {}, 'Stufe'), h('th', {}, 'ab Alter'), h('th', {}, 'bis Alter'), h('th', {}, 'Beitrag €/Jahr'), h('th', {}))),
    h('tbody', {}, stufen.map((st, i) => {
      const mk = (key, type = 'text') => { const x = input({ type, value: st[key] ?? '' }); x.addEventListener('input', () => { st[key] = x.value; }); return x; };
      return h('tr', {}, h('td', {}, mk('name')), h('td', {}, mk('ab_alter', 'number')), h('td', {}, mk('bis_alter', 'number')), h('td', {}, mk('beitrag', 'number')), h('td', {}, iconButton('trash', () => { stufen.splice(i, 1); drawStufen(); }, 'Entfernen')));
    }))), button('Stufe hinzufügen', () => { stufen.push({ name: '', ab_alter: 0, bis_alter: '', beitrag: 0 }); drawStufen(); }, { kind: 'ghost', iconName: 'plus' }));
  drawStufen();
  clear(el, h('div', { class: 'grid-2' },
    h('section', { class: 'card pad' }, h('h2', {}, 'Nachfassen, Fristen und Schwellen'), h('div', { class: 'stack-sm' }, rows),
      h('p', { class: 'hint' }, 'Die Datenschutzfrage (Verband oder Sportbund) ist laut Lastenheft offen. Erst nach der Antwort Automatisierungen mit gelben Daten freigeben und eine Löschfrist eintragen.'),
      h('p', { class: 'hint' }, 'Erinnerungen, Nachfassen, Ideen und Löschfrist stellst du unter ', h('a', { href: '#/admin/automatisierungen' }, 'Automatisierungen'), ' ein.')),
    h('section', { class: 'card pad' }, h('h2', {}, 'Beitragsstufen'), h('p', { class: 'hint' }, 'Für den Rechner „Beitragsstufe prüfen“. Die eingetragenen Werte sind Annahmen – bitte die echten Sätze eintragen.'), stufenBox)),
  h('div', { class: 'toolbar end' }, button('Einstellungen speichern', async () => {
    const b = { beitragsstufen: stufen };
    for (const [k, ctl] of Object.entries(inputs)) b[k] = ctl.type === 'checkbox' ? ctl.checked : ctl.value;
    try { await api.put('/api/settings', b); toast('Gespeichert'); } catch (e) { errorToast(e); }
  }, { kind: 'primary' })));
}

// ---------- Asana-Import (AUF-12) ----------

async function asana(el) {
  const fi = h('input', { type: 'file', accept: '.csv,text/csv' });
  const area = select(areaOptions(null), state.me.areas[0]?.id);
  const out = h('div');
  let csv = null;
  const pasted = textarea({ rows: 4, placeholder: 'Oder hier den Inhalt der CSV-Datei einfügen (z. B. aus Excel oder einer Mail kopiert)' });
  const analyse = async (text) => {
    csv = text;
    if (!csv?.trim()) return;
    try {
      const p = await api.post('/api/import/asana/preview', { csv });
      const map = {};
      const includeDone = h('input', { type: 'checkbox', checked: true });
      clear(out, h('section', { class: 'card pad' },
        h('h3', {}, 'Vorschau'),
        h('p', {}, `${p.stats.tasks} Aufgaben, davon ${p.stats.completed} erledigt, ${p.stats.subtasks} Teilaufgaben (werden zu Teilschritten).`,
          p.stats.projects.length ? ` Projekte: ${p.stats.projects.join(', ')}.` : ''),
        p.assignees.length ? h('div', {}, h('h4', {}, 'Zuständige zuordnen'), h('p', { class: 'hint' }, 'E-Mail-Adressen aus Asana werden nicht übernommen.'),
          h('div', { class: 'form-grid' }, p.assignees.map(a => { const s = select(userOptions('— niemand —'), a.user_id); map[a.name] = a.user_id; s.addEventListener('change', () => { map[a.name] = s.value ? Number(s.value) : null; }); return field(a.name, s); }))) : null,
        h('label', { class: 'check' }, includeDone, h('span', {}, 'Erledigte Aufgaben übernehmen (dienen als Vorher-Wert für die Kennzahlen)')),
        h('table', { class: 'table small' }, h('tbody', {}, p.sample.map(s => h('tr', {}, h('td', {}, s.name), h('td', {}, s.assignee), h('td', {}, s.due || ''), h('td', {}, s.completed ? 'erledigt' : ''), h('td', { class: 'muted' }, s.section))))),
        button('Jetzt importieren', async () => {
          try {
            const r = await api.post('/api/import/asana', { csv, area_id: Number(area.value), assignees: map, include_completed: includeDone.checked });
            toast(`${r.tasks} Aufgaben und ${r.steps} Teilschritte übernommen, ${r.skipped} übersprungen`);
            clear(out, h('p', {}, 'Import abgeschlossen. ', h('a', { href: '#/aufgaben' }, 'Zu den Aufgaben')));
          } catch (e) { errorToast(e); }
        }, { kind: 'primary', iconName: 'upload' })));
    } catch (e) { errorToast(e); clear(out); }
  };
  fi.addEventListener('change', async () => { if (fi.files[0]) analyse(await fi.files[0].text()); });
  clear(el, h('section', { class: 'card pad narrow' },
    h('h2', {}, 'Aufgaben aus Asana übernehmen'),
    h('p', {}, 'Einmal importieren, dann ablösen. In Asana je Projekt: „…“ → Exportieren/Drucken → CSV. Ein mehrfacher Import derselben Datei legt nichts doppelt an.'),
    h('div', { class: 'form-grid' }, field('Zielbereich', area), field('CSV-Datei', fi), h('div', { class: 'span-2' }, field('… oder CSV-Inhalt', pasted), button('Eingefügten Inhalt prüfen', () => analyse(pasted.value), { kind: 'ghost', iconName: 'search' }))), out));
}

// ---------- Hilfe-Texte ----------

async function faq(el) {
  const rows = await api.get('/api/faq');
  const edit = async (f = {}) => {
    const cat = input({ value: f.category || 'Allgemein' });
    const q = input({ value: f.question || '' });
    const a = textarea({ rows: 5, value: f.answer || '' });
    const ok = await modal({ title: f.id ? 'FAQ bearbeiten' : 'Neue Frage', body: h('div', {}, field('Kategorie', cat), field('Frage', q), field('Antwort', a)),
      actions: [{ label: 'Abbrechen', kind: 'ghost' }, f.id ? { label: 'Löschen', kind: 'danger', onClick: () => api.del(`/api/faq/${f.id}`) } : null,
        { label: 'Speichern', kind: 'primary', onClick: () => f.id ? api.put(`/api/faq/${f.id}`, { category: cat.value, question: q.value, answer: a.value }) : api.post('/api/faq', { category: cat.value, question: q.value, answer: a.value }) }].filter(Boolean) });
    if (ok) faq(el);
  };
  clear(el, h('div', { class: 'toolbar' }, h('p', { class: 'muted' }, 'Fragen und Antworten für den Bereich „Hilfe und FAQ“.'), button('Neue Frage', () => edit(), { kind: 'primary', iconName: 'plus' })),
    h('ul', { class: 'mini-list' }, rows.map(f => h('li', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); edit(f); } }, f.question), h('small', { class: 'muted' }, f.category)))));
}

export { icon };
