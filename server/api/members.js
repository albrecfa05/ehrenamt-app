// Mitgliederliste und Auslosungen.
// Die Mitgliederliste enthält gelbe Daten und wird nur gespeichert, wenn der Verein den Schalter
// „Gelbe Daten lokal verarbeiten“ eingeschaltet hat. Gespeichert wird nur, was für Training,
// Auslosung und Aufstellung nötig ist: Name, Jahrgang, Geschlecht, Mannschaft/Gruppe, Spielstärke.
// Auslosungen mit eingefügten Namen gehen immer – sie werden dann nur angezeigt, nicht gespeichert.

import { del, get, post, put } from '../http.js';
import { q, tx } from '../db.js';
import { requireAdmin, canSeeArea, assertArea } from '../access.js';
import { audit, bad, int, notFound, nowIso, str } from '../util.js';
import { gelbLokal } from '../privacy.js';
import { parseCsv } from './reports.js';
import { auslosen, asText, MODES } from '../services/auslosung.js';

const needGelb = () => { if (!gelbLokal()) throw bad('Die Mitgliederliste enthält gelbe Daten. Dafür in den Einstellungen „Gelbe Daten lokal automatisch verarbeiten“ einschalten. Auslosen mit eingefügten Namen geht auch ohne.'); };

/** Liest CSV (mit Kopfzeile, Komma/Semikolon/Tab) oder einfache Zeilen „Vorname Nachname; Jahrgang; TTR; Mannschaft“. */
export function parseMembers(text) {
  const raw = String(text || '').replace(/^﻿/, '').trim();
  if (!raw) return [];
  const first = raw.split(/\r?\n/)[0];
  const delim = first.includes('\t') ? '\t' : first.split(';').length > first.split(',').length ? ';' : ',';
  const headerish = /vorname|nachname|name|jahrgang|geburt|ttr|mannschaft/i.test(first);
  const yearOf = (v) => { const m = String(v || '').match(/(\d{4})/) || String(v || '').match(/\d{1,2}\.\d{1,2}\.(\d{2})$/); if (!m) return null; let y = Number(m[1]); if (y < 100) y += y > 30 ? 1900 : 2000; return y > 1900 && y < 2100 ? y : null; };
  const out = [];
  if (headerish) {
    const rows = parseCsv(delim === ',' ? raw : raw.split(/\r?\n/).map(l => l.split(delim).map(c => /[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(',')).join('\n'));
    const cols = Object.keys(rows[0] || {});
    const find = (...n) => cols.find(c => n.some(x => c.toLowerCase().replace(/[^a-zäöü]/g, '').includes(x)));
    const cV = find('vorname'), cN = find('nachname', 'familienname'), cName = find('name'), cY = find('geburtsjahr', 'jahrgang', 'geburtsdatum', 'geboren');
    const cT = find('mannschaft', 'team', 'gruppe'), cTtr = find('qttr', 'ttr', 'spielstärke'), cG = find('geschlecht');
    for (const r of rows) {
      let fn = (r[cV] || '').trim(), ln = (r[cN] || '').trim();
      if (!fn && cName) { const parts = String(r[cName] || '').trim().split(/\s+/); fn = parts.shift() || ''; ln = parts.join(' '); }
      if (!fn) continue;
      out.push({ first_name: fn, last_name: ln, birth_year: yearOf(r[cY]), team: (r[cT] || '').trim(), ttr: Number(String(r[cTtr] || '').replace(/\D/g, '')) || null, gender: String(r[cG] || '').trim().slice(0, 1).toLowerCase() });
    }
  } else {
    for (const line of raw.split(/\r?\n/)) {
      const [name, ...rest] = line.split(/[;\t,]/).map(s => s.trim());
      if (!name) continue;
      const parts = name.split(/\s+/);
      const nums = rest.map(Number).filter(Boolean);
      out.push({ first_name: parts.shift(), last_name: parts.join(' '), birth_year: nums.find(n => n > 1900 && n < 2100) || null, ttr: nums.find(n => n < 1900 || n > 2100) || null,
        team: rest.find(x => x && isNaN(Number(x))) || '', gender: '' });
    }
  }
  return out.slice(0, 2000);
}

get('/api/members', ({ user, query }) => {
  const rows = q.all(`SELECT m.*, a.name AS area_name FROM members m JOIN areas a ON a.id = m.area_id WHERE m.active = 1 ${query.area ? 'AND m.area_id = ' + int(query.area) : ''} ORDER BY m.last_name, m.first_name`)
    .filter(m => canSeeArea(user, m.area_id));
  return { enabled: gelbLokal(), members: rows, teams: [...new Set(rows.map(m => m.team).filter(Boolean))].sort() };
});

post('/api/members/import', ({ user, body }) => tx(() => {
  requireAdmin(user);
  needGelb();
  const areaId = int(body.area_id, { nullable: false, name: 'Bereich' });
  assertArea(user, areaId);
  const list = parseMembers(body.text);
  if (!list.length) throw bad('Keine Namen erkannt. Erwartet: CSV mit Kopfzeile (z. B. Vorname, Nachname, Geburtsdatum, Mannschaft, Q-TTR) oder je Zeile „Vorname Nachname; Jahrgang; TTR“.');
  const now = nowIso();
  const source = str(body.source, { max: 80 }) || `Import ${now.slice(0, 10)}`;
  if (body.replace) q.run('DELETE FROM members WHERE area_id = ?', areaId);
  let added = 0, updated = 0;
  for (const m of list) {
    const ex = q.get('SELECT id FROM members WHERE area_id = ? AND lower(first_name) = lower(?) AND lower(last_name) = lower(?) AND (birth_year IS ? OR birth_year IS NULL OR ? IS NULL)', areaId, m.first_name, m.last_name, m.birth_year, m.birth_year);
    if (ex) { q.run('UPDATE members SET birth_year = COALESCE(?, birth_year), team = CASE WHEN ? != \'\' THEN ? ELSE team END, ttr = COALESCE(?, ttr), gender = CASE WHEN ? != \'\' THEN ? ELSE gender END, active = 1, updated_at = ? WHERE id = ?', m.birth_year, m.team, m.team, m.ttr, m.gender, m.gender, now, ex.id); updated++; }
    else { q.run('INSERT INTO members (area_id, first_name, last_name, birth_year, gender, team, ttr, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', areaId, m.first_name, m.last_name, m.birth_year, m.gender, m.team, m.ttr, source, now, now); added++; }
  }
  // Ins Protokoll nur Zahlen, keine Namen
  audit(user, { entity: 'members', action: 'import', areaId, summary: `Mitgliederliste importiert: ${added} neu, ${updated} aktualisiert${body.replace ? ' (Liste ersetzt)' : ''}` });
  return { added, updated };
}));

const cleanMember = (b) => ({
  first_name: str(b.first_name, { required: true, max: 60, name: 'Vorname' }), last_name: str(b.last_name, { max: 80 }),
  birth_year: int(b.birth_year, { min: 1900, max: 2100 }), gender: ['m', 'w', 'd'].includes(b.gender) ? b.gender : '',
  team: str(b.team, { max: 40 }), ttr: int(b.ttr, { min: 0, max: 3000 }),
});

post('/api/members', ({ user, body }) => {
  requireAdmin(user); needGelb();
  const areaId = int(body.area_id, { nullable: false, name: 'Bereich' });
  assertArea(user, areaId);
  const m = cleanMember(body), now = nowIso();
  const r = q.run('INSERT INTO members (area_id, first_name, last_name, birth_year, gender, team, ttr, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', areaId, m.first_name, m.last_name, m.birth_year, m.gender, m.team, m.ttr, 'von Hand', now, now);
  audit(user, { entity: 'members', action: 'angelegt', areaId, summary: 'Mitglied in der Liste ergänzt' });
  return { id: Number(r.lastInsertRowid) };
});

put('/api/members/:id', ({ user, params, body }) => {
  requireAdmin(user); needGelb();
  const ex = q.get('SELECT * FROM members WHERE id = ?', int(params.id));
  if (!ex || !canSeeArea(user, ex.area_id)) throw notFound();
  const m = cleanMember({ ...ex, ...body });
  q.run('UPDATE members SET first_name = ?, last_name = ?, birth_year = ?, gender = ?, team = ?, ttr = ?, updated_at = ? WHERE id = ?', m.first_name, m.last_name, m.birth_year, m.gender, m.team, m.ttr, nowIso(), ex.id);
  audit(user, { entity: 'members', action: 'geändert', areaId: ex.area_id, summary: 'Mitglied in der Liste geändert' });
  return { ok: true };
});

del('/api/members/:id', ({ user, params }) => {
  requireAdmin(user);
  const ex = q.get('SELECT * FROM members WHERE id = ?', int(params.id));
  if (!ex || !canSeeArea(user, ex.area_id)) throw notFound();
  q.run('DELETE FROM members WHERE id = ?', ex.id);
  audit(user, { entity: 'members', action: 'geloescht', areaId: ex.area_id, summary: 'Mitglied aus der Liste entfernt' });
  return { ok: true };
});

del('/api/members', ({ user, query }) => {
  requireAdmin(user);
  const areaId = int(query.area, { nullable: false, name: 'Bereich' });
  assertArea(user, areaId);
  const n = q.run('DELETE FROM members WHERE area_id = ?', areaId).changes;
  audit(user, { entity: 'members', action: 'geloescht', areaId, summary: `Mitgliederliste des Bereichs gelöscht (${n} Einträge)` });
  return { deleted: n };
});

// ---------- Auslosung ----------

get('/api/draws/modes', () => Object.entries(MODES).map(([key, m]) => ({ key, label: m.label })));

post('/api/draws', ({ user, body }) => {
  const participants = Array.isArray(body.participants) ? body.participants : [];
  const d = auslosen(body.mode, participants, { groups: int(body.groups, { min: 2, max: 32 }) || 2, seeded: !!body.seeded, balance: !!body.balance }, body.seed ? str(body.seed, { max: 40 }) : undefined);
  const title = str(body.title, { max: 120 }) || MODES[d.mode].label;
  let id = null;
  if (body.save) {
    needGelb();
    // Gespeicherte Auslosungen enthalten Namen (gelbe Daten): nur mit Bereich, sonst sähen sie alle Bereiche
    const areaId = int(body.area_id, { nullable: false, name: 'Bereich (zum Speichern einen Bereich wählen)' });
    assertArea(user, areaId);
    id = Number(q.run('INSERT INTO draws (area_id, title, mode, seed, input, result, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      areaId, title, d.mode, d.seed, JSON.stringify(participants.map(p => ({ name: p.name, ttr: p.ttr || null }))), JSON.stringify(d.result), user.id, nowIso()).lastInsertRowid);
  }
  audit(user, { entity: 'draw', entityId: id, action: 'auslosung', summary: `Auslosung „${title}“: ${MODES[d.mode].label}, ${d.count} Teilnehmende, Zufallswert ${d.seed}${id ? ', gespeichert' : ''}` });
  return { ...d, id, title, text: asText(d) };
});

get('/api/draws', ({ user }) => q.all('SELECT d.id, d.title, d.mode, d.seed, d.created_at, d.area_id, u.name AS created_by_name, json_array_length(d.input) AS count FROM draws d LEFT JOIN users u ON u.id = d.created_by ORDER BY d.id DESC LIMIT 100')
  .filter(d => !d.area_id || canSeeArea(user, d.area_id)));

get('/api/draws/:id', ({ user, params }) => {
  const d = q.get('SELECT * FROM draws WHERE id = ?', int(params.id));
  if (!d || (d.area_id && !canSeeArea(user, d.area_id))) throw notFound();
  const out = { ...d, input: JSON.parse(d.input), result: JSON.parse(d.result) };
  return { ...out, text: asText(out) };
});

del('/api/draws/:id', ({ user, params }) => {
  const d = q.get('SELECT * FROM draws WHERE id = ?', int(params.id));
  if (!d || (d.area_id && !canSeeArea(user, d.area_id))) throw notFound();
  if (user.role !== 'admin' && d.created_by !== user.id) throw bad('Nur wer gelost hat oder ein Admin kann löschen.');
  q.run('DELETE FROM draws WHERE id = ?', d.id);
  audit(user, { entity: 'draw', entityId: d.id, action: 'geloescht', summary: `Auslosung „${d.title}“ gelöscht` });
  return { ok: true };
});
