// Auslosungen: Trainingspaare/Doppel, Gruppen (mit Setzung nach Spielstärke), KO-Baum, Reihenfolge.
// Jede Auslosung hat einen Zufallswert (seed): Mit demselben Wert und denselben Teilnehmenden
// kommt dasselbe Ergebnis heraus – so lässt sich eine Auslosung jederzeit nachprüfen.

import crypto from 'node:crypto';
import { bad } from '../util.js';

/** Zufallszahlen aus einem Text (mulberry32 auf einem SHA-256-Hash). */
export function rng(seed) {
  let a = crypto.createHash('sha256').update(String(seed)).digest().readUInt32LE(0);
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const newSeed = () => crypto.randomBytes(4).toString('hex');

function shuffle(list, r) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const byTtr = (list) => [...list].sort((x, y) => (y.ttr || 0) - (x.ttr || 0));

/** Paare. balance: stärkste mit schwächster Person (z. B. ausgeglichene Doppel). Ungerade Zahl: Dreiergruppe. */
function paare(people, r, { balance }) {
  let list;
  if (balance) {
    const s = byTtr(shuffle(people, r)); // bei gleicher Stärke entscheidet das Los
    list = [];
    while (s.length > 1) list.push([s.shift(), s.pop()]);
    if (s.length) list[list.length - 1]?.push(s[0]) ?? list.push([s[0]]);
    list = shuffle(list, r);
  } else {
    const s = shuffle(people, r);
    list = [];
    for (let i = 0; i + 1 < s.length; i += 2) list.push([s[i], s[i + 1]]);
    if (s.length % 2) list.length ? list[list.length - 1].push(s.at(-1)) : list.push([s.at(-1)]);
  }
  return { pairs: list };
}

/** Gruppen. seeded: Schlangenlinie nach Spielstärke (Lostöpfe), sonst rein zufällig. */
function gruppen(people, r, { groups, seeded }) {
  const k = Math.max(2, Math.min(Number(groups) || 2, people.length));
  const out = Array.from({ length: k }, () => []);
  if (seeded) {
    const sorted = byTtr(people);
    for (let pot = 0; pot * k < sorted.length; pot++) {
      const potList = shuffle(sorted.slice(pot * k, pot * k + k), r);            // innerhalb des Topfs entscheidet das Los
      const order = pot % 2 === 0 ? out.map((_, i) => i) : out.map((_, i) => k - 1 - i);
      potList.forEach((p, i) => out[order[i]].push(p));
    }
  } else shuffle(people, r).forEach((p, i) => out[i % k].push(p));
  return { groups: out.map((g, i) => ({ name: `Gruppe ${String.fromCharCode(65 + i)}`, members: g })) };
}

/** Setzpositionen eines KO-Baums (1 und 2 treffen sich erst im Finale usw.). */
function seedOrder(size) {
  let order = [1];
  while (order.length < size) { const n = order.length * 2 + 1; order = order.flatMap(s => [s, n - s]); }
  return order;
}

/** KO-Baum mit Freilosen. seeded: nach Spielstärke gesetzt, Freilose gehen an die Gesetzten. */
function ko(people, r, { seeded }) {
  let size = 2;
  while (size < people.length) size *= 2;
  const ordered = seeded ? byTtr(shuffle(people, r)) : shuffle(people, r);
  const slots = seedOrder(size).map(s => ordered[s - 1] || null);
  const matches = [];
  for (let i = 0; i < size; i += 2) matches.push([slots[i], slots[i + 1]]);
  return { size, matches, byes: size - people.length };
}

function reihenfolge(people, r) { return { order: shuffle(people, r) }; }

export const MODES = {
  paare: { label: 'Paare (Training, Doppel)', run: paare },
  gruppen: { label: 'Gruppen', run: gruppen },
  ko: { label: 'KO-Baum (Turnier)', run: ko },
  reihenfolge: { label: 'Reihenfolge (z. B. Spielreihenfolge, Dienste)', run: reihenfolge },
};

/** participants: [{ name, ttr?, team? }] */
export function auslosen(mode, participants, options = {}, seed = newSeed()) {
  const m = MODES[mode];
  if (!m) throw bad('Unbekannte Art der Auslosung.');
  const people = participants.map(p => ({ name: String(p.name || '').trim().slice(0, 80), ttr: Number(p.ttr) || null, team: String(p.team || '').slice(0, 40) })).filter(p => p.name);
  if (people.length < 2) throw bad('Für eine Auslosung braucht es mindestens zwei Teilnehmende – links Mitglieder anhaken oder Namen einfügen.');
  if (people.length > 256) throw bad('Höchstens 256 Teilnehmende.');
  return { mode, seed, count: people.length, options, result: m.run(people, rng(`${seed}|${mode}|${people.map(p => p.name).join('|')}`), options) };
}

/** Text zum Kopieren, Drucken oder für einen Entwurf. */
export function asText(d) {
  const n = (p) => p ? `${p.name}${p.ttr ? ` (${p.ttr})` : ''}` : 'Freilos';
  const r = d.result;
  if (d.mode === 'paare') return r.pairs.map((p, i) => `${i + 1}. ${p.map(n).join(' / ')}`).join('\n');
  if (d.mode === 'gruppen') return r.groups.map(g => `${g.name}: ${g.members.map(n).join(', ')}`).join('\n');
  if (d.mode === 'ko') return r.matches.map((m, i) => `Spiel ${i + 1}: ${n(m[0])} – ${n(m[1])}`).join('\n');
  return r.order.map((p, i) => `${i + 1}. ${n(p)}`).join('\n');
}
