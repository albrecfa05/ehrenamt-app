// Schnittstellen für den Anschluss an den Jugendplaner (Spielbetrieb der Jugend).

import { get, post, put } from '../http.js';
import { q, setSetting } from '../db.js';
import { requireAdmin, canSeeArea, assertArea } from '../access.js';
import { audit, bad, int } from '../util.js';
import * as jp from '../connectors/jugendplaner.js';
import { createFeed, settings, stand, sync, STATUS_LABEL } from '../services/jugendplaner.js';

get('/api/jugendplaner', ({ user }) => {
  const cfg = settings();
  const st = stand();
  const area = cfg.area_id ? q.get('SELECT id, name FROM areas WHERE id = ?', cfg.area_id) : null;
  if (area && !canSeeArea(user, area.id) && user.role !== 'admin') return { connection: { configured: jp.isConfigured() }, settings: {}, stand: null };
  const feed = st?.icsKey ? q.get('SELECT id FROM feeds WHERE url = ?', jp.icsUrl(st.icsKey)) : null;
  // Die Kalender-Adresse enthält einen Schlüssel – nur zur Prüfung, nicht an die Oberfläche
  const { icsKey, ...rest } = st || {};
  return { connection: jp.status(), settings: { area_id: cfg.area_id, area_name: area?.name || null }, stand: st ? rest : null, feed: !!feed, labels: STATUS_LABEL };
});

put('/api/jugendplaner', ({ user, body }) => {
  requireAdmin(user);
  const areaId = int(body.area_id);
  if (areaId) assertArea(user, areaId);
  setSetting('jugendplaner', { ...settings(), area_id: areaId || null });
  audit(user, { entity: 'jugendplaner', action: 'einstellung', summary: `Jugendplaner: Bereich ${areaId ? `„${q.get('SELECT name FROM areas WHERE id = ?', areaId)?.name}“` : 'entfernt'}` });
  return { ok: true };
});

post('/api/jugendplaner/sync', async ({ user }) => {
  requireAdmin(user);
  if (!jp.isConfigured()) throw bad('Der Jugendplaner ist nicht verbunden: JUGENDPLANER_URL und JUGENDPLANER_SECRET (oder JUGENDPLANER_PIN) in die .env eintragen und den Server neu starten.');
  try { return await sync({ user }); } catch (err) { throw bad(err.message); }
});

post('/api/jugendplaner/feed', ({ user }) => {
  requireAdmin(user);
  const areaId = settings().area_id;
  if (!areaId) throw bad('Bitte zuerst den Bereich wählen, zu dem der Jugendplaner gehört.');
  return createFeed(user, areaId);
});

// „Zum Jugendplaner“: Adresse mit Anmeldung (nur mit Schlüssel; der Jugendplaner braucht dafür die kleine SSO-Ergänzung)
get('/api/jugendplaner/open', ({ user }) => {
  const c = jp.status();
  if (!c.url) throw bad('Der Jugendplaner ist nicht eingetragen.');
  if (!c.sso) return { url: `${c.url}/`, sso: false };
  const office = q.get(`SELECT 1 FROM offices o WHERE (o.holder_id = ? OR o.deputy_id = ?) AND o.name IN ('Jugendwart', 'Bezirksjugendwart', 'Vorsitz')`, user.id, user.id);
  const role = user.role === 'admin' || office ? 'admin' : 'mf';
  audit(user, { entity: 'jugendplaner', action: 'anmeldung', summary: `${user.name} öffnet den Jugendplaner (Rolle ${role === 'admin' ? 'Jugendleitung' : 'Mannschaftsführer'})` });
  return { url: `${c.url}/#sso=${jp.mintToken(role)}`, sso: true, role };
});
