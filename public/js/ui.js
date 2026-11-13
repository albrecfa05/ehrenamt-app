// Bausteine der Oberfläche: DOM-Helfer, Dialoge, Hinweise, Formate, Abzeichen.
// Hinweis: Die Sicherheitsrichtlinie (CSP) verbietet Inline-Styles im HTML. Farben und
// Abstände werden daher über el.style (CSSOM) oder Klassen gesetzt.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = {};
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden' || k === 'required' || k === 'multiple') el[k] = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) { el.replaceChildren(); append(el, children); return el; }

export const $ = (sel, root = document) => root.querySelector(sel);

// ---------- Icons (Linien-Icons, inline SVG) ----------
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  bulb: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z',
  flow: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  text: 'M4 7V4h16v3M9 20h6M12 4v16',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9z',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  plus: 'M12 5v14M5 12h14',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  alert: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  menu: 'M3 6h18M3 12h18M3 18h18',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  paperclip: 'm21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
  play: 'M5 3l14 9-14 9z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  calc: 'M4 2h16v20H4zM8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h8',
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  copy: 'M9 9h13v13H9zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
  layers: 'm12 2 10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5',
  map: 'M1 6v16l7-4 8 4 7-4V2l-7 4-8-4zM8 2v16M16 6v16',
  printer: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  chevronLeft: 'm15 18-6-6 6-6', chevronRight: 'm9 18 6-6-6-6', chevronDown: 'm6 9 6 6 6-6',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  graduation: 'M22 10 12 5 2 10l10 5 10-5zM6 12v5c3 3 9 3 12 0v-5',
  handshake: 'M11 17l2 2a1 1 0 0 0 3-3M14 14l2.5 2.5a1 1 0 0 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4M21 3l1 11h-2M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3M3 4h8',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  cloud: 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z',
};

export function icon(name, size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name] || ICONS.help);
  svg.append(p);
  return svg;
}

// ---------- Uhr (im Simulator verschoben) ----------

let clockOffsetMs = 0;
export function setClockOffset(ms) { clockOffsetMs = Number(ms) || 0; }
export const nowMs = () => Date.now() + clockOffsetMs;

// ---------- Formate ----------

const tz = 'Europe/Berlin';
export function fmtDate(s, opts = {}) {
  if (!s) return '';
  const d = s.length === 10 ? new Date(s + 'T12:00:00Z') : new Date(s);
  return d.toLocaleDateString('de-DE', { timeZone: s.length === 10 ? 'UTC' : tz, day: '2-digit', month: '2-digit', year: 'numeric', ...opts });
}
export function fmtDateShort(s) {
  if (!s) return '';
  const d = new Date(s.slice(0, 10) + 'T12:00:00Z');
  return d.toLocaleDateString('de-DE', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' });
}
export function fmtDateTime(s) {
  if (!s) return '';
  return new Date(s).toLocaleString('de-DE', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function relTime(s) {
  if (!s) return '';
  const diff = (nowMs() - Date.parse(s)) / 1000;
  if (diff < 60) return 'gerade eben';
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  const d = Math.floor(diff / 86400);
  if (d === 1) return 'gestern';
  if (d < 30) return `vor ${d} Tagen`;
  return fmtDate(s);
}
export function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(new Date(nowMs()));
}
export function addDays(s, n) {
  const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
export function dueLabel(due) {
  if (!due) return '';
  const t = today();
  const diff = Math.round((Date.parse(due) - Date.parse(t)) / 86_400_000);
  if (diff === 0) return 'heute';
  if (diff === 1) return 'morgen';
  if (diff === -1) return 'gestern';
  if (diff < 0) return `seit ${-diff} Tagen`;
  if (diff < 7) return `in ${diff} Tagen`;
  return fmtDate(due);
}
export const fmtBytes = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
export const fmtMinutes = (m) => !m ? '0 Min.' : m < 60 ? `${m} Min.` : `${Math.floor(m / 60)} Std. ${m % 60 ? (m % 60) + ' Min.' : ''}`.trim();
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- Fachliche Bezeichnungen ----------

export const STATUS = {
  offen: { label: 'Offen', cls: 'st-offen' },
  in_arbeit: { label: 'In Arbeit', cls: 'st-arbeit' },
  wartet: { label: 'Wartet auf Zulieferung', short: 'Wartet', cls: 'st-wartet' },
  erledigt: { label: 'Erledigt', cls: 'st-erledigt' },
  verworfen: { label: 'Verworfen', cls: 'st-verworfen' },
};
export const LEVELS = ['0 Auskunft', '1 Entwurf', '2 Vorbereitung', '3 Ausführung nach Freigabe', '4 Selbstständig nach Plan'];
export const LEVEL_HINT = [
  'aus der Wissensbasis antworten',
  'Texte und Berechnungen vorbereiten, ein Mensch übernimmt',
  'Systeme lesen und Ergebnisse zusammenstellen',
  'nach ausdrücklichem Ja selbst handeln',
  'regelmäßig ohne Anstoß arbeiten',
];
export const CHANNELS = {
  manuell: 'Manuell', mail: 'E-Mail', whatsapp: 'WhatsApp', post: 'Post', telefon: 'Telefon', persoenlich: 'Persönlich',
  website: 'Website', automatisierung: 'Automatisierung', asana: 'Asana-Import', jahreskalender: 'Jahreskalender',
};
export const FREQ = { jaehrlich: 'jährlich', halbjaehrlich: 'halbjährlich', quartalsweise: 'quartalsweise', monatlich: 'monatlich', woechentlich: 'wöchentlich' };
export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

export function statusPill(status, short = false) {
  const s = STATUS[status] || { label: status, cls: '' };
  return h('span', { class: `pill ${s.cls}` }, short && s.short ? s.short : s.label);
}
export function areaChip(name, color) {
  const dot = h('span', { class: 'dot' });
  if (color) dot.style.background = color;
  return h('span', { class: 'area-chip' }, dot, name);
}
export function dataBadge(cls) {
  if (cls === 'gelb') return h('span', { class: 'badge badge-gelb', title: 'Gelb: nur im einzelnen Vorgang, nie dauerhaft in der Wissensbasis' }, 'Gelb');
  return h('span', { class: 'badge badge-gruen', title: 'Grün: darf dauerhaft gespeichert werden' }, 'Grün');
}
export function levelBadge(level, max) {
  return h('span', { class: 'badge badge-level', title: `Stufe ${LEVELS[level]}: ${LEVEL_HINT[level]}${max != null ? ` · Höchststufe ${max}` : ''}` }, `Stufe ${level}`);
}

// ---------- Hinweise ----------

let toastHost;
export function toast(message, type = 'ok', ms = 3500) {
  if (!toastHost) { toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastHost); }
  const t = h('div', { class: `toast toast-${type}` }, icon(type === 'error' ? 'alert' : 'check', 16), h('span', {}, message));
  toastHost.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}
export function errorToast(err) { toast(err?.message || String(err), 'error', 6000); }

// ---------- Dialoge ----------

/**
 * Öffnet einen Dialog. actions: [{ label, kind: 'primary'|'danger'|'ghost', value, onClick? }]
 * onClick darf ein Promise liefern; bei Fehler bleibt der Dialog offen. Ergebnis: value der Aktion oder null.
 */
export function modal({ title, body, actions = [{ label: 'Schließen', value: null, kind: 'ghost' }], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const errBox = h('div', { class: 'form-error', hidden: true });
    const close = (v) => { dlg.close(); dlg.remove(); prev?.focus?.(); resolve(v); };
    const footer = h('div', { class: 'modal-actions' }, actions.map(a => {
      const b = h('button', { class: `btn ${a.kind ? 'btn-' + a.kind : ''}`, type: a.submit ? 'submit' : 'button' }, a.label);
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!a.onClick) return close(a.value ?? null);
        errBox.hidden = true;
        b.disabled = true;
        try {
          const r = await a.onClick();
          if (r !== false) close(r === undefined ? (a.value ?? true) : r);
        } catch (err) {
          errBox.textContent = err.message; errBox.hidden = false;
        } finally { b.disabled = false; }
      });
      return b;
    }));
    const dlg = h('dialog', { class: `modal ${wide ? 'modal-wide' : ''}`, 'aria-label': title },
      h('form', { method: 'dialog', class: 'modal-inner', onsubmit: (e) => e.preventDefault() },
        h('header', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Schließen', onclick: () => close(null) }, icon('x'))),
        h('div', { class: 'modal-body' }, body, errBox),
        footer));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    document.body.append(dlg);
    dlg.showModal();
    onOpen?.(dlg);
    const first = dlg.querySelector('input:not([type=hidden]):not([disabled]), textarea, select');
    (first || footer.lastElementChild)?.focus();
  });
}

export function confirmDialog(text, { title = 'Bitte bestätigen', ok = 'Ja', danger = false } = {}) {
  return modal({ title, body: h('p', {}, text), actions: [{ label: 'Abbrechen', kind: 'ghost', value: false }, { label: ok, kind: danger ? 'danger' : 'primary', value: true }] });
}

// ---------- Formulare ----------

export function field(label, control, hint) {
  const id = control.id || `f${Math.random().toString(36).slice(2, 8)}`;
  control.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('div', { class: 'hint' }, hint) : null);
}
export function input(attrs = {}) { return h('input', { type: 'text', ...attrs }); }
export function textarea(attrs = {}) { const t = h('textarea', { rows: 4, ...attrs }); if (attrs.value) t.value = attrs.value; return t; }
export function select(options, value, attrs = {}) {
  const s = h('select', attrs);
  for (const o of options) {
    const [v, l] = Array.isArray(o) ? o : [o.value ?? o.id, o.label ?? o.name];
    const opt = h('option', { value: v ?? '' }, l);
    if (String(v ?? '') === String(value ?? '')) opt.selected = true;
    s.append(opt);
  }
  return s;
}
export function checkbox(label, checked, attrs = {}) {
  const c = h('input', { type: 'checkbox', checked, ...attrs });
  return { el: h('label', { class: 'check' }, c, h('span', {}, label)), input: c };
}

/** Liest alle benannten Felder eines Containers als Objekt. */
export function formValues(root) {
  const out = {};
  for (const el of root.querySelectorAll('[name]')) {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
    else out[el.name] = el.value;
  }
  return out;
}

// ---------- Kleinteile ----------

export function emptyState(text, action) {
  return h('div', { class: 'empty' }, h('p', {}, text), action || null);
}
export function spinner() { return h('div', { class: 'loading' }, h('span', { class: 'spin' }), 'Lädt …'); }
export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

export function button(label, onClick, { kind = '', iconName, title, type = 'button', disabled } = {}) {
  return h('button', { class: `btn ${kind ? 'btn-' + kind : ''}`, type, title, disabled, onclick: onClick }, iconName ? icon(iconName, 16) : null, label ? h('span', {}, label) : null);
}
export function iconButton(name, onClick, title) {
  return h('button', { class: 'icon-btn', type: 'button', title, 'aria-label': title, onclick: onClick }, icon(name));
}

/** Einfache Textformatierung für Anleitungen: Absätze, nummerierte und Stichpunkt-Listen. Sicher, ohne HTML. */
export function richText(text) {
  const wrap = h('div', { class: 'rich' });
  const blocks = String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/);
  for (const b of blocks) {
    const lines = b.split('\n').filter(l => l.trim());
    if (!lines.length) continue;
    if (lines.every(l => /^\s*\d+[.)]\s/.test(l))) wrap.append(h('ol', {}, lines.map(l => h('li', {}, l.replace(/^\s*\d+[.)]\s/, '')))));
    else if (lines.every(l => /^\s*[-•*]\s/.test(l))) wrap.append(h('ul', {}, lines.map(l => h('li', {}, l.replace(/^\s*[-•*]\s/, '')))));
    else if (/^[^\n]{2,60}:$/.test(lines[0]) && lines.length > 1) {
      wrap.append(h('p', { class: 'rich-head' }, lines[0]));
      const rest = lines.slice(1);
      if (rest.every(l => /^\s*\d+[.)]\s/.test(l))) wrap.append(h('ol', {}, rest.map(l => h('li', {}, l.replace(/^\s*\d+[.)]\s/, '')))));
      else if (rest.every(l => /^\s*[-•*]\s/.test(l))) wrap.append(h('ul', {}, rest.map(l => h('li', {}, l.replace(/^\s*[-•*]\s/, '')))));
      else wrap.append(h('p', {}, rest.join('\n')));
    } else wrap.append(h('p', {}, lines.join('\n')));
  }
  return wrap;
}

export function tabs(items, active, onChange) {
  return h('div', { class: 'tabs', role: 'tablist' }, items.map(([key, label, count]) =>
    h('button', { class: `tab ${key === active ? 'active' : ''}`, role: 'tab', 'aria-selected': key === active ? 'true' : 'false', type: 'button', onclick: () => onChange(key) },
      label, count ? h('span', { class: 'count' }, count) : null)));
}

export function pageHeader(title, subtitle, ...actions) {
  return h('header', { class: 'page-head' },
    h('div', {}, h('h1', {}, title), subtitle ? h('p', { class: 'sub' }, subtitle) : null),
    h('div', { class: 'page-actions' }, actions));
}

export function copyText(text) {
  return navigator.clipboard?.writeText(text).then(() => toast('In die Zwischenablage kopiert')).catch(() => toast('Kopieren nicht möglich', 'error'));
}
