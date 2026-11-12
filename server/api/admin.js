// Adminpanel (ROL-5, NFA-5): Nutzer, Bereiche, Ämter, Einstellungen.

import { del, get, post, put } from '../http.js';
import { q, tx, getSetting, setSetting } from '../db.js';
import { checkPasswordStrength, hashPassword, randomToken, revokeAllSessions } from '../auth.js';
import { audit, bad, int, notFound, nowIso, oneOf, str } from '../util.js';
import { DEFAULT_STUFEN } from '../calc.js';

// ---------- Nutzer ----------

get('/api/users', ({ user }) => {
  // Alle sehen die Namen (für Zuweisungen); Details nur für Admins
  const rows = q.all('SELECT id, name, login, role, active, created_at, deactivated_at FROM users ORDER BY active DESC, name');
  if (user.role !== 'admin') return rows.filter(r => r.active).map(({ id, name, role }) => ({ id, name, role }));
  return rows.map(r => ({
    ...r,
    areas: q.all('SELECT area_id FROM user_areas WHERE user_id = ?', r.id).map(a => a.area_id),
    sessions: q.get('SELECT COUNT(*) AS n, MAX(last_seen) AS last FROM sessions WHERE user_id = ?', r.id),
  }));
});

function tempPassword() {
  // Lesbares Einmal-Passwort, erfüllt die Passwortregeln
  return `Tt-${randomToken(9)}-${Math.floor(10 + Math.random() * 89)}`;
}

post('/api/users', ({ body, user }) => tx(() => {
  const name = str(body.name, { required: true, max: 120, name: 'Name' });
  const login = str(body.login, { required: true, max: 60, name: 'Anmeldename' }).toLowerCase();
  if (!/^[a-z0-9._-]{3,60}$/.test(login)) throw bad('Der Anmeldename darf nur Kleinbuchstaben, Ziffern, Punkt, Bindestrich und Unterstrich enthalten.');
  const role = oneOf(body.role, ['admin', 'zuarbeit'], { name: 'Rolle' });
  let password = body.password;
  let temporary = false;
  if (!password) { password = tempPassword(); temporary = true; }
  else checkPasswordStrength(password, { name, login });
  const r = q.run(`INSERT INTO users (name, login, pw_hash, role, must_change_pw, created_at, calendar_token) VALUES (?, ?, ?, ?, 1, ?, ?)`,
    name, login, hashPassword(password), role, nowIso(), randomToken());
  const id = Number(r.lastInsertRowid);
  for (const a of body.areas || []) q.run('INSERT OR IGNORE INTO user_areas (user_id, area_id) VALUES (?, ?)', id, int(a));
  audit(user, { entity: 'user', entityId: id, action: 'angelegt', summary: `Konto „${name}“ (${role === 'admin' ? 'Admin' : 'Zuarbeit'}) angelegt` });
  return { id, temporaryPassword: temporary ? password : null };
}), { auth: 'admin' });

put('/api/users/:id', ({ params, body, user }) => tx(() => {
  const id = int(params.id);
  const u = q.get('SELECT * FROM users WHERE id = ?', id);
  if (!u) throw notFound('Konto nicht gefunden.');
  const changes = [];
  if (body.name !== undefined) {
    const name = str(body.name, { required: true, max: 120, name: 'Name' });
    if (name !== u.name) { q.run('UPDATE users SET name = ? WHERE id = ?', name, id); changes.push(`Name → ${name}`); }
  }
  if (body.role !== undefined) {
    const role = oneOf(body.role, ['admin', 'zuarbeit'], { name: 'Rolle' });
    if (role !== u.role) {
      if (u.role === 'admin' && q.get(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1`).n <= 1) throw bad('Es muss mindestens ein aktiver Admin bleiben.');
      q.run('UPDATE users SET role = ? WHERE id = ?', role, id); changes.push(`Rolle → ${role}`);
    }
  }
  if (body.active !== undefined) {
    const active = body.active ? 1 : 0;
    if (active !== u.active) {
      if (!active && id === user.id) throw bad('Das eigene Konto lässt sich nicht sperren.');
      if (!active && u.role === 'admin' && q.get(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1`).n <= 1) throw bad('Es muss mindestens ein aktiver Admin bleiben.');
      q.run('UPDATE users SET active = ?, deactivated_at = ? WHERE id = ?', active, active ? null : nowIso(), id);
      if (!active) {
        const n = revokeAllSessions(id);
        // Zuständigkeiten in Ämtern lösen, Aufgaben bleiben zur Übergabe sichtbar
        q.run('UPDATE offices SET holder_id = NULL WHERE holder_id = ?', id);
        q.run('UPDATE offices SET deputy_id = NULL WHERE deputy_id = ?', id);
        changes.push(`gesperrt, ${n} Sitzung(en) beendet`);
      } else changes.push('entsperrt');
    }
  }
  if (Array.isArray(body.areas)) {
    q.run('DELETE FROM user_areas WHERE user_id = ?', id);
    for (const a of body.areas) q.run('INSERT OR IGNORE INTO user_areas (user_id, area_id) VALUES (?, ?)', id, int(a));
    changes.push(`Bereiche: ${body.areas.map(a => q.get('SELECT name FROM areas WHERE id = ?', a)?.name).filter(Boolean).join(', ') || 'keine'}`);
  }
  if (changes.length) audit(user, { entity: 'user', entityId: id, action: 'geändert', summary: `Konto „${u.name}“: ${changes.join('; ')}` });
  return { ok: true };
}), { auth: 'admin' });

post('/api/users/:id/reset-password', ({ params, user }) => {
  const id = int(params.id);
  const u = q.get('SELECT * FROM users WHERE id = ?', id);
  if (!u) throw notFound('Konto nicht gefunden.');
  const pw = tempPassword();
  q.run('UPDATE users SET pw_hash = ?, must_change_pw = 1 WHERE id = ?', hashPassword(pw), id);
  const n = revokeAllSessions(id);
  audit(user, { entity: 'user', entityId: id, action: 'passwort_zurueckgesetzt', summary: `Passwort von „${u.name}“ zurückgesetzt, ${n} Sitzung(en) beendet` });
  return { temporaryPassword: pw };
}, { auth: 'admin' });

// Sofortiger Entzug aller Sitzungen, z. B. bei Geräteverlust (NFA-5)
post('/api/users/:id/revoke', ({ params, user }) => {
  const id = int(params.id);
  const u = q.get('SELECT * FROM users WHERE id = ?', id);
  if (!u) throw notFound('Konto nicht gefunden.');
  const n = revokeAllSessions(id, id === user.id ? user.session_id : null);
  audit(user, { entity: 'user', entityId: id, action: 'sitzungen_beendet', summary: `Alle Sitzungen von „${u.name}“ beendet (${n})` });
  return { revoked: n };
}, { auth: 'admin' });

// ---------- Bereiche und Ämter ----------

get('/api/areas', () => q.all('SELECT * FROM areas ORDER BY active DESC, type DESC, name'));

post('/api/areas', ({ body, user }) => {
  const name = str(body.name, { required: true, max: 120, name: 'Name' });
  const type = oneOf(body.type, ['verein', 'bezirk'], { name: 'Art' });
  const key = str(body.key || name, { max: 60 }).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const color = /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color : '#2563eb';
  const r = q.run('INSERT INTO areas (key, name, type, color) VALUES (?, ?, ?, ?)', key, name, type, color);
  audit(user, { entity: 'area', entityId: Number(r.lastInsertRowid), action: 'angelegt', summary: `Bereich „${name}“ angelegt` });
  return { id: Number(r.lastInsertRowid) };
}, { auth: 'admin' });

put('/api/areas/:id', ({ params, body, user }) => {
  const a = q.get('SELECT * FROM areas WHERE id = ?', int(params.id));
  if (!a) throw notFound();
  const name = body.name !== undefined ? str(body.name, { required: true, max: 120, name: 'Name' }) : a.name;
  const color = /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color : a.color;
  const active = body.active !== undefined ? (body.active ? 1 : 0) : a.active;
  q.run('UPDATE areas SET name = ?, color = ?, active = ? WHERE id = ?', name, color, active, a.id);
  audit(user, { entity: 'area', entityId: a.id, areaId: a.id, action: 'geändert', summary: `Bereich „${a.name}“ geändert` });
  return { ok: true };
}, { auth: 'admin' });

get('/api/offices', () => q.all(`SELECT o.*, a.name AS area_name, h.name AS holder_name, d.name AS deputy_name
                                 FROM offices o JOIN areas a ON a.id = o.area_id
                                 LEFT JOIN users h ON h.id = o.holder_id LEFT JOIN users d ON d.id = o.deputy_id
                                 ORDER BY a.type DESC, a.name, o.name`));

post('/api/offices', ({ body, user }) => {
  const area = int(body.area_id, { nullable: false, name: 'Bereich' });
  const name = str(body.name, { required: true, max: 120, name: 'Name' });
  const r = q.run('INSERT INTO offices (area_id, name, holder_id, deputy_id) VALUES (?, ?, ?, ?)', area, name, int(body.holder_id), int(body.deputy_id));
  audit(user, { entity: 'office', entityId: Number(r.lastInsertRowid), areaId: area, action: 'angelegt', summary: `Amt „${name}“ angelegt` });
  return { id: Number(r.lastInsertRowid) };
}, { auth: 'admin' });

put('/api/offices/:id', ({ params, body, user }) => {
  const o = q.get('SELECT * FROM offices WHERE id = ?', int(params.id));
  if (!o) throw notFound();
  const name = body.name !== undefined ? str(body.name, { required: true, max: 120, name: 'Name' }) : o.name;
  const holder = body.holder_id !== undefined ? int(body.holder_id) : o.holder_id;
  const deputy = body.deputy_id !== undefined ? int(body.deputy_id) : o.deputy_id;
  q.run('UPDATE offices SET name = ?, holder_id = ?, deputy_id = ? WHERE id = ?', name, holder, deputy, o.id);
  const hn = holder ? q.get('SELECT name FROM users WHERE id = ?', holder)?.name : '—';
  const dn = deputy ? q.get('SELECT name FROM users WHERE id = ?', deputy)?.name : '—';
  audit(user, { entity: 'office', entityId: o.id, areaId: o.area_id, action: 'geändert', summary: `Amt „${name}“: Inhaber ${hn}, Vertretung ${dn}` });
  return { ok: true };
}, { auth: 'admin' });

del('/api/offices/:id', ({ params, user }) => {
  const o = q.get('SELECT * FROM offices WHERE id = ?', int(params.id));
  if (!o) throw notFound();
  const used = q.get('SELECT COUNT(*) AS n FROM tasks WHERE office_id = ?', o.id).n + q.get('SELECT COUNT(*) AS n FROM recurring WHERE office_id = ?', o.id).n;
  if (used) throw bad(`Das Amt wird von ${used} Aufgabe(n) oder Kalendereinträgen verwendet und lässt sich nicht löschen.`);
  q.run('DELETE FROM offices WHERE id = ?', o.id);
  audit(user, { entity: 'office', entityId: o.id, areaId: o.area_id, action: 'geloescht', summary: `Amt „${o.name}“ gelöscht` });
}, { auth: 'admin' });

// ---------- Einstellungen ----------

export const SETTINGS = {
  liegezeit_warnung_tage: { label: 'Nachfassen nach … Tagen ohne Bewegung', type: 'number', default: 7, catalog: true },
  liegezeit_ziel_tage: { label: 'Ziel: mittlere Liegezeit höchstens … Tage', type: 'number', default: 6 },
  erinnerung_stunde: { label: 'Tägliche Erinnerungen ab … Uhr', type: 'number', default: 7, catalog: true },
  idee_vorlage_tage: { label: 'Ideen ohne Bewegung nach … Tagen vorlegen', type: 'number', default: 60, catalog: true },
  einladung_frist_tage: { label: 'Einladungsfrist Mitgliederversammlung (Tage, laut Satzung)', type: 'number', default: 14 },
  antrag_frist_tage: { label: 'Antragsfrist vor der Versammlung (Tage, laut Satzung)', type: 'number', default: 7 },
  kuendigung_frist_monate: { label: 'Kündigungsfrist (Monate, laut Satzung)', type: 'number', default: 3 },
  budget_reserve: { label: 'Selbst gesetzte Reserve (€)', type: 'number', default: 20000 },
  datenschutz_gelb_freigegeben: { label: 'Datenschutzfrage geklärt: Automatisierungen mit gelben Daten erlauben', type: 'boolean', default: false },
  beitragsstufen: { label: 'Beitragsstufen', type: 'json', default: DEFAULT_STUFEN },
};

get('/api/settings', () => Object.fromEntries(Object.entries(SETTINGS).map(([k, s]) => [k, { ...s, value: getSetting(k, s.default) }])));

put('/api/settings', ({ body, user }) => {
  const changed = [];
  for (const [k, v] of Object.entries(body || {})) {
    const s = SETTINGS[k];
    if (!s) continue;
    let val = v;
    if (s.type === 'number') val = v === '' || v === null ? null : Number(v);
    if (s.type === 'number' && val !== null && !Number.isFinite(val)) throw bad(`${s.label}: keine Zahl.`);
    if (s.type === 'boolean') val = !!v;
    if (s.type === 'json') {
      if (k === 'beitragsstufen') {
        if (!Array.isArray(val) || !val.length) throw bad('Bitte mindestens eine Beitragsstufe angeben.');
        val = val.map(x => ({ name: str(x.name, { required: true, max: 80, name: 'Stufe' }), ab_alter: Number(x.ab_alter) || 0, bis_alter: x.bis_alter === '' || x.bis_alter == null ? null : Number(x.bis_alter), beitrag: Number(x.beitrag) || 0 }));
      }
    }
    const before = getSetting(k, s.default);
    if (JSON.stringify(before) !== JSON.stringify(val)) {
      setSetting(k, val);
      changed.push(`${s.label}: ${JSON.stringify(before)} → ${JSON.stringify(val)}`);
    }
  }
  if (changed.length) {
    audit(user, { entity: 'settings', action: 'geändert', summary: `Einstellungen geändert: ${changed.join('; ')}` });
    q.run('INSERT INTO changelog (entity, title, note, created_at, created_by) VALUES (?, ?, ?, ?, ?)',
      'settings', 'Einstellungen geändert', changed.join('\n'), nowIso(), user.id);
  }
  return { ok: true };
}, { auth: 'admin' });
