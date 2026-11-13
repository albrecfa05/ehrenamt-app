// Gemeinsam genutzte Stammdaten im Browser (Bereiche, Personen, Ämter, Vorlagen).

import { api } from './api.js';
import { setClockOffset } from './ui.js';

export const state = {
  me: null,          // { user, areas, unread, unseenChangelog, counts }
  users: [],
  offices: [],
  processTemplates: [],
  auto: {},          // aktive Einträge des Automatisierungskatalogs: { key: true|false }
  listeners: new Set(),
};

export const isAdmin = () => state.me?.user?.role === 'admin';
export const areaById = (id) => state.me?.areas.find(a => a.id === Number(id));
export const userById = (id) => state.users.find(u => u.id === Number(id));
export const officesOf = (areaId) => state.offices.filter(o => o.area_id === Number(areaId));

export async function loadState() {
  const [me, users, offices, tpls, catalog] = await Promise.all([
    api.get('/api/me'), api.get('/api/users'), api.get('/api/offices'), api.get('/api/process-templates'), api.get('/api/catalog'),
  ]);
  setClockOffset(me.clock_offset);
  Object.assign(state, { me, users, offices, processTemplates: tpls, auto: autoMap(catalog) });
  emit();
}

const autoMap = (catalog) => Object.fromEntries(catalog.map(c => [c.key, c.active]));
export const autoOn = (key) => !!state.auto[key];
export async function refreshCatalog() { state.auto = autoMap(await api.get('/api/catalog')); emit(); }

export async function refreshMe() {
  state.me = await api.get('/api/me');
  setClockOffset(state.me.clock_offset);
  emit();
}

export async function refreshLookups() {
  const [users, offices, tpls] = await Promise.all([api.get('/api/users'), api.get('/api/offices'), api.get('/api/process-templates')]);
  Object.assign(state, { users, offices, processTemplates: tpls });
  emit();
}

export function onState(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }
function emit() { for (const fn of state.listeners) fn(state); }

// Auswahllisten
export const areaOptions = (withEmpty = 'Alle Bereiche') => [...(withEmpty ? [['', withEmpty]] : []), ...state.me.areas.map(a => [a.id, a.name])];
export const userOptions = (withEmpty = '— niemand —') => [...(withEmpty ? [['', withEmpty]] : []), ...state.users.filter(u => u.active !== 0).map(u => [u.id, u.name])];
export const officeOptions = (areaId, withEmpty = '— kein Amt —') => [...(withEmpty ? [['', withEmpty]] : []), ...officesOf(areaId).map(o => [o.id, o.name])];
export const templateOptions = (areaId, withEmpty = '— ohne Vorlage —') => {
  const area = areaById(areaId);
  return [...(withEmpty ? [['', withEmpty]] : []), ...state.processTemplates
    .filter(t => !area || t.scope === 'beide' || t.scope === area.type)
    .map(t => [t.id, `${t.key ? t.key + ' · ' : ''}${t.name}`])];
};
