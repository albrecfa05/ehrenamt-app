// Bereichstrennung (ROL-1, NFA-8, DAT-8) und Rollenprüfung (ROL-2, ROL-3).
// Admins sehen alle Bereiche. Zuarbeitende sehen nur die Bereiche, die ihnen zugeordnet sind.

import { q } from './db.js';
import { forbidden, notFound } from './util.js';

export const isAdmin = (user) => user?.role === 'admin';

export function requireAdmin(user) {
  if (!isAdmin(user)) throw forbidden('Nur Admins dürfen das.');
}

/** IDs der Bereiche, auf die die Person zugreifen darf. */
export function areaIds(user) {
  if (isAdmin(user)) return q.all('SELECT id FROM areas WHERE active = 1').map(r => r.id);
  return q.all('SELECT a.id FROM user_areas ua JOIN areas a ON a.id = ua.area_id WHERE ua.user_id = ? AND a.active = 1', user.id).map(r => r.id);
}

export function canSeeArea(user, areaId) {
  if (areaId === null || areaId === undefined) return true; // bereichsübergreifend teilbar (Vorlagen, Regelwissen)
  return areaIds(user).includes(Number(areaId));
}

export function assertArea(user, areaId) {
  if (!q.get('SELECT 1 FROM areas WHERE id = ?', areaId)) throw notFound('Bereich nicht gefunden.');
  if (!canSeeArea(user, areaId)) throw forbidden('Kein Zugriff auf diesen Bereich.');
}

/** SQL-Bedingung für Abfragen über mehrere Bereiche: "<spalte> IN (…)". */
export function areaClause(user, column = 'area_id') {
  const ids = areaIds(user);
  if (!ids.length) return { sql: '1 = 0', params: [] };
  return { sql: `${column} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

/** Lädt eine Aufgabe und prüft den Bereich. */
export function loadTask(user, id) {
  const t = q.get('SELECT * FROM tasks WHERE id = ?', id);
  if (!t) throw notFound('Aufgabe nicht gefunden.');
  if (!canSeeArea(user, t.area_id)) throw forbidden('Kein Zugriff auf diese Aufgabe.');
  return t;
}

/** Zuarbeitende dürfen nur eigene Aufgaben bzw. Vertretungen bearbeiten (Kap. 2). */
export function assertCanEditTask(user, task) {
  if (isAdmin(user)) return;
  if (task.owner_id === user.id || task.deputy_id === user.id || task.created_by === user.id) return;
  throw forbidden('Nur eigene Aufgaben oder Vertretungen lassen sich bearbeiten. Material kannst du als Kommentar oder Datei zuliefern.');
}
