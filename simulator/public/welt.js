// Vereinswelt: die eigenständige Seite des Vorstandsarbeit-Simulators.

const $ = (s) => document.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else el.append(c instanceof Node ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return el;
}
const clear = (el, ...kids) => { el.replaceChildren(); kids.flat(Infinity).forEach(k => k != null && k !== false && el.append(k instanceof Node ? k : document.createTextNode(String(k)))); return el; };
async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Fehler ${r.status}`);
  return d;
}
let toastTimer;
function toast(msg, err = false) { const t = $('#toast'); t.textContent = msg; t.className = `toast${err ? ' err' : ''}`; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, err ? 6000 : 3500); }
const fail = (e) => toast(e.message, true);
const dt = (iso) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const d = (s) => new Date(s + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
async function copy(text, what = 'Text') { try { await navigator.clipboard.writeText(text); toast(`${what} kopiert`); } catch { toast('Kopieren nicht möglich – bitte markieren und kopieren.', true); } }
const fileLink = (f, label) => h('span', { class: 'att' }, '📎 ', f.name, h('a', { href: `/datei/${f.id}?ansehen`, target: '_blank' }, 'ansehen'), '·', h('a', { href: `/datei/${f.id}` }, label || 'herunterladen'));

let S = null;      // Status
let WELT = null;   // feste Infos
const main = $('#main');

const NAV = [
  ['', [['start', '🏠', 'Start und Geschichte']]],
  ['Wie bisher im Verein', [['postfach', '✉️', 'Postfächer', () => Object.values(S?.unread.mail || {}).reduce((a, b) => a + b, 0)], ['briefkasten', '📬', 'Briefkasten', () => S?.unread.post],
    ['whatsapp', '💬', 'WhatsApp', () => Object.values(S?.unread.chats || {}).reduce((a, b) => a + b, 0)], ['ordner', '🗂️', 'Vereinsordner'], ['clicktt', '🏓', 'click-TT'], ['jugendplaner', '🚗', 'Jugendplaner']]],
  ['Technik', [['m365', '☁️', 'Microsoft 365', () => S?.unread.drafts]]],
];

function drawNav() {
  const cur = location.hash.slice(1).split('/')[0] || 'start';
  clear($('#nav'), NAV.map(([g, items]) => [g ? h('div', { class: 'group' }, g) : null, items.map(([k, ico, label, n]) => {
    const c = n?.();
    return h('a', { href: `#${k}`, class: cur === k ? 'active' : '' }, h('span', { class: 'ico' }, ico), label, c ? h('span', { class: 'badge' }, c) : null);
  })]));
}
function drawTop() {
  if (!S) return;
  $('#date').textContent = new Date(S.today + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#day').textContent = S.day ? `Tag ${S.day} der Simulation` : 'Erster Tag – die App ist noch leer';
}
async function refresh() { S = await api('/api/status'); drawNav(); drawTop(); }

// ---------- Start ----------
async function viewStart() {
  const e1 = S.einrichtung, ev = S.ereignisse;
  const done1 = e1.filter(c => c.ok).length;
  const p = h('div', { class: 'progress' }, h('span', {})); p.firstChild.style.width = `${Math.round(done1 / e1.length * 100)}%`;
  const evCard = (e) => h('article', { class: `card ev ${e.state}` },
    h('div', { class: 'row' }, h('h3', {}, e.title), h('span', { class: 'spacer' }), h('span', { class: `tag ${e.state === 'geloest' ? 'green' : e.state === 'laeuft' ? 'orange' : ''}` },
      { neu: `ab Tag ${e.tag}`, laeuft: `läuft seit ${e.day} Tag(en)`, geloest: `gelöst nach ${e.solved_days} Tag(en)`, abgebrochen: 'abgebrochen' }[e.state])),
    h('div', { class: 'meta' }, `Kommt über: ${e.kanal} · ${['', 'leicht', 'mittel', 'schwer'][e.difficulty]}`),
    h('p', { class: 'small' }, e.problem),
    e.state !== 'neu' ? h('ul', {}, e.checks.map(c => h('li', { class: c.ok ? 'ok' : '' }, c.ok ? '✓ ' : '○ ', c.label))) : null,
    e.state === 'laeuft' ? h('details', {}, h('summary', { class: 'small' }, 'Tipps'), h('ul', { class: 'small' }, e.tips.map(t => h('li', {}, t)))) : null,
    h('div', { class: 'row' },
      e.state === 'neu' || e.state === 'abgebrochen' ? h('button', { class: 'small', onclick: () => act(() => api('/api/ereignis', { key: e.key }), 'Ist passiert – schau in den Kanal.') }, 'Jetzt passieren lassen') : null,
      e.state === 'laeuft' ? h('button', { class: 'small', onclick: () => act(() => api('/api/ereignis/abbrechen', { key: e.key })) }, 'Abbrechen') : null));
  const sw = (key, label) => { const c = h('input', { type: 'checkbox' }); c.checked = S[key]; c.onchange = () => act(() => api('/api/einstellung', { [key]: c.checked })); return h('label', { class: 'check small' }, c, h('span', {}, label)); };
  clear(main,
    h('div', { class: 'intro' },
      h('section', { class: 'card you' },
        h('h1', {}, 'Willkommen beim TTV Musterhausen'),
        h('p', {}, h('strong', {}, 'Du bist Mia Muster, 1. Vorsitzende. '), `Den Verein gibt es seit ${WELT.verein.gegruendet}, ${WELT.verein.mitglieder} Mitglieder, drei Mannschaften. Bisher lief alles über Ordner, Asana, Mails und WhatsApp – links findest du alles so, wie es heute ist.`),
        h('p', {}, 'Ab heute führt ihr die ', h('strong', {}, 'Ehrenamt-App'), ' ein. Sie ist noch ', h('strong', {}, 'leer'), '. Richte sie mit den Unterlagen aus dem Vereinsordner ein (Kapitel 1). Danach geht der Vereinsalltag los (Kapitel 2): Anträge im Briefkasten, Mails, WhatsApp-Nachrichten – die du mit der App bearbeitest.'),
        h('div', { class: 'row' }, h('a', { class: 'app-link', href: WELT.app_url, target: 'ehrenamt-app' }, 'Ehrenamt-App öffnen ↗'), h('a', { href: '#ordner' }, 'Zum Vereinsordner'))),
      h('section', { class: 'card' }, h('h3', {}, 'So funktioniert die Simulation'),
        h('ul', { class: 'small' },
          h('li', {}, 'Zeit vergeht nur, wenn du oben vorspulst. Jeder Tag läuft wie im echten Betrieb: Erinnerungen, Jahreskalender, Regeln, Postfach- und Spielplan-Abruf der App.'),
          h('li', {}, 'Ereignisse kommen über die Kanäle der Welt, nie direkt in die App. Verbindest du das Postfach, holt die App Mails selbst ab. Sonst: Mail als .eml herunterladen oder in der App „Eingang erfassen“.'),
          h('li', {}, 'Was die App nach außen tut (Entwürfe, Termine, SharePoint), landet hier im Postfach bzw. unter Microsoft 365.'),
          h('li', {}, 'Abgehakt wird automatisch, sobald die App den richtigen Stand hat.')),
        sw('saison', 'Saisonverlauf: Ereignisse treten an ihrem Tag von selbst ein'), sw('rauschen', 'Alltagsrauschen: zusätzliche Nachrichten an manchen Tagen'))),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('strong', {}, `${done1}/${e1.length}`), h('span', {}, 'Einrichtung')),
      h('div', { class: 'stat' }, h('strong', {}, `${S.score.solved}/${S.score.total}`), h('span', {}, 'Ereignisse gelöst')),
      h('div', { class: 'stat' }, h('strong', {}, S.score.points), h('span', {}, 'Punkte')),
      h('div', { class: 'stat' }, h('strong', {}, S.health.offen), h('span', {}, 'offene Aufgaben in der App')),
      h('div', { class: 'stat' }, h('strong', {}, S.health.ueberfaellig), h('span', {}, 'davon überfällig')),
      h('div', { class: 'stat' }, h('strong', {}, S.health.eingang), h('span', {}, 'im Eingang der App'))),
    h('h2', {}, 'Kapitel 1 · Die App einrichten'),
    h('section', { class: 'card' }, p, h('ul', { class: 'checklist' }, e1.map(c => h('li', { class: c.ok ? 'ok' : '' }, h('span', { class: 'mark' }, c.ok ? '✓' : ''), h('div', {}, h('span', {}, c.label), c.ok ? null : h('details', {}, h('summary', {}, 'Wie?'), c.tip)))))),
    h('h2', {}, 'Kapitel 2 · Vereinsalltag'),
    h('p', { class: 'muted small' }, 'Typische Probleme von Sportvereinen. Mit Saisonverlauf treten sie an ihrem Tag ein; du kannst sie auch sofort auslösen.'),
    ev.some(e => e.state === 'laeuft') ? h('div', { class: 'grid' }, ev.filter(e => e.state === 'laeuft').map(evCard)) : null,
    h('div', { class: 'grid', style: 'margin-top:12px' }, ev.filter(e => e.state !== 'laeuft').map(evCard)),
    h('h2', {}, 'Was passiert ist'),
    h('section', { class: 'card' }, S.log.length ? h('ul', { class: 'log' }, S.log.map(l => h('li', { class: l.kind }, h('time', {}, dt(l.at)), h('span', {}, l.text)))) : h('p', { class: 'muted' }, 'Noch nichts.')));
}

// ---------- Postfach ----------
let mbSel = null, folderSel = 'inbox', mailSel = null;
async function viewPostfach() {
  mbSel ||= WELT.mailboxes[0].address;
  const list = await api(`/api/postfach?mailbox=${encodeURIComponent(mbSel)}&folder=${folderSel}`);
  const reader = h('div', { class: 'reader' }, h('div', { class: 'empty' }, list.length ? 'Mail auswählen' : 'Keine Mails in diesem Ordner.'));
  const listEl = h('div', { class: 'mlist' }, list.map(m => h('button', { class: `${m.read ? '' : 'unread'} ${m.id === mailSel ? 'sel' : ''}`, onclick: (ev) => { mailSel = m.id; openMail(m.id, reader).then(refresh).catch(fail); listEl.querySelectorAll('button').forEach(b => b.classList.remove('sel', 'unread')); ev.currentTarget.classList.add('sel'); } },
    folderSel === 'inbox' ? m.fromName : (m.to || '(noch kein Empfänger)'), h('small', {}, m.subject), h('small', {}, `${dt(m.received)}${m.attachments ? ` · 📎 ${m.attachments}` : ''}${m.source === 'app' ? ' · von der App angelegt' : ''}`))));
  clear(main, h('h1', {}, 'Postfächer'),
    h('p', { class: 'muted small' }, 'Die Funktionspostfächer des Vereins (Microsoft 365). Die App liest hier mit, sobald du sie verbunden hast. Ohne Verbindung: „Als .eml herunterladen“ und in der App unter Eingang einlesen.'),
    h('div', { class: 'tabs' }, WELT.mailboxes.map(mb => h('button', { class: mb.address === mbSel ? 'on' : '', onclick: () => { mbSel = mb.address; mailSel = null; render(); } }, `${mb.name}${S.unread.mail[mb.address] ? ` (${S.unread.mail[mb.address]})` : ''}`))),
    h('div', { class: 'tabs' }, [['inbox', 'Posteingang'], ['drafts', 'Entwürfe'], ['sent', 'Gesendet']].map(([k, l]) => h('button', { class: `small ${k === folderSel ? 'on' : ''}`, onclick: () => { folderSel = k; mailSel = null; render(); } }, l))),
    h('div', { class: 'mail' }, listEl, reader));
  if (mailSel && list.some(m => m.id === mailSel)) openMail(mailSel, reader);
}
function addressBook() {
  const dl = h('datalist', { id: 'adressen' }, WELT.people.map(p => h('option', { value: p.mail }, `${p.name} (${p.role})`)),
    ['staffel@tt-musterkreis.example', 'familie.lustig@mail.example', 'info@baeckerei-kruemel.example', 'gerd.genau@mail.example', 'foerderung@sportbund-musterland.example'].map(a => h('option', { value: a })));
  return dl;
}
async function openMail(id, reader) {
  const m = await api(`/api/mail/${id}`);
  const to = h('input', { list: 'adressen', placeholder: 'An (Adresse)', value: m.folder === 'drafts' ? '' : m.from });
  const subj = h('input', { value: m.folder === 'drafts' ? m.subject : (m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`) });
  const text = h('textarea', {}); text.value = m.folder === 'drafts' ? m.body : `\n\n-----\n${m.fromName} schrieb:\n${m.body}`;
  const compose = h('div', { class: 'compose', hidden: m.folder !== 'drafts' }, addressBook(), to, subj, text,
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => act(() => api('/api/mail/send', { mailbox: m.mailbox, draftId: m.folder === 'drafts' ? m.id : null, replyTo: m.folder === 'drafts' ? null : m.id, to: to.value, subject: subj.value, body: text.value }), 'Verschickt') }, 'Verschicken')));
  clear(reader,
    h('h3', {}, m.subject || '(ohne Betreff)'),
    h('div', { class: 'small muted' }, m.folder === 'inbox' ? `Von ${m.fromName} <${m.from}> · ${dt(m.received)}` : `${m.folder === 'drafts' ? 'Entwurf' : 'Gesendet'} · ${m.to ? `an ${m.to}` : 'noch ohne Empfänger'} · ${dt(m.received)}`),
    m.source === 'app' ? h('p', { class: 'tag blue' }, 'Von der Ehrenamt-App als Entwurf angelegt – ein Mensch prüft und verschickt.') : null,
    h('pre', {}, m.body),
    m.attachments.length ? h('div', {}, m.attachments.map(f => fileLink(f))) : null,
    h('div', { class: 'row' },
      m.folder === 'inbox' ? h('a', { href: `/eml/${m.id}` }, h('button', { class: 'small' }, 'Als .eml herunterladen')) : null,
      m.folder === 'inbox' ? h('button', { class: 'small', onclick: () => { compose.hidden = false; to.focus(); } }, 'Antworten') : null),
    compose);
}

// ---------- Briefkasten ----------
async function viewBriefkasten() {
  const list = await api('/api/post');
  clear(main, h('h1', {}, 'Briefkasten am Vereinsheim'),
    h('p', { class: 'muted small' }, 'Papierpost. Der Multifunktionsdrucker im Vereinsheim kann einscannen und ans Vorstandspostfach mailen – oder du lädst das PDF herunter und erfasst es in der App mit Anhang.'),
    list.length ? h('div', { class: 'grid' }, list.map(p => h('article', { class: `card letter ${p.status}` },
      h('div', { class: 'row' }, h('h3', {}, p.title), h('span', { class: 'spacer' }), h('span', { class: `tag ${p.status === 'neu' ? 'orange' : ''}` }, { neu: 'neu', gescannt: 'eingescannt', abgeheftet: 'abgeheftet' }[p.status])),
      h('div', { class: 'small muted' }, `${p.from} · ${dt(p.date)}`),
      h('div', { class: 'paper' }, p.text),
      p.file ? fileLink(p.file) : null,
      h('div', { class: 'row' },
        h('button', { class: 'primary small', onclick: () => act(() => api(`/api/post/${p.id}/scan`, {}), 'Eingescannt – liegt jetzt im Vorstandspostfach') }, 'Scannen und ans Vorstandspostfach'),
        p.status !== 'abgeheftet' ? h('button', { class: 'small', onclick: () => act(() => api(`/api/post/${p.id}/abheften`, {})) }, 'Abheften') : null)))) : h('div', { class: 'empty' }, 'Der Briefkasten ist leer.'));
}

// ---------- WhatsApp ----------
let chatSel = 'vorstand';
async function viewWhatsapp() {
  const chats = await api('/api/chats');
  const c = chats.find(x => x.key === chatSel) || chats[0];
  api(`/api/chats/${c.key}/gelesen`, {}).then(refresh).catch(() => {});
  clear(main, h('h1', {}, 'WhatsApp-Gruppen'),
    h('p', { class: 'muted small' }, 'So läuft es in vielen Vereinen. Wichtiges gehört in die App: Text kopieren und dort „Eingang erfassen“ (Kanal WhatsApp), Fotos als Anhang.'),
    h('div', { class: 'chat' },
      h('div', { class: 'chatlist' }, chats.map(x => h('button', { class: x.key === c.key ? 'sel' : '', onclick: () => { chatSel = x.key; render(); } }, x.name, h('span', { class: 'muted' }, x.messages.length)))),
      h('div', { class: 'bubbles' }, c.messages.length ? c.messages.map(m => h('div', { class: 'bubble' },
        h('time', {}, dt(m.at)), h('b', {}, m.from), m.text,
        m.files.length ? h('div', {}, m.files.map(f => fileLink(f))) : null,
        h('div', {}, h('button', { class: 'small', onclick: () => copy(`${m.from}: ${m.text}`) }, 'Text kopieren')))) : h('div', { class: 'empty' }, 'Noch keine Nachrichten.'))));
}

// ---------- Vereinsordner ----------
async function viewOrdner() {
  const docs = await api('/api/ordner');
  clear(main, h('h1', {}, 'Vereinsordner'),
    h('p', { class: 'muted small' }, 'Alles, was der Vorstand bisher hat. Damit richtest du die App ein: Satzung in die Wissensbasis, Ämterliste für Konten und Ämter, Jahresplan für den Jahreskalender, Asana-Export zum Übernehmen, Sponsoren, Mitgliederexport für die Beitragsprüfung.'),
    h('div', { class: 'grid' }, docs.map(x => h('article', { class: 'card doc' },
      h('div', { class: 'row' }, h('h3', {}, x.title), h('span', { class: 'spacer' }), h('span', { class: `tag ${x.title.includes('meinVerein') ? 'orange' : ''}` }, x.title.includes('meinVerein') ? 'gelbe Daten' : x.kind.toUpperCase())),
      h('p', { class: 'small' }, x.description),
      h('div', { class: 'row' }, fileLink(x.file), x.text ? h('button', { class: 'small', onclick: () => copy(x.text, x.title) }, 'Text kopieren') : null)))),
    h('h2', {}, 'Vorstand und Postfächer'),
    h('section', { class: 'card' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Amt'), h('th', {}, 'Bereich'), h('th', {}, 'Mail'))),
      h('tbody', {}, WELT.people.map(p => h('tr', {}, h('td', {}, p.name, p.you ? ' (du)' : ''), h('td', {}, p.role, p.admin ? ' · Admin' : ''), h('td', {}, p.area), h('td', { class: 'mono' }, p.mail)))))));
}

// ---------- click-TT ----------
async function viewClicktt() {
  const c = await api('/api/clicktt');
  clear(main, h('h1', {}, 'click-TT'),
    h('p', { class: 'muted small' }, 'Die Spielpläne des Verbands. Jede Mannschaft hat einen Kalender-Export (iCal). Diese Adresse in der App unter Adminpanel → Verbindungen → Spielpläne eintragen, Heimspiel-Erkennung „TTV Musterhausen“.'),
    h('div', { class: 'grid' }, c.teams.map(t => h('article', { class: 'card doc' }, h('h3', {}, `TTV Musterhausen · ${t.name}`), h('div', { class: 'small muted' }, t.liga),
      h('div', { class: 'copybox' }, h('code', {}, t.ics), h('button', { class: 'small', onclick: () => copy(t.ics, 'ICS-Adresse') }, 'Kopieren'))))),
    h('h2', {}, 'Nächste Spiele'),
    h('section', { class: 'card' }, h('table', {}, h('tbody', {}, c.games.map(g => h('tr', {}, h('td', {}, d(g.date)), h('td', {}, g.time), h('td', {}, g.home ? '🏠 ' : '', g.summary), h('td', { class: 'muted' }, g.location)))))));
}

// ---------- Microsoft 365 ----------
async function viewM365() {
  const m = await api('/api/m365');
  const row = (k, v) => h('tr', {}, h('th', {}, k), h('td', {}, h('div', { class: 'copybox' }, h('code', {}, v), h('button', { class: 'small', onclick: () => copy(v, k) }, 'Kopieren'))));
  clear(main, h('h1', {}, 'Microsoft 365 des Vereins'),
    h('section', { class: 'card' },
      h('p', {}, 'Euer IT-Helfer hat die App-Registrierung schon angelegt (nur Mails lesen, Entwürfe anlegen, Kalender, Dateien – kein Versand). ', h('strong', {}, 'Die Zugangsdaten stehen bereits in der .env der Simulator-App.'), ' In der App musst du nur noch eintragen, welche Postfächer sie lesen soll: Adminpanel → Verbindungen → Microsoft 365.'),
      h('table', {}, h('tbody', {},
        WELT.mailboxes.map(mb => row(`Postfach ${mb.name}`, mb.address)),
        row('Kalender-Postfach', m.info.kalender), row('Ablageort (SharePoint)', m.info.ablage_ziel)))),
    h('h2', {}, 'Was die App im Tenant getan hat'),
    h('p', { class: 'muted small' }, `Entwürfe liegen im jeweiligen Postfach unter „Entwürfe“ (${m.drafts}). Verschickt wird nur von Hand.`),
    h('section', { class: 'card' }, m.aussen.length ? h('ul', { class: 'log' }, m.aussen.map(a => h('li', {}, h('time', {}, dt(a.at)), h('span', {}, { entwurf: '✉️ ', termin: '📅 ', ablage: '📁 ', claude: '🤖 ' }[a.kind] || '', a.text, a.file ? ' · ' : '', a.file ? h('a', { href: `/datei/${a.file}` }, 'Datei') : null)))) : h('p', { class: 'muted' }, 'Noch nichts.')));
}

// ---------- Jugendplaner ----------
async function viewJugendplaner() {
  const jp = await api('/api/jugendplaner');
  const team = (id) => jp.teams.find(t => t.id === id) || { name: id, players: [], reserves: [], minPlayers: 3 };
  const set = (b, msg) => act(() => api('/api/jugendplaner/set', b), msg);
  const cycle = { '': 'y', y: 'n', n: '' };
  clear(main, h('h1', {}, 'Jugendplaner'),
    h('p', { class: 'muted small' }, 'Der Jugendplaner des Vereins (Nachbau mit Fantasiedaten): Spiele der Jugend, Zusagen der Kinder, Fahrer und Betreuer. Hier handelst du als Jugendleitung bzw. als Eltern. Die Ehrenamt-App liest nur mit und meldet Lücken.'),
    h('section', { class: 'card' }, h('div', { class: 'copybox' }, h('span', { class: 'small muted' }, 'Adresse für die App (steht im Simulator schon in der .env):'), h('code', {}, jp.url))),
    h('h2', {}, 'Nächste Spiele'),
    h('div', { class: 'grid' }, jp.games.map(g => {
      const t = team(g.team);
      const roster = [...(t.players || []), ...(t.reserves || [])];
      const yes = Object.values(g.avail || {}).filter(v => v === 'y').length;
      const drv = h('input', { list: 'eltern', value: g.drivers || '', placeholder: 'Fahrer/Betreuer' });
      return h('article', { class: `card ev ${g.cancelled ? '' : g.drivers ? 'geloest' : 'laeuft'}` },
        h('div', { class: 'row' }, h('h3', {}, `${t.name} ${g.home ? 'gegen' : 'bei'} ${g.opponent}`), h('span', { class: 'spacer' }), h('span', { class: `tag ${g.cancelled ? '' : g.drivers ? 'green' : 'orange'}` }, g.cancelled ? 'abgesagt' : g.drivers ? 'Fahrer fest' : g.respTeam ? 'Mannschaft sucht' : 'offen')),
        h('div', { class: 'meta' }, `${d(g.date)} · ${g.time || '–'} Uhr · ${g.home ? 'Heimspiel' : g.hall} · Zusagen ${yes}/${t.minPlayers}`),
        h('div', { class: 'row' }, drv, h('button', { class: 'small primary', onclick: () => set({ id: g.id, field: 'drivers', value: drv.value }, 'Im Jugendplaner gespeichert') }, 'Eintragen')),
        h('div', { class: 'row small' }, roster.map(p => h('button', { class: `small ${g.avail?.[p] === 'y' ? 'on' : ''}`, title: 'Zusage → Absage → keine Antwort', onclick: () => set({ id: g.id, field: 'avail', player: p, value: cycle[g.avail?.[p] || ''] }) },
          `${g.avail?.[p] === 'y' ? '✓' : g.avail?.[p] === 'n' ? '✕' : '?'} ${p.split(' ')[0]}`))),
        h('div', { class: 'row' }, h('button', { class: 'small', onclick: () => set({ id: g.id, field: 'cancelled', value: !g.cancelled }) }, g.cancelled ? 'Wieder ansetzen' : 'Spiel absagen')));
    })),
    h('datalist', { id: 'eltern' }, jp.parents.map(p => h('option', { value: p }))));
}

// ---------- Router ----------
const VIEWS = { jugendplaner: viewJugendplaner, start: viewStart, postfach: viewPostfach, briefkasten: viewBriefkasten, whatsapp: viewWhatsapp, ordner: viewOrdner, clicktt: viewClicktt, m365: viewM365 };
async function render() {
  document.body.classList.remove('nav-open');
  const key = location.hash.slice(1).split('/')[0] || 'start';
  drawNav();
  try { await (VIEWS[key] || viewStart)(); } catch (e) { clear(main, h('div', { class: 'empty' }, e.message)); }
}
async function act(fn, msg) {
  $('#busy').hidden = false;
  document.querySelectorAll('.time-btns button').forEach(b => { b.disabled = true; });
  try { const r = await fn(); if (r?.einrichtung) S = r; await refresh(); if (msg) toast(msg); await render(); } catch (e) { fail(e); }
  $('#busy').hidden = true;
  document.querySelectorAll('.time-btns button').forEach(b => { b.disabled = false; });
}

document.querySelectorAll('.time-btns button').forEach(b => b.addEventListener('click', () => act(() => api('/api/zeit', { days: Number(b.dataset.days) }), `${b.dataset.days} Tag(e) vergangen`)));
$('#menu').addEventListener('click', () => document.body.classList.toggle('nav-open'));
window.addEventListener('hashchange', render);

(async () => {
  WELT = await api('/api/welt');
  $('#applink').href = WELT.app_url;
  await refresh();
  await render();
  // Stand regelmäßig auffrischen (die App ändert Daten, die Welt hakt ab)
  setInterval(async () => {
    if (document.hidden) return;
    const before = JSON.stringify([S?.score, S?.unread, S?.log?.[0]]);
    await refresh().catch(() => {});
    const key = location.hash.slice(1) || 'start';
    if (JSON.stringify([S?.score, S?.unread, S?.log?.[0]]) !== before && ['start', 'briefkasten', 'm365'].includes(key) && !document.activeElement?.matches('input, textarea')) render();
  }, 6000);
})();
