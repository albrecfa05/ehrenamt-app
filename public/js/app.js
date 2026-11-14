// Einstieg der Oberfläche: Anmeldung, Grundgerüst (Navigation, Kopfzeile), Router.

import { api, setUnauthorizedHandler } from './api.js';
import { h, clear, icon, modal, toast, errorToast, field, input, fmtDateTime, relTime, debounce, statusPill, areaChip, button, nowMs } from './ui.js';
import { state, loadState, refreshMe, isAdmin, onState } from './state.js';
import { openTaskForm } from './views/taskform.js';

import dashboard from './views/dashboard.js';
import tasks from './views/tasks.js';
import task from './views/task.js';
import inbox from './views/inbox.js';
import drafts from './views/drafts.js';
import calendar from './views/calendar.js';
import processes from './views/processes.js';
import texts from './views/texts.js';
import files from './views/files.js';
import knowledge from './views/knowledge.js';
import handbook from './views/handbook.js';
import automation from './views/automation.js';
import metrics from './views/metrics.js';
import auditView from './views/audit.js';
import admin from './views/admin.js';
import account from './views/account.js';
import help from './views/help.js';
import search from './views/search.js';
import sponsors from './views/sponsors.js';
import setup from './views/setup.js';
import spielbetrieb from './views/spielbetrieb.js';

const ROUTES = [
  ['start', dashboard], ['aufgaben', tasks], ['ideen', (el, p) => tasks(el, { ...p, ideas: true })], ['aufgabe/:id', task],
  ['eingang', inbox], ['entwuerfe', drafts], ['kalender', calendar], ['kalender/:tab', calendar],
  ['vorgaenge', processes], ['vorgaenge/:id', processes], ['texte', texts], ['texte/:id', texts],
  ['ablage', files], ['auskunft', knowledge], ['auskunft/:tab', knowledge], ['handbuch', handbook],
  ['automatisierung', automation], ['automatisierung/:tab', automation], ['kennzahlen', metrics], ['protokoll', auditView],
  ['admin', admin], ['admin/:tab', admin], ['sponsoren', sponsors], ['konto', account], ['hilfe', help], ['hilfe/:tab', help], ['suche', search],
  ['einrichtung', setup], ['spielbetrieb', spielbetrieb],
];

const NAV = [
  ['Arbeiten', [
    ['start', 'Übersicht', 'home'], ['aufgaben', 'Aufgaben', 'list'], ['eingang', 'Eingang', 'inbox', () => state.me?.counts.inbox],
    ['entwuerfe', 'Entwürfe', 'mail'], ['kalender', 'Kalender', 'calendar'], ['ideen', 'Ideenspeicher', 'bulb'], ['sponsoren', 'Sponsoren', 'handshake'],
    ['spielbetrieb', 'Spielbetrieb Jugend', 'layers', null, () => state.me?.jugendplaner],
  ]],
  ['Vorgänge und Wissen', [
    ['vorgaenge', 'Vorgangsvorlagen', 'flow'], ['texte', 'Textvorlagen', 'text'], ['ablage', 'Ablage', 'folder'],
    ['auskunft', 'Auskunft', 'book'], ['handbuch', 'Handbuch je Amt', 'graduation'],
  ]],
  ['Steuerung', [
    ['automatisierung', 'Automatisierungen', 'zap', () => state.me?.counts.approvals], ['kennzahlen', 'Kennzahlen', 'chart'], ['protokoll', 'Protokoll', 'shield'],
  ]],
];

const root = document.getElementById('app');
let main, navEl, bellBadge, simBanner, cleanup = null;

// ---------- Darstellung hell/dunkel ----------
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
function currentTheme() { try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; } }
applyTheme(currentTheme());

// ---------- Anmeldung ----------

async function boot() {
  setUnauthorizedHandler(() => { state.me = null; showLogin(); });
  let status;
  try { status = await api.get('/api/auth/status'); } catch (e) { clear(root, h('div', { class: 'auth-wrap' }, h('p', {}, 'Server nicht erreichbar.'))); return; }
  if (status.setupNeeded) return showSetup();
  if (!status.user) return showLogin();
  if (status.user.must_change_pw) return showForcedPassword(status.user);
  await startApp();
}

function authCard(title, sub, form) {
  clear(root, h('div', { class: 'auth-wrap' },
    h('div', { class: 'auth-card' },
      h('div', { class: 'brand brand-lg' }, h('span', { class: 'brand-mark' }, logo()), h('span', {}, 'Ehrenamt', h('small', {}, 'Tischtennis'))),
      h('h1', {}, title), sub ? h('p', { class: 'sub' }, sub) : null, form)));
  form.querySelector('input')?.focus();
}

function logo() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32'); svg.setAttribute('width', '28'); svg.setAttribute('height', '28');
  svg.innerHTML = '<circle cx="13" cy="13" r="10" fill="currentColor"/><rect x="18" y="19" width="5" height="11" rx="2.5" transform="rotate(-45 20.5 24.5)" fill="currentColor" opacity=".7"/><circle cx="26" cy="7" r="3.2" fill="#f97316"/>';
  return svg;
}

function authForm(fields, submitLabel, onSubmit) {
  const err = h('div', { class: 'form-error', hidden: true });
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, submitLabel);
  const form = h('form', { class: 'auth-form', onsubmit: async (e) => {
    e.preventDefault(); err.hidden = true; btn.disabled = true;
    try { await onSubmit(Object.fromEntries(new FormData(form))); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { btn.disabled = false; }
  } }, fields, err, btn);
  return form;
}

const PW_HINT = 'Mindestens 12 Zeichen, drei Zeichenarten (Klein, Groß, Ziffer, Sonderzeichen), keine naheliegenden Wörter.';

function showSetup() {
  authCard('Ersteinrichtung', 'Lege das erste Admin-Konto an. Weitere Konten vergibst du danach im Adminpanel.', authForm([
    field('Name', input({ name: 'name', required: true, autocomplete: 'name', placeholder: 'Vor- und Nachname' })),
    field('Anmeldename', input({ name: 'login', required: true, autocomplete: 'username', placeholder: 'z. B. fabian' })),
    field('Passwort', input({ name: 'password', type: 'password', required: true, autocomplete: 'new-password' }), PW_HINT),
  ], 'Konto anlegen', async (v) => { await api.post('/api/auth/setup', v); location.hash = '#/einrichtung'; await startApp(); }));
}

function showLogin() {
  cleanup?.(); cleanup = null;
  authCard('Anmelden', null, authForm([
    field('Anmeldename', input({ name: 'login', required: true, autocomplete: 'username' })),
    field('Passwort', input({ name: 'password', type: 'password', required: true, autocomplete: 'current-password' })),
  ], 'Anmelden', async (v) => {
    const r = await api.post('/api/auth/login', v);
    if (r.user.must_change_pw) return showForcedPassword(r.user);
    await startApp();
  }));
}

function showForcedPassword(user) {
  authCard('Eigenes Passwort festlegen', `Hallo ${user.name}, bitte ersetze das vorläufige Passwort durch ein eigenes.`, authForm([
    field('Vorläufiges Passwort', input({ name: 'current', type: 'password', required: true, autocomplete: 'current-password' })),
    field('Neues Passwort', input({ name: 'password', type: 'password', required: true, autocomplete: 'new-password' }), PW_HINT),
  ], 'Speichern', async (v) => { await api.post('/api/auth/password', v); toast('Passwort gespeichert'); await startApp(); }));
}

// ---------- Grundgerüst ----------

async function startApp() {
  await loadState();
  navEl = h('nav', { class: 'nav', 'aria-label': 'Hauptnavigation' });
  main = h('main', { class: 'main', id: 'main', tabindex: '-1' });
  bellBadge = h('span', { class: 'bell-badge', hidden: true });
  const searchInput = h('input', { type: 'search', class: 'search-input', placeholder: 'Suchen … (Taste /)', 'aria-label': 'Suche' });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && searchInput.value.trim().length >= 2) location.hash = `#/suche?q=${encodeURIComponent(searchInput.value.trim())}`;
  });
  simBanner = h('div', { class: 'sim-banner', hidden: !state.me.simulator });
  drawSimBanner();
  const topbar = h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn nav-toggle', 'aria-label': 'Menü', onclick: () => document.body.classList.toggle('nav-open') }, icon('menu')),
    h('div', { class: 'search-wrap' }, icon('search', 16), searchInput),
    h('div', { class: 'top-actions' },
      button('Neue Aufgabe', () => openTaskForm(), { kind: 'primary', iconName: 'plus', title: 'Neue Aufgabe (Taste N)' }),
      h('button', { class: 'icon-btn bell', 'aria-label': 'Benachrichtigungen', onclick: openNotifications }, icon('bell'), bellBadge),
      h('a', { class: 'icon-btn', href: '#/konto', title: 'Mein Konto', 'aria-label': 'Mein Konto' }, icon('user'))));
  clear(root, h('div', { class: 'shell' },
    h('aside', { class: 'sidebar' },
      h('a', { class: 'brand', href: '#/start' }, h('span', { class: 'brand-mark' }, logo()), h('span', {}, 'Ehrenamt', h('small', {}, 'Tischtennis'))),
      navEl),
    h('div', { class: 'nav-backdrop', onclick: () => document.body.classList.remove('nav-open') }),
    h('div', { class: 'content' }, h('a', { class: 'skip', href: '#main', onclick: (e) => { e.preventDefault(); main.focus(); } }, 'Zum Inhalt'), simBanner, topbar, main)));
  renderNav();
  onState(() => { renderNav(); drawSimBanner(); });
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', shortcuts);
  route();
  showUpdates();
  setInterval(() => refreshMe().catch(() => {}), 60_000);
}

function renderNav() {
  if (!navEl || !state.me) return;
  const current = (location.hash.slice(2).split(/[/?]/)[0]) || 'start';
  const link = ([path, label, ic, count]) => {
    const n = count?.();
    return h('a', { href: `#/${path}`, class: `nav-link ${current === path ? 'active' : ''}`, 'aria-current': current === path ? 'page' : null },
      icon(ic), h('span', {}, label), n ? h('span', { class: 'nav-count' }, n) : null);
  };
  const groups = NAV.map(([title, items]) => h('div', { class: 'nav-group' }, h('div', { class: 'nav-title' }, title), items.filter(i => !i[4] || i[4]()).map(link)));
  const bottom = h('div', { class: 'nav-group nav-bottom' },
    state.me.setup_open ? link(['einrichtung', 'Einrichtung', 'check']) : null,
    isAdmin() ? link(['admin', 'Adminpanel', 'settings']) : null,
    link(['hilfe', 'Hilfe und FAQ', 'help']),
    h('div', { class: 'nav-user' },
      h('div', { class: 'avatar' }, initials(state.me.user.name)),
      h('div', { class: 'nav-user-text' }, h('strong', {}, state.me.user.name), h('small', {}, state.me.user.role === 'admin' ? 'Admin' : 'Zuarbeit')),
      h('button', { class: 'icon-btn', title: 'Darstellung wechseln', 'aria-label': 'Darstellung wechseln', onclick: toggleTheme }, icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 16)),
      h('button', { class: 'icon-btn', title: 'Abmelden', 'aria-label': 'Abmelden', onclick: logout }, icon('logout', 16))));
  clear(navEl, groups, bottom);
  if (bellBadge) { bellBadge.hidden = !state.me.unread; bellBadge.textContent = state.me.unread > 9 ? '9+' : state.me.unread; }
}

// Simulator: Hinweis auf Fantasiedaten und simuliertes Datum
function drawSimBanner() {
  if (!simBanner || !state.me?.simulator) return;
  const d = new Date(nowMs());
  clear(simBanner, icon('play', 14), h('strong', {}, 'Vorstandsarbeit-Simulator'),
    h('span', {}, ` · Fantasiedaten · simulierter Tag: ${d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`),
    state.me.welt_url ? h('a', { href: state.me.welt_url, target: 'vereinswelt' }, 'Zur Vereinswelt →') : null);
}
export { drawSimBanner };

const initials = (n) => n.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();

function toggleTheme() {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const next = dark ? 'light' : 'dark';
  try { localStorage.setItem('theme', next); } catch { /* privates Fenster */ }
  applyTheme(next);
  renderNav();
}

async function logout() {
  await api.post('/api/auth/logout').catch(() => {});
  location.hash = '';
  showLogin();
}

function shortcuts(e) {
  if (e.target.closest('input, textarea, select, [contenteditable], dialog')) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openTaskForm(); }
  if (e.key === '/') { e.preventDefault(); document.querySelector('.search-input')?.focus(); }
}

// ---------- Router ----------

async function route() {
  if (!state.me) return;
  document.body.classList.remove('nav-open');
  const [pathPart, queryPart] = location.hash.replace(/^#\/?/, '').split('?');
  const path = pathPart || 'start';
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  let view = null, params = {};
  for (const [pattern, fn] of ROUTES) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    const m = re.exec(path);
    if (m) { view = fn; keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); break; }
  }
  renderNav();
  cleanup?.(); cleanup = null;
  if (!view) { clear(main, h('div', { class: 'empty' }, h('p', {}, 'Diese Seite gibt es nicht.'), h('a', { href: '#/start' }, 'Zur Übersicht'))); return; }
  clear(main, h('div', { class: 'loading' }, h('span', { class: 'spin' }), 'Lädt …'));
  try {
    const r = await view(main, { ...params, query });
    if (typeof r === 'function') cleanup = r;
  } catch (err) {
    if (err.status === 401) return;
    clear(main, h('div', { class: 'empty error' }, h('p', {}, err.message), button('Erneut versuchen', route)));
  }
  window.scrollTo(0, 0);
}

export function rerender() { route(); }

// ---------- Benachrichtigungen ----------

async function openNotifications() {
  const list = await api.get('/api/notifications');
  const body = list.length ? h('ul', { class: 'notif-list' }, list.map(n => h('li', { class: n.read_at ? '' : 'unread' },
    h('a', { href: n.task_id ? `#/aufgabe/${n.task_id}` : '#/start', onclick: () => document.querySelector('dialog.modal')?.close() },
      h('div', {}, n.message), h('small', {}, relTime(n.created_at)))))) : h('p', { class: 'muted' }, 'Keine Benachrichtigungen.');
  const done = modal({ title: 'Benachrichtigungen', body, actions: [
    { label: 'Alle als gelesen markieren', kind: 'ghost', onClick: async () => { await api.post('/api/notifications/read'); await refreshMe(); } },
    { label: 'Schließen', kind: 'primary', value: null },
  ] });
  await done;
  if (list.some(n => !n.read_at)) { await api.post('/api/notifications/read', { ids: list.filter(n => !n.read_at).map(n => n.id) }); refreshMe(); }
}

// ---------- Update-Fenster (ABL-5) ----------

async function showUpdates() {
  const items = state.me.unseenChangelog;
  if (!items.length) return;
  await modal({
    title: 'Neu seit deinem letzten Besuch',
    body: h('div', {}, h('p', { class: 'muted' }, 'Änderungen an Regeln, Vorlagen und Wissensbasis:'),
      h('ul', { class: 'changelog' }, items.map(c => h('li', {}, h('strong', {}, c.title), c.version ? h('span', { class: 'badge' }, `v${c.version}`) : null,
        c.note ? h('div', { class: 'muted pre' }, c.note) : null, h('small', {}, fmtDateTime(c.created_at)))))),
    actions: [{ label: 'Alle Änderungen ansehen', kind: 'ghost', value: 'all' }, { label: 'Verstanden', kind: 'primary', value: 'ok' }],
  }).then(async (v) => {
    await api.post('/api/changelog/seen');
    await refreshMe();
    if (v === 'all') location.hash = '#/hilfe/aenderungen';
  });
}

boot().catch(errorToast);

export { areaChip, statusPill };
