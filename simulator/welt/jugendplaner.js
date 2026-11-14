// Nachbau des TTV-Jugendplaners (Version 2) für Vereinswelt und Tests – nur Fantasiedaten.
// Gleiche Schnittstelle wie das Original: api.php?action=login|state, ics.php?k=…, Anmeldung per HMAC-Token.

import crypto from 'node:crypto';
import { addDays, today } from '../../server/util.js';

export const JP_SECRET = 'vereinswelt-jugendplaner-geheimnis-nur-fantasie';
export const JP_PINS = { admin: 'jugend-admin-1234', mf: 'jugend-mf-1234', eltern: 'jugend-eltern-1234' };

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sign = (p) => b64u(crypto.createHmac('sha256', JP_SECRET).update(p).digest());
export function makeToken(role, days = 120) { const p = `${role}|${Math.floor(Date.now() / 1000) + days * 86400}`; return `${b64u(p)}.${sign(p)}`; }
export function checkToken(t) {
  if (!t || !t.includes('.')) return null;
  const [p64, s] = t.split('.', 2);
  const p = Buffer.from(p64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
  if (sign(p) !== s) return null;
  const [role, exp] = p.split('|');
  return Number(exp) > Date.now() / 1000 && ['admin', 'mf', 'eltern'].includes(role) ? role : null;
}
export const icsKey = () => sign('ics-feed').slice(0, 22);

const KIDS = ['Anton Ahorn', 'Bea Birke', 'Cem Erle', 'Dora Esche', 'Emil Fichte', 'Fiona Linde', 'Gustav Pappel', 'Hanna Ulme', 'Ilias Weide', 'Jule Eiche', 'Kian Kiefer', 'Lotta Buche', 'Mats Tanne', 'Nele Lärche', 'Oskar Hasel'];
const PARENTS = ['Petra Ahorn', 'Ralf Birke', 'Sandra Erle', 'Tim Esche', 'Ute Fichte', 'Volker Linde'];
export const jpParents = () => PARENTS;
const OPP = ['SV Nachbarort', 'TTC Hügelhausen', 'DJK Talstadt', 'TSV Flussdorf', 'TTF Bergheim', 'SpVgg Weiler'];

/** Fantasie-Stand für die Saison ab heute. adultGames: [{date,time,team(herren1|herren2),home,opponent}] */
export function makeJugendplaner(adultGames = []) {
  const start = today();
  const sat = (n) => { let d = addDays(start, n); while (new Date(d + 'T12:00:00Z').getUTCDay() !== 6) d = addDays(d, 1); return d; };
  const youthTeams = [
    { id: 'U11', name: 'U11', minPlayers: 3, players: KIDS.slice(0, 4), reserves: [KIDS[4]], ctt: '', age: 11, girls: false, nr: 1 },
    { id: 'U13', name: 'U13', minPlayers: 3, players: KIDS.slice(5, 9), reserves: [KIDS[9]], ctt: '', age: 13, girls: false, nr: 1 },
    { id: 'U15', name: 'U15', minPlayers: 4, players: KIDS.slice(10, 15), reserves: [], ctt: '', age: 15, girls: false, nr: 1 },
  ];
  const adultTeams = [
    { id: 'H1', name: 'Herren I', captain: 'Sara Satz', members: ['Mia Muster', 'Ben Beispiel', 'Tom Turnier', 'Volker Linde'], ctt: '', rotation: false },
    { id: 'H2', name: 'Herren II', captain: 'Ralf Birke', members: ['Paul Presse', 'Max Mitglied', 'Mats Tanne', 'Kian Kiefer'], ctt: '', rotation: true },
  ];
  const games = [];
  let n = 0;
  for (let w = 0; w < 6; w++) {
    for (const [i, t] of youthTeams.entries()) {
      const date = w % 2 === i % 2 ? sat(1 + w * 7) : addDays(sat(1 + w * 7), 1);
      const home = (w + i) % 2 === 0;
      const roster = [...t.players, ...t.reserves];
      const avail = {};
      roster.forEach((k, j) => { if (j < (w === 0 && i === 1 ? 2 : roster.length - 1)) avail[k] = 'y'; });
      const g = { id: `g${String(++n).padStart(3, '0')}`, date, time: t.id === 'U15' ? '14:00' : '10:00', team: t.id, home, opponent: `${OPP[(w + i) % OPP.length]} ${t.name}`,
        hall: home ? '' : `Halle ${OPP[(w + i) % OPP.length]}`, address: '', meet: '', drivers: '', respTeam: '', betreuer: '', avail, lineup: '', notes: '', cancelled: false, lineupPlayers: [] };
      if (w >= 2) g.drivers = PARENTS[(w + i) % PARENTS.length];                  // später: Fahrer schon fest
      else if (w === 1 && i === 0) g.respTeam = 'H1';                             // Herren I soll betreuen
      else if (w === 1 && i === 2) { g.drivers = 'Volker Linde'; }                // fährt – spielt aber evtl. selbst (Konflikt)
      games.push(g);
    }
  }
  return {
    version: 2, rev: 1, season: `${start.slice(0, 4)}/${String(Number(start.slice(2, 4)) + 1).padStart(2, '0')}`, updated: new Date().toISOString(),
    settings: { club: 'TTV Musterhausen', homeHall: 'Sporthalle Musterhausen', homeAddress: 'Schulstraße 1, 12345 Musterhausen', meetOffsetMin: 60, conflictHours: 3, urgentDays: 14, clubNr: '0000000', skin: 'verein' },
    youthTeams, adultTeams, games,
    adultGames: adultGames.map((a, i) => ({ id: `a${i}`, date: a.date, time: a.time, team: a.team === 'herren2' ? 'H2' : 'H1', home: a.home, opponent: a.opponent, league: '', result: '', src: 'click-TT' })),
    log: [],
  };
}

function ics(data, base) {
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const teams = new Map(data.youthTeams.map(t => [t.id, t.name]));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vereinswelt//Jugendplaner-Nachbau//DE'];
  for (const g of data.games) {
    const [hh, mm] = (g.time || '10:00').split(':');
    const d = g.date.replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${g.id}@ttv-jugendplaner`, `DTSTART;TZID=Europe/Berlin:${d}T${hh}${mm}00`, `DTEND;TZID=Europe/Berlin:${d}T${String(Number(hh) + 3).padStart(2, '0')}${mm}00`,
      `SUMMARY:${esc(`${g.cancelled ? 'ABGESAGT: ' : ''}🏓 ${teams.get(g.team) || g.team}${g.home ? ' vs. ' : ' @ '}${g.opponent}`)}`,
      `LOCATION:${esc(g.home ? data.settings.homeHall : g.hall)}`, `DESCRIPTION:${esc(`Fahrer/Betreuer: ${g.drivers || g.betreuer || 'noch offen'}`)}`, ...(g.cancelled ? ['STATUS:CANCELLED'] : []), 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/**
 * HTTP-Behandlung unter einem Präfix (z. B. /jugendplaner). getData/saveData liefern bzw. speichern den Stand.
 * Gibt false zurück, wenn die Anfrage nicht hierher gehört.
 */
export async function handleJugendplaner(req, res, url, prefix, { getData, saveData }) {
  if (!url.pathname.startsWith(prefix + '/')) return false;
  const p = url.pathname.slice(prefix.length);
  const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = (() => { try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; } })();
  if (p === '/ics.php') {
    if (url.searchParams.get('k') !== icsKey()) { res.writeHead(403); res.end('Ungültiger Kalender-Link'); return true; }
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' }); res.end(ics(getData())); return true;
  }
  if (p !== '/api.php') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><meta charset="utf-8"><title>Jugendplaner (Nachbau)</title><p>Jugendplaner-Nachbau der Vereinswelt. Bedienung in der Vereinswelt unter „Jugendplaner“.</p>'); return true; }
  const action = url.searchParams.get('action');
  if (action === 'login') {
    const role = Object.entries(JP_PINS).find(([, pin]) => pin === String(body.pin || ''))?.[0];
    if (!role) { json({ error: 'Falsche PIN' }, 403); return true; }
    json({ token: makeToken(role), role }); return true;
  }
  const role = checkToken(req.headers['x-token'] || body.token);
  if (!role) { json({ error: 'Bitte anmelden' }, 401); return true; }
  if (action === 'state') {
    const d = structuredClone(getData());
    if (role !== 'admin') d.log = [];
    json({ role, version: '2.0.0', icsKey: icsKey(), defaultConfig: false, data: d }); return true;
  }
  // Ein paar Änderungen, wie sie Eltern und Mannschaftsführer im Jugendplaner machen
  const d = getData();
  const g = d.games.find(x => x.id === body.id);
  if (action === 'setAvail' && g) { if (body.value) g.avail[body.player] = body.value; else delete g.avail[body.player]; }
  else if (action === 'setBetreuer' && g) { g.betreuer = String(body.betreuer || ''); }
  else if (action === 'saveGame' && g) { for (const k of ['drivers', 'betreuer', 'cancelled', 'date', 'time', 'notes']) if (k in (body.game || {})) g[k] = body.game[k]; }
  else { json({ error: 'Unbekannte Aktion' }, 400); return true; }
  d.rev = (d.rev || 0) + 1;
  saveData(d);
  json({ ok: true, rev: d.rev });
  return true;
}
