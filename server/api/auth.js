// Anmeldung, Ersteinrichtung und eigenes Konto.

import { get, post, put } from '../http.js';
import { q, tx } from '../db.js';
import {
  checkPasswordStrength, checkRateLimit, clearCookie, clearFailures, clientIp, createSession, destroySession,
  hashPassword, noteFailure, randomToken, revokeAllSessions, sessionCookie, verifyPassword,
} from '../auth.js';
import { audit, bad, HttpError, nowIso, str } from '../util.js';
import { areaIds } from '../access.js';

const publicUser = (u) => u && ({
  id: u.id, name: u.name, login: u.login, role: u.role, must_change_pw: !!u.must_change_pw,
  seen_changelog_id: u.seen_changelog_id,
});

get('/api/auth/status', ({ user }) => ({
  setupNeeded: !q.get('SELECT 1 FROM users LIMIT 1'),
  user: publicUser(user),
}), { auth: 'public' });

// Ersteinrichtung: nur solange es noch kein Konto gibt. Das erste Konto ist Admin.
post('/api/auth/setup', ({ body, req, res }) => {
  return tx(() => {
    if (q.get('SELECT 1 FROM users LIMIT 1')) throw new HttpError(409, 'Die Ersteinrichtung ist bereits abgeschlossen.');
    const name = str(body.name, { required: true, max: 120, name: 'Name' });
    const login = str(body.login, { required: true, max: 60, name: 'Anmeldename' }).toLowerCase();
    if (!/^[a-z0-9._-]{3,60}$/.test(login)) throw bad('Der Anmeldename darf nur Kleinbuchstaben, Ziffern, Punkt, Bindestrich und Unterstrich enthalten (mindestens 3 Zeichen).');
    checkPasswordStrength(body.password, { name, login });
    const r = q.run(`INSERT INTO users (name, login, pw_hash, role, created_at, calendar_token) VALUES (?, ?, ?, 'admin', ?, ?)`,
      name, login, hashPassword(body.password), nowIso(), randomToken());
    const id = Number(r.lastInsertRowid);
    const user = { id, name };
    audit(user, { entity: 'user', entityId: id, action: 'angelegt', summary: `Ersteinrichtung: Admin „${name}“ angelegt` });
    res.setHeader('Set-Cookie', sessionCookie(createSession(id, req)));
    return { ok: true };
  });
}, { auth: 'public' });

post('/api/auth/login', ({ body, req, res }) => {
  const login = str(body.login, { max: 60 }).toLowerCase();
  const key = `${clientIp(req)}|${login}`;
  checkRateLimit(key);
  checkRateLimit(clientIp(req) + '|*');
  const u = q.get('SELECT * FROM users WHERE login = ?', login);
  const ok = u && u.active && verifyPassword(String(body.password || ''), u.pw_hash);
  if (!ok) {
    noteFailure(key); noteFailure(clientIp(req) + '|*');
    if (u) audit(null, { entity: 'user', entityId: u.id, action: 'anmeldung_fehlgeschlagen', summary: `Fehlgeschlagene Anmeldung für „${u.login}“${u.active ? '' : ' (Konto gesperrt)'}` });
    throw new HttpError(401, 'Anmeldename oder Passwort ist falsch.');
  }
  clearFailures(key);
  res.setHeader('Set-Cookie', sessionCookie(createSession(u.id, req)));
  audit(u, { entity: 'user', entityId: u.id, action: 'anmeldung', summary: `${u.name} hat sich angemeldet` });
  return { ok: true, user: publicUser(u) };
}, { auth: 'public' });

post('/api/auth/logout', ({ req, res, user }) => {
  destroySession(req);
  res.setHeader('Set-Cookie', clearCookie());
  if (user) audit(user, { entity: 'user', entityId: user.id, action: 'abmeldung', summary: `${user.name} hat sich abgemeldet` });
  return { ok: true };
}, { auth: 'public' });

// Eigenes Passwort ändern. Alle anderen Sitzungen werden dabei beendet.
post('/api/auth/password', ({ body, user }) => {
  const row = q.get('SELECT pw_hash FROM users WHERE id = ?', user.id);
  if (!verifyPassword(String(body.current || ''), row.pw_hash)) throw bad('Das bisherige Passwort stimmt nicht.');
  if (body.current === body.password) throw bad('Das neue Passwort muss sich vom bisherigen unterscheiden.');
  checkPasswordStrength(body.password, { name: user.name, login: user.login });
  q.run('UPDATE users SET pw_hash = ?, must_change_pw = 0 WHERE id = ?', hashPassword(body.password), user.id);
  const n = revokeAllSessions(user.id, user.session_id);
  audit(user, { entity: 'user', entityId: user.id, action: 'passwort', summary: `${user.name} hat das Passwort geändert${n ? ` (${n} andere Sitzung(en) beendet)` : ''}` });
  return { ok: true };
});

get('/api/me', ({ user }) => {
  const areas = q.all(`SELECT * FROM areas WHERE active = 1 ORDER BY type DESC, name`).filter(a => areaIds(user).includes(a.id));
  const unread = q.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', user.id).n;
  const unseen = q.all('SELECT * FROM changelog WHERE id > ? ORDER BY id DESC LIMIT 30', user.seen_changelog_id);
  const approvals = user.role === 'admin' ? q.get(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'offen'`).n : 0;
  const inbox = q.get(`SELECT COUNT(*) AS n FROM inbox WHERE status = 'neu'`).n;
  return { user: publicUser(user), areas, unread, unseenChangelog: unseen, counts: { approvals, inbox } };
});

// Eigene Sitzungen ansehen und andere beenden (z. B. nach Geräteverlust)
get('/api/me/sessions', ({ user }) =>
  q.all('SELECT id, created_at, last_seen, user_agent, ip FROM sessions WHERE user_id = ? ORDER BY last_seen DESC', user.id)
    .map(s => ({ ...s, current: s.id === user.session_id })));

post('/api/me/sessions/revoke-others', ({ user }) => {
  const n = revokeAllSessions(user.id, user.session_id);
  audit(user, { entity: 'user', entityId: user.id, action: 'sitzungen_beendet', summary: `${user.name} hat ${n} andere Sitzung(en) beendet` });
  return { revoked: n };
});

put('/api/me', ({ body, user }) => {
  const name = str(body.name, { required: true, max: 120, name: 'Name' });
  q.run('UPDATE users SET name = ? WHERE id = ?', name, user.id);
  audit(user, { entity: 'user', entityId: user.id, action: 'geändert', summary: `Name geändert: ${user.name} → ${name}` });
  return { ok: true };
});
