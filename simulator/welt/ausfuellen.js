// Kapitel 1 abkürzen: Einen Einrichtungsschritt „ausfüllen lassen“.
// Der Assistent arbeitet über die normalen Schnittstellen der App – als die Spielerin (erstes Admin-Konto),
// mit allen Prüfungen, genau so, als würde man es selbst eintippen. Alles steht danach im Protokoll der App.

import { q } from '../../server/db.js';
import { createSession, sessionCookie } from '../../server/auth.js';
import { addDays, today } from '../../server/util.js';
import { W, readFile, log } from './zustand.js';
import { MAILBOX, PEOPLE, TEAMS, sponsors } from './verein.js';

const AREA = { 'TTV Musterhausen': 'Musterhausen', 'SV Beispieldorf': 'Beispieldorf', 'Bezirk Musterkreis': 'Musterkreis' };
const DEPUTY = { Vorsitz: 'sara', Kasse: null, Sportwart: 'mia', Jugendwart: 'mia', 'Öffentlichkeitsarbeit': 'frieda', Schriftführung: 'mia', Mitgliederverwaltung: 'ben', Sponsoring: 'sara', Veranstaltungen: 'sara' };
const JAHRESPLAN = { 'Jahresabschluss': [1, 15], 'Beitragsstufen prüfen': [12, 1], 'Beitragseinzug vorbereiten': [2, 15], 'Mitgliederversammlung': [3, 20], 'Mannschaftsmeldung Vorrunde': [5, 31], 'Saisonstart vorbereiten': [8, 20], 'Sponsorentreffen': [11, 5], 'Mannschaftsmeldung Rückrunde': [12, 1] };

class App {
  constructor(base, cookie) { this.base = base; this.cookie = cookie; }
  async req(method, url, body) {
    const r = await fetch(this.base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'tte', Cookie: this.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const d = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error(d?.error || `Fehler ${r.status} bei ${url}`), { status: 400 });
    return d;
  }
  get(u) { return this.req('GET', u); }
  post(u, b = {}) { return this.req('POST', u, b); }
  put(u, b = {}) { return this.req('PUT', u, b); }
}

function session(appUrl) {
  const player = q.get(`SELECT * FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1`);
  if (!player) throw Object.assign(new Error('Zuerst in der App das erste Konto anlegen – das ist der einzige Schritt, den du selbst machen musst.'), { status: 400 });
  const token = createSession(player.id, { headers: { 'user-agent': 'Vereinswelt-Assistent' }, socket: { remoteAddress: '127.0.0.1' } });
  return { app: new App(appUrl, sessionCookie(token).split(';')[0]), player, done: () => q.run(`DELETE FROM sessions WHERE user_agent = 'Vereinswelt-Assistent'`) };
}

async function areas(app) {
  const list = await app.get('/api/areas');
  const find = (w) => list.find(a => a.active && a.name.includes(w));
  return { list, ttv: find('Musterhausen'), sv: find('Beispieldorf'), bezirk: find('Musterkreis') };
}
async function users(app) { return Object.fromEntries((await app.get('/api/users')).map(u => [u.name, u.id])); }
const personId = (U, key, player) => key === 'mia' ? player.id : U[PEOPLE.find(p => p.key === key)?.name] ?? null;

const STEPS = {
  async bereiche(app) {
    let a = await areas(app);
    if (!a.ttv) {
      const first = a.list.find(x => x.type === 'verein' && x.active && !x.name.includes('Beispieldorf'));
      if (first) await app.put(`/api/areas/${first.id}`, { name: 'TTV Musterhausen' });
      else await app.post('/api/areas', { name: 'TTV Musterhausen', type: 'verein' });
    }
    if (!a.bezirk) await app.post('/api/areas', { name: 'Bezirk Musterkreis', type: 'bezirk', color: '#9333ea' });
    if (W().zweiterVerein && !a.sv) await app.post('/api/areas', { name: 'SV Beispieldorf', type: 'verein', color: '#0d9488' });
    return 'Bereiche angelegt bzw. umbenannt';
  },
  async konten(app, ctx) {
    if (!(await areas(app)).ttv) await STEPS.bereiche(app);
    const a = await areas(app);
    const U = await users(app);
    let n = 0;
    for (const p of PEOPLE.filter(x => !x.you)) {
      const area = a[{ 'TTV Musterhausen': 'ttv', 'SV Beispieldorf': 'sv', 'Bezirk Musterkreis': 'bezirk' }[p.area]];
      if (!area || U[p.name]) continue;
      // Kein Passwort: die App vergibt ein vorläufiges, das die Person bei der ersten Anmeldung ändert
      await app.post('/api/users', { name: p.name, login: p.key, role: p.admin ? 'admin' : 'zuarbeit', areas: [area.id] });
      n++;
    }
    return `${n} Konto/Konten angelegt (vorläufige Passwörter – im Simulator nicht nötig, du bleibst Mia)`;
  },
  async aemter(app, ctx) {
    if (Object.keys(await users(app)).length < 3) await STEPS.konten(app, ctx);
    const a = await areas(app);
    const U = await users(app);
    const offices = await app.get('/api/offices');
    let n = 0;
    for (const o of offices) {
      let holder = null, deputy = null;
      if (o.area_id === a.ttv?.id) {
        const p = PEOPLE.find(x => x.area === 'TTV Musterhausen' && x.office === o.name) || (o.name === 'Sponsoring' ? { key: 'mia' } : null);
        holder = p ? personId(U, p.key, ctx.player) : null;
        deputy = DEPUTY[o.name] ? personId(U, DEPUTY[o.name], ctx.player) : null;
      } else if (o.area_id === a.bezirk?.id) { holder = personId(U, 'tom', ctx.player); deputy = ctx.player.id; }
      else if (o.area_id === a.sv?.id) { holder = personId(U, 'udo', ctx.player); deputy = personId(U, 'ben', ctx.player); }
      else continue;
      if (deputy === holder) deputy = null;
      await app.put(`/api/offices/${o.id}`, { holder_id: holder, deputy_id: deputy });
      n++;
    }
    return `${n} Ämter mit Inhaber und Vertretung laut Ämterliste besetzt`;
  },
  async vertretung(app, ctx) { return STEPS.aemter(app, ctx); },
  async fristen(app) { await app.put('/api/settings', { einladung_frist_tage: 21, antrag_frist_tage: 7, kuendigung_frist_monate: 3 }); return 'Fristen laut Satzung eingetragen'; },
  async beitraege(app) {
    await app.put('/api/settings', { beitragsstufen: [{ name: 'Kinder und Jugendliche', ab_alter: 0, bis_alter: 17, beitrag: 48 }, { name: 'Erwachsene', ab_alter: 18, bis_alter: null, beitrag: 96 }] });
    return 'Beitragsstufen laut Beitragsordnung eingetragen';
  },
  async satzung(app) {
    const a = await areas(app);
    const doc = (t) => W().docs.find(d => d.title === t);
    for (const [title, type, name] of [['Satzung', 'satzung', 'Satzung TTV Musterhausen'], ['Beitragsordnung', 'ordnung', 'Beitragsordnung TTV Musterhausen']]) {
      if ((await app.get('/api/kb/documents')).some(d => d.title === name)) continue;
      await app.post('/api/kb/documents', { title: name, source_type: type, area_id: a.ttv?.id || null, text: doc(title).text });
    }
    return 'Satzung und Beitragsordnung in die Wissensbasis übernommen';
  },
  async datenschutz(app) { await app.put('/api/settings', { gelb_lokal: true, gelb_extern: true }); return 'Beide Datenschutz-Schalter an (im Simulator gibt es nur Fantasiedaten)'; },
  async postfach(app) {
    const a = await areas(app);
    const boxes = [[MAILBOX.ttv, a.ttv], [MAILBOX.bezirk, a.bezirk], [MAILBOX.sv, a.sv]].filter(([, ar]) => ar).map(([address, ar]) => ({ address, area_id: ar.id }));
    if (!boxes.length) boxes.push({ address: MAILBOX.ttv, area_id: null });
    await app.put('/api/connections/m365', { mailboxes: boxes, kalender_postfach: MAILBOX.ttv, ablage_ziel: `users/${MAILBOX.ttv}/drive`, ablage_ordner: 'Ehrenamt-App' });
    return `${boxes.length} Postfach/Postfächer verbunden`;
  },
  async spielplan(app, ctx) {
    const a = await areas(app);
    if (!a.ttv) await STEPS.bereiche(app);
    const ttv = (await areas(app)).ttv;
    const have = (await app.get('/api/connections')).feeds.map(f => f.url);
    const tpl = (await app.get('/api/process-templates')).find(t => t.key === 'VOR-16');
    let n = 0;
    for (const key of Object.keys(TEAMS)) {
      const url = `${ctx.base}/clicktt/${key}.ics`;
      if (have.includes(url)) continue;
      const f = await app.post('/api/feeds', { area_id: ttv.id, name: `${TEAMS[key].name} (${TEAMS[key].liga})`, url, home_pattern: 'TTV Musterhausen', create_tasks: true, template_id: tpl?.id || null, lead_days: 10 });
      await app.post(`/api/feeds/${f.id}/sync`).catch(() => {});
      n++;
    }
    return `${n} Spielplan-Abo(s) angelegt`;
  },
  async asana(app, ctx) {
    const a = await areas(app);
    if (!a.ttv) await STEPS.bereiche(app);
    const U = await users(app);
    const doc = W().docs.find(d => d.title.startsWith('Asana'));
    const csv = readFile(doc.file).toString('utf8');
    const map = Object.fromEntries(PEOPLE.map(p => [p.name, personId(U, p.key, ctx.player)]));
    const r = await app.post('/api/import/asana', { csv, area_id: (await areas(app)).ttv.id, assignees: map, include_completed: true });
    return `${r.tasks} Aufgaben und ${r.steps} Teilschritte aus Asana übernommen`;
  },
  async kalender(app) {
    const a = await areas(app);
    const rec = await app.get('/api/recurring');
    for (const r of rec.filter(x => x.area_id === a.ttv?.id && JAHRESPLAN[x.title])) await app.put(`/api/recurring/${r.id}`, { month: JAHRESPLAN[r.title][0], day: JAHRESPLAN[r.title][1], lead_days: r.lead_days });
    await app.post('/api/setup/confirm-calendar', { ids: rec.map(r => r.id) });
    return 'Jahreskalender nach dem Jahresplan korrigiert und bestätigt';
  },
  async sponsoren(app, ctx) {
    const a = await areas(app);
    const U = await users(app);
    const have = (await app.get('/api/sponsors')).map?.(s => s.company) || [];
    let n = 0;
    for (const s of sponsors(W().start)) {
      const area = s.status.includes('Beispieldorf') ? a.sv : a.ttv;
      if (!area || have.includes(s.company)) continue;
      const pate = PEOPLE.find(p => p.name === s.pate);
      await app.post('/api/sponsors', { area_id: area.id, company: s.company, contact_name: s.contact, category: s.kategorie, start_date: s.start || null, end_date: s.ende || null,
        status: s.status.startsWith('in Verhandlung') ? 'verhandlung' : 'aktiv', godparent_id: pate ? personId(U, pate.key, ctx.player) : null });
      n++;
    }
    return `${n} Sponsor(en) erfasst`;
  },
  async jugendplaner(app) {
    const a = await areas(app);
    if (!a.ttv) await STEPS.bereiche(app);
    await app.put('/api/jugendplaner', { area_id: (await areas(app)).ttv.id });
    const r = await app.post('/api/jugendplaner/sync');
    await app.post('/api/jugendplaner/feed').catch(() => {});
    return `Jugendplaner angebunden: ${r.counts.spiele} Spiele, ${r.counts.kritisch} mit kritischem Hinweis`;
  },
  async automatik(app) { await app.post('/api/setup/preset', { preset: 'umfassend', approve_examples: true }); return 'Voreinstellung „Umfassend“ gewählt, Beispielregeln freigegeben'; },
  async fertig(app) {
    for (const k of ['verein', 'personen', 'satzung', 'datenschutz', 'verbindungen', 'automatisierung', 'kalender', 'wissen', 'start']) await app.post('/api/setup/step', { key: k });
    return 'Einrichtungsassistent abgeschlossen';
  },
};

export const ausfuellbar = (key) => key in STEPS;

/** Füllt einen Schritt (oder mit key 'alle' alle offenen) aus. Gibt die Meldungen zurück. */
export async function ausfuellen(key, { appUrl, base, offen = [] }) {
  const s = session(appUrl);
  const ctx = { player: s.player, base };
  const keys = key === 'alle' ? offen.filter(k => STEPS[k]) : [key];
  const out = [];
  try {
    for (const k of keys) {
      if (!STEPS[k]) throw Object.assign(new Error('Diesen Schritt kann der Assistent nicht übernehmen.'), { status: 400 });
      const msg = await STEPS[k](s.app, ctx);
      out.push(msg);
      log(`🪄 Ausgefüllt: ${msg}`, 'welt');
    }
  } finally { s.done(); }
  return out;
}

export { today, addDays };
