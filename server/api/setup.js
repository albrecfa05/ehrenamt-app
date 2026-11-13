// Einrichtungsassistent: führt von der leeren App bis zum Betrieb.
// Jeder Schritt zeigt seinen tatsächlichen Stand (aus den Daten ermittelt) und kann als erledigt markiert werden.

import { del, get, post } from '../http.js';
import { q, tx, getSetting, setSetting } from '../db.js';
import { requireAdmin } from '../access.js';
import { CATALOG, updateCatalog } from '../services/catalog.js';
import * as m365 from '../connectors/m365.js';
import { keyPresent as claudeKey } from '../connectors/claude.js';
import { gelbExtern, gelbLokal } from '../privacy.js';
import { audit, bad, int, notFound, nowIso, oneOf } from '../util.js';

const STEPS = [
  { key: 'verein', title: 'Verein und Bezirk', hint: 'Bereiche benennen: je Verein einer, dazu der Bezirk.' },
  { key: 'personen', title: 'Personen und Ämter', hint: 'Zweites Admin-Konto, Ämter mit Inhaber und Vertretung besetzen.' },
  { key: 'satzung', title: 'Fristen und Beiträge', hint: 'Fristen aus der Satzung, Beitragsstufen, Reserve.' },
  { key: 'datenschutz', title: 'Datenschutz', hint: 'Was die App mit gelben Daten darf.' },
  { key: 'verbindungen', title: 'Verbindungen', hint: 'Microsoft 365, Spielpläne, Claude – alles optional.' },
  { key: 'automatisierung', title: 'Automatisierungen', hint: 'Wie viel die App selbstständig erledigen soll.' },
  { key: 'kalender', title: 'Jahreskalender', hint: 'Geschätzte Termine prüfen und bestätigen.' },
  { key: 'wissen', title: 'Satzung und Ordnungen', hint: 'Grundlage für die Auskunft mit Fundstelle.' },
  { key: 'start', title: 'Los geht’s', hint: 'Erste Aufgaben, Asana-Import, Ablageregeln.' },
];

/** Voreinstellungen für den Automatisierungskatalog */
export const PRESETS = {
  vorsichtig: {
    label: 'Vorsichtig', description: 'Nur Erinnerungen und Jahreskalender. Alles andere bleibt aus, bis ihr es braucht.',
    on: ['erinnerungen', 'nachfassen', 'jahreskalender', 'ideen_vorlegen', 'auto_abschluss'],
  },
  empfohlen: {
    label: 'Empfohlen', description: 'Erinnern, nachfassen, eskalieren, Spielpläne, Sponsoren, Ablageregeln und Monatsbericht. Nichts verlässt den Server ohne Freigabe.',
    on: ['erinnerungen', 'nachfassen', 'eskalation', 'ideen_vorlegen', 'auto_abschluss', 'jahreskalender', 'spielplan_import', 'heimspiel_aufgaben',
      'sponsor_laufzeit', 'antworten_zuordnen', 'anhaenge_ablegen', 'ablageregeln', 'monatsbericht'],
  },
  umfassend: {
    label: 'Umfassend', description: 'Alles, was der Katalog kann – inklusive Postfach-Abruf, Entwürfe ins Postfach, Outlook-Termine und SharePoint-Kopien (jeweils mit Freigabe) und KI-Assistent, soweit verbunden.',
    on: CATALOG.map(c => c.key),
  },
};

function state() {
  const s = getSetting('einrichtung', {}) || {};
  return { done: !!s.done, steps: s.steps || {} };
}

function status() {
  const st = state();
  const areas = q.all('SELECT * FROM areas WHERE active = 1');
  const admins = q.get(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1`).n;
  const users = q.get('SELECT COUNT(*) AS n FROM users WHERE active = 1').n;
  const offices = q.get('SELECT COUNT(*) AS n, SUM(holder_id IS NOT NULL) AS besetzt, SUM(deputy_id IS NOT NULL) AS vertretung FROM offices o JOIN areas a ON a.id = o.area_id WHERE a.active = 1');
  const rec = q.get('SELECT COUNT(*) AS n, SUM(assumption = 0) AS bestaetigt FROM recurring WHERE active = 1');
  const kb = q.get(`SELECT COUNT(*) AS n FROM kb_documents WHERE active = 1 AND source_type IN ('satzung','ordnung','beschluss')`).n;
  const feeds = q.get('SELECT COUNT(*) AS n FROM feeds WHERE active = 1').n;
  const m = m365.status();
  const facts = {
    verein: { text: `${areas.length} Bereich(e): ${areas.map(a => a.name).join(', ')}`, ok: areas.length > 0 },
    personen: { text: `${users} Konto/Konten (${admins} Admin), ${offices.besetzt || 0} von ${offices.n} Ämtern besetzt, ${offices.vertretung || 0} mit Vertretung`, ok: admins >= 2 && (offices.besetzt || 0) > 0 },
    satzung: { text: `Einladungsfrist ${getSetting('einladung_frist_tage', 14)} Tage, Kündigung ${getSetting('kuendigung_frist_monate', 3)} Monate, ${getSetting('beitragsstufen', []).length || 2} Beitragsstufen`, ok: !!st.steps.satzung },
    datenschutz: { text: `Gelb lokal: ${gelbLokal() ? 'an' : 'aus'} · Gelb nach außen: ${gelbExtern() ? 'an' : 'aus'}`, ok: !!st.steps.datenschutz },
    verbindungen: { text: `Microsoft 365: ${m.configured ? 'verbunden' : m.credentials ? 'Zugangsdaten da, Postfach fehlt' : 'nicht eingerichtet'} · Spielpläne: ${feeds} · Claude: ${claudeKey() ? 'Schlüssel da' : 'kein Schlüssel'}`, ok: !!st.steps.verbindungen },
    automatisierung: { text: getSetting('einrichtung_preset', null) ? `Voreinstellung „${PRESETS[getSetting('einrichtung_preset')]?.label}“` : 'noch keine Voreinstellung gewählt', ok: !!getSetting('einrichtung_preset', null) },
    kalender: { text: `${rec.bestaetigt || 0} von ${rec.n} Terminen bestätigt`, ok: rec.n > 0 && rec.bestaetigt === rec.n },
    wissen: { text: kb ? `${kb} Dokument(e) aus Satzung, Ordnungen oder Beschlüssen` : 'noch keine Satzung aufgenommen', ok: kb > 0 },
    start: { text: st.done ? 'Einrichtung abgeschlossen' : 'offen', ok: st.done },
  };
  return {
    done: st.done,
    steps: STEPS.map(s => ({ ...s, ...facts[s.key], marked: !!st.steps[s.key] })),
    presets: Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, { label: p.label, description: p.description }])),
    preset: getSetting('einrichtung_preset', null),
  };
}

get('/api/setup', ({ user }) => { requireAdmin(user); return status(); });

post('/api/setup/step', ({ user, body }) => {
  requireAdmin(user);
  const key = oneOf(body.key, STEPS.map(s => s.key), { name: 'Schritt' });
  const st = state();
  st.steps[key] = body.done !== false;
  if (key === 'start' && body.done !== false) st.done = true;
  setSetting('einrichtung', st);
  audit(user, { entity: 'einrichtung', action: 'schritt', summary: `Einrichtung: „${STEPS.find(s => s.key === key).title}“ ${body.done === false ? 'wieder geöffnet' : 'erledigt'}` });
  return status();
});

post('/api/setup/preset', ({ user, body }) => tx(() => {
  requireAdmin(user);
  const key = oneOf(body.preset, Object.keys(PRESETS), { name: 'Voreinstellung' });
  const on = new Set(PRESETS[key].on);
  const changes = Object.fromEntries(CATALOG.map(c => [c.key, { enabled: on.has(c.key) }]));
  const log = updateCatalog(changes);
  setSetting('einrichtung_preset', key);
  // Beispielregeln (Wochenübersicht, Fristerinnerung) bei „empfohlen“ und „umfassend“ gleich freigeben
  let approved = 0;
  if (key !== 'vorsichtig' && body.approve_examples) {
    for (const r of q.all('SELECT * FROM rules WHERE approved = 0 AND created_by IS NULL')) {
      q.run('UPDATE rules SET approved = 1, approved_by = ?, approved_at = ?, active = 1 WHERE id = ?', user.id, nowIso(), r.id);
      audit(user, { entity: 'rule', entityId: r.id, action: 'freigegeben', summary: `Beispielregel „${r.name}“ im Einrichtungsassistenten freigegeben von ${user.name}` });
      approved++;
    }
  }
  audit(user, { entity: 'einrichtung', action: 'voreinstellung', summary: `Einrichtung: Voreinstellung „${PRESETS[key].label}“ gewählt (${log.length} Änderung(en)${approved ? `, ${approved} Beispielregel(n) freigegeben` : ''})` });
  return { ...status(), changes: log, approved };
}));

// Alle geschätzten Kalendertermine auf einmal bestätigen (nach Durchsicht)
post('/api/setup/confirm-calendar', ({ user, body }) => {
  requireAdmin(user);
  const ids = (body.ids || []).map(Number).filter(Boolean);
  let n = 0;
  for (const id of ids) n += q.run('UPDATE recurring SET assumption = 0 WHERE id = ? AND assumption = 1', id).changes;
  audit(user, { entity: 'recurring', action: 'bestaetigt', summary: `Einrichtung: ${n} Termin(e) im Jahreskalender bestätigt` });
  return status();
});

// Leeren Bereich entfernen (z. B. Beispielbereich, den es im eigenen Verein nicht gibt)
del('/api/areas/:id', ({ user, params }) => tx(() => {
  requireAdmin(user);
  const a = q.get('SELECT * FROM areas WHERE id = ?', int(params.id));
  if (!a) throw notFound();
  const used = ['tasks', 'files', 'events', 'sponsors', 'feeds', 'kb_documents', 'inbox', 'drafts'].reduce((s, t) => s + q.get(`SELECT COUNT(*) AS n FROM ${t} WHERE area_id = ?`, a.id).n, 0);
  if (used) throw bad(`Im Bereich „${a.name}“ gibt es schon ${used} Einträge. Statt zu löschen bitte deaktivieren.`);
  q.run('DELETE FROM recurring WHERE area_id = ?', a.id);
  q.run('DELETE FROM offices WHERE area_id = ?', a.id);
  q.run('DELETE FROM user_areas WHERE area_id = ?', a.id);
  q.run('UPDATE rules SET area_id = NULL WHERE area_id = ?', a.id);
  q.run('UPDATE filing_rules SET area_id = NULL WHERE area_id = ?', a.id);
  q.run('UPDATE filing_rules SET target_area_id = NULL WHERE target_area_id = ?', a.id);
  q.run('DELETE FROM areas WHERE id = ?', a.id);
  audit(user, { entity: 'area', entityId: a.id, action: 'geloescht', summary: `Leerer Bereich „${a.name}“ entfernt` });
}));
