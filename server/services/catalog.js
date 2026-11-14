// Automatisierungskatalog: alles, was die App selbstständig tun KANN, an einer Stelle.
// Admins schalten jeden Eintrag im Adminpanel ein oder aus und stellen Parameter ein.
// Die Stufe zeigt, wie weit der Eintrag geht (Kap. 6). Einträge ab Stufe 3 führen nie selbst aus,
// sondern legen Freigaben an. Gesperrtes (Zahlungen, Bestellungen, Mailversand) gibt es hier nicht.

import { isConfigured as jugendplanerConfigured } from '../connectors/jugendplaner.js';
import { getSetting, setSetting } from '../db.js';
import { keyPresent as claudeKeyPresent } from '../connectors/claude.js';
import { gelbLokal } from '../privacy.js';

/**
 * Felder je Eintrag:
 *  key, group, label, description, level (0–4), default (an/aus), source (Anforderung),
 *  requires: ['m365'] | ['gelb_lokal'] | ['claude'] – Voraussetzungen,
 *  params: [{ name, label, type: number|text|select|boolean, default, options, setting? }]
 *    setting: Parameter wird in dieser allgemeinen Einstellung gespeichert (für ältere Einstellungen)
 */
export const CATALOG = [
  // ----- Nachfassen und Fristen -----
  { key: 'erinnerungen', group: 'Fristen und Nachfassen', label: 'Erinnerung bei Fälligkeit und Überfälligkeit', level: 1, default: true, source: 'AUF-7',
    description: 'Erinnert die verantwortliche Person und die Vertretung täglich an fällige und überfällige Aufgaben (in der App).',
    params: [{ name: 'stunde', label: 'Uhrzeit (Stunde)', type: 'number', default: 7, setting: 'erinnerung_stunde' }] },
  { key: 'nachfassen', group: 'Fristen und Nachfassen', label: 'Nachfassen bei Stillstand', level: 1, default: true, source: 'AUF-7, 1.5',
    description: 'Meldet Aufgaben ohne Bewegung und wartende Zulieferungen („Seit 9 Tagen wartet … auf …“).',
    params: [{ name: 'tage', label: 'Nach … Tagen ohne Bewegung', type: 'number', default: 7, setting: 'liegezeit_warnung_tage' }] },
  { key: 'eskalation', group: 'Fristen und Nachfassen', label: 'Eskalation an Vertretung und Admins', level: 1, default: true, source: '2.4',
    description: 'Ist eine Aufgabe deutlich überfällig, werden zusätzlich Vertretung und Admins benachrichtigt – einmal je Aufgabe.',
    params: [{ name: 'tage', label: 'Nach … Tagen Überfälligkeit', type: 'number', default: 5 }] },
  { key: 'ideen_vorlegen', group: 'Fristen und Nachfassen', label: 'Ideen zur Entscheidung vorlegen', level: 1, default: true, source: 'AUF-8',
    description: 'Ideen ohne Bewegung werden den Admins regelmäßig zur Entscheidung vorgelegt: umsetzen oder verwerfen.',
    params: [{ name: 'tage', label: 'Nach … Tagen ohne Bewegung', type: 'number', default: 60, setting: 'idee_vorlage_tage' }] },
  { key: 'auto_abschluss', group: 'Fristen und Nachfassen', label: 'Abschluss, wenn alle Teilschritte erledigt sind', level: 1, default: true, source: 'AUF-3',
    description: 'Sobald der letzte Teilschritt abgehakt ist: nur Hinweis an die verantwortliche Person oder Aufgabe direkt abschließen.',
    params: [{ name: 'modus', label: 'Verhalten', type: 'select', default: 'hinweis', options: [['hinweis', 'Hinweis „Abschließen?“'], ['abschliessen', 'Automatisch abschließen']] }] },

  // ----- Jahreskalender und Termine -----
  { key: 'jahreskalender', group: 'Jahreskalender und Termine', label: 'Wiederkehrende Aufgaben anlegen', level: 2, default: true, source: 'AUF-4',
    description: 'Legt Aufgaben aus dem Jahreskalender mit dem eingestellten Vorlauf automatisch an (inklusive Teilschritten der Vorgangsvorlage).',
    params: [] },
  { key: 'spielplan_import', group: 'Jahreskalender und Termine', label: 'Spielpläne abonnieren (ICS)', level: 2, default: true, source: '5.1, 5.7',
    description: 'Liest öffentliche Spielplan-Kalender (z. B. Mannschafts-ICS aus click-TT/nuLiga) täglich ein und zeigt die Spiele im Kalender. Nur lesend.',
    params: [{ name: 'stunde', label: 'Täglicher Abruf um (Stunde)', type: 'number', default: 6 }] },
  { key: 'heimspiel_aufgaben', group: 'Jahreskalender und Termine', label: 'Aufgaben für Heimspieltage', level: 2, default: true, source: 'VOR-9',
    description: 'Legt für erkannte Heimspiele eine Aufgabe an (z. B. Hallendienst, Bewirtung, Spielbericht) – je Spielplan-Abo einstellbar.',
    params: [] },
  { key: 'sponsor_laufzeit', group: 'Jahreskalender und Termine', label: 'Sponsorverträge rechtzeitig verlängern', level: 1, default: true, source: 'VOR-6',
    description: 'Legt vor dem Laufzeitende eines Sponsorvertrags eine Aufgabe für die Patin oder den Paten an.',
    params: [{ name: 'tage', label: 'Tage vor Laufzeitende', type: 'number', default: 90 }] },
  { key: 'sponsor_kontakt', group: 'Jahreskalender und Termine', label: 'Kontaktpflege bei Sponsoren', level: 1, default: false, source: 'VOR-6, 1.5',
    description: 'Erinnert die Patin oder den Paten, wenn ein aktiver Sponsor lange keinen Kontakt hatte.',
    params: [{ name: 'tage', label: 'Nach … Tagen ohne Kontakt', type: 'number', default: 180 }] },

  // ----- Postfach -----
  { key: 'postfach_abruf', group: 'Postfach (Microsoft 365)', label: 'Postfächer abrufen', level: 2, default: false, requires: ['m365'], source: 'AUT-4, 5.5',
    description: 'Liest neue Mails aus den verbundenen Funktionspostfächern in den Eingang – mit Anhängen. Die App liest nur; im Postfach wird nichts verändert.',
    params: [{ name: 'minuten', label: 'Alle … Minuten', type: 'number', default: 15 }] },
  { key: 'antworten_zuordnen', group: 'Postfach (Microsoft 365)', label: 'Antworten der richtigen Aufgabe zuordnen', level: 2, default: true, source: '1.1, AUF-6',
    description: 'Erkennt Antworten auf Entwürfe der App (Vorgangsnummer im Betreff oder gleicher Mailverlauf), hängt sie als Kommentar an die Aufgabe und beendet „Wartet auf Zulieferung“.',
    params: [{ name: 'nummer_im_betreff', label: 'Vorgangsnummer [#123] in Betreff von Postfach-Entwürfen', type: 'boolean', default: true }] },
  { key: 'eingang_auto', group: 'Postfach (Microsoft 365)', label: 'Eindeutige Eingänge direkt als Aufgabe anlegen', level: 2, default: false, source: 'AUT-4',
    description: 'Erkennt die App Bereich und Vorgangstyp sicher und ist die Nachricht unauffällig, wird sofort eine Aufgabe angelegt. Auffällige Nachrichten bleiben immer im Eingang.',
    params: [] },
  { key: 'ablageregeln', group: 'Postfach (Microsoft 365)', label: 'Eingangs- und Ablageregeln anwenden', level: 2, default: true, source: '1.1, ABL-1, ABL-2',
    description: 'Neue Mails (aus dem Postfach oder als .eml) werden nach den Regeln unter Eingang → Regeln einsortiert: Anhänge in den richtigen Bereich und Ordner, wahlweise direkt als Aufgabe. Auffällige Mails bleiben immer im Eingang.',
    params: [] },
  { key: 'anhaenge_ablegen', group: 'Postfach (Microsoft 365)', label: 'Anhänge automatisch ablegen', level: 2, default: true, source: '1.1, ABL-1',
    description: 'Beim Übernehmen eines Eingangs landen Mailanhänge mit einheitlichem Namen in der Ablage und an der Aufgabe (als gelb).',
    params: [] },
  { key: 'postfach_entwuerfe', group: 'Postfach (Microsoft 365)', label: 'Entwürfe im Postfach ablegen', level: 3, default: false, requires: ['m365'], source: 'Stufe 3, AUT-14',
    description: 'Ein Entwurf kann nach Freigabe als Entwurf ins Funktionspostfach gelegt werden. Verschicken tut immer ein Mensch in Outlook.',
    params: [] },

  // ----- Kalender und Ablage in Microsoft 365 -----
  { key: 'mail_senden', group: 'Postfach (Microsoft 365)', label: 'Mails nach Prüfung direkt aus der App senden', level: 3, default: false, requires: ['m365'], source: 'Stufe 3, AUT-7, AUT-14 (Erweiterung)',
    description: 'Ein Mensch prüft den Entwurf, trägt die Empfängeradressen ein und klickt „Senden“ – ohne in Outlook zu wechseln. Regeln und Automatiken können nie senden. Die Adressen werden nicht gespeichert, nur ihre Anzahl. Braucht in der App-Registrierung zusätzlich das Recht Mail.Send (docs/MICROSOFT-365.md).',
    params: [] },
  { key: 'm365_kalender', group: 'Kalender und Ablage (Microsoft 365)', label: 'Termine in den Outlook-Kalender eintragen', level: 3, default: false, requires: ['m365'], source: 'Stufe 3, DAT-5',
    description: 'Freigegebene Termine werden zusätzlich im Kalender des Funktionspostfachs eingetragen. Jede Eintragung braucht eine Freigabe.',
    params: [] },
  { key: 'ablage_spiegeln', group: 'Kalender und Ablage (Microsoft 365)', label: 'Ablage nach SharePoint/OneDrive kopieren', level: 3, default: false, requires: ['m365'], source: 'ABL-1, DAT-6',
    description: 'Neue Dateien werden zur Kopie in die Vereinsablage vorgeschlagen; nach Freigabe landen sie dort im Ordner Bereich/Jahr.',
    params: [{ name: 'nur_gruen', label: 'Nur grüne Dateien vorschlagen', type: 'boolean', default: true }] },

  // ----- Berichte -----
  { key: 'monatsbericht', group: 'Berichte', label: 'Monatsbericht Kennzahlen', level: 4, default: true, source: 'AUF-10, 9.3',
    description: 'Am Monatsersten eine Übersicht: Liegezeit, Durchlaufzeit, erfasste Stunden, erledigte Aufgaben – für Pilot und Vorstand.',
    params: [] },

  // ----- KI -----
  { key: 'ki_assistent', group: 'KI (Claude)', label: 'Automatisierungen mit KI entwerfen', level: 1, default: false, requires: ['claude'], source: 'Kap. 6, 9.x',
    description: 'Admins beschreiben ein Anliegen; Claude schlägt passende Regeln oder Katalog-Einträge vor. Übertragen werden nur grüne Daten (Bausteine, Vorlagen-Namen, Zählwerte). Nichts wird ohne Übernahme durch einen Admin angelegt, neue Regeln brauchen danach die übliche Freigabe.',
    params: [] },

  // ----- Daten -----
  { key: 'jugendplaner_abgleich', group: 'Spielbetrieb (Jugendplaner)', label: 'Jugendplaner abgleichen', level: 2, default: true, requires: ['jugendplaner'], source: 'VOR-14, 5.7',
    description: 'Liest regelmäßig den Stand des Jugendplaners (Spiele, Zusagen, Fahrer/Betreuer) und zeigt Hinweise unter „Spielbetrieb“. Übernommen werden nur Termine und Hinweise ohne Namen. Kritische Hinweise (niemand fährt, Fahrer spielt selbst …) werden zur Aufgabe für die Jugendleitung und schließen sich, sobald sie im Jugendplaner gelöst sind.',
    params: [{ name: 'stunden', label: 'Alle … Stunden abgleichen', type: 'number', default: 3 }, { name: 'aufgaben', label: 'Aufgaben für kritische Hinweise anlegen', type: 'boolean', default: true }] },

  { key: 'mitglieder_pruefung', group: 'Mitglieder (meinVerein)', label: 'Beitragsstufen aus meinVerein-Export prüfen', level: 2, default: false, requires: ['gelb_lokal'], source: 'VOR-2, 5.2',
    description: 'Ein Admin lädt den Excel-/CSV-Export aus meinVerein hoch; die App ermittelt anstehende Stufenwechsel und legt eine Aufgabe mit Namen an. Der Export wird nicht gespeichert.',
    params: [] },
  { key: 'loeschfrist_gelb', group: 'Mitglieder (meinVerein)', label: 'Löschfrist für gelbe Anhänge', level: 2, default: false, requires: ['gelb_lokal'], source: 'DAT-2, NFA-12',
    description: 'Löscht Anhänge mit gelben Daten eine bestimmte Zeit nach Abschluss des Vorgangs. Das Protokoll bleibt erhalten.',
    params: [{ name: 'tage', label: 'Tage nach Abschluss', type: 'number', default: 365 }] },
];

const byKey = new Map(CATALOG.map(c => [c.key, c]));

function stored() { return getSetting('automatisierungskatalog', {}) || {}; }

/** Ist der Eintrag eingeschaltet (und sind die Voraussetzungen erfüllt)? */
export function isOn(key) {
  const c = byKey.get(key);
  if (!c) return false;
  const s = stored()[key];
  const on = s?.enabled ?? c.default;
  if (!on) return false;
  return requirementsMet(c).ok;
}

export function param(key, name) {
  const c = byKey.get(key);
  const p = c?.params.find(x => x.name === name);
  if (!p) return undefined;
  if (p.setting) return getSetting(p.setting, p.default);
  const v = stored()[key]?.params?.[name];
  return v === undefined || v === null || v === '' ? p.default : v;
}

let m365Check = () => false;
export function setM365Check(fn) { m365Check = fn; }

export function requirementsMet(c) {
  const missing = [];
  for (const r of c.requires || []) {
    if (r === 'm365' && !m365Check()) missing.push('Microsoft 365 ist nicht verbunden (Adminpanel → Verbindungen)');
    if ((r === 'gelb_lokal' || r === 'datenschutz') && !gelbLokal()) missing.push('Schalter „Gelbe Daten lokal verarbeiten“ ist aus (Einstellungen)');
    if (r === 'claude' && !claudeKeyPresent()) missing.push('Kein Claude-API-Schlüssel (ANTHROPIC_API_KEY in der .env)');
    if (r === 'jugendplaner' && !jugendplanerConfigured()) missing.push('Jugendplaner ist nicht verbunden (JUGENDPLANER_URL und JUGENDPLANER_SECRET in der .env)');
  }
  return { ok: !missing.length, missing };
}

/** Katalog mit aktuellem Zustand für die Oberfläche. */
export function catalogView() {
  const s = stored();
  return CATALOG.map(c => {
    const req = requirementsMet(c);
    return {
      ...c,
      enabled: s[c.key]?.enabled ?? c.default,
      active: isOn(c.key),
      missing: req.missing,
      params: c.params.map(p => ({ ...p, value: param(c.key, p.name) })),
    };
  });
}

/** Speichert Änderungen; gibt eine lesbare Liste der Änderungen zurück. */
export function updateCatalog(changes) {
  const s = stored();
  const log = [];
  for (const [key, ch] of Object.entries(changes || {})) {
    const c = byKey.get(key);
    if (!c) continue;
    const cur = s[key] || {};
    if (ch.enabled !== undefined) {
      const before = cur.enabled ?? c.default;
      if (before !== !!ch.enabled) log.push(`${c.label}: ${ch.enabled ? 'eingeschaltet' : 'ausgeschaltet'}`);
      cur.enabled = !!ch.enabled;
    }
    for (const [name, raw] of Object.entries(ch.params || {})) {
      const p = c.params.find(x => x.name === name);
      if (!p) continue;
      let v = raw;
      if (p.type === 'number') { v = raw === '' || raw === null ? null : Number(raw); if (v !== null && (!Number.isFinite(v) || v < 0)) throw new Error(`${c.label} – ${p.label}: ungültige Zahl.`); }
      if (p.type === 'boolean') v = !!raw;
      if (p.type === 'select' && !p.options.some(o => o[0] === v)) continue;
      const before = param(key, name);
      if (JSON.stringify(before) === JSON.stringify(v ?? p.default)) continue;
      if (p.setting) setSetting(p.setting, v ?? p.default);
      else { cur.params = { ...(cur.params || {}), [name]: v }; }
      log.push(`${c.label} – ${p.label}: ${before} → ${v ?? p.default}`);
    }
    s[key] = cur;
  }
  setSetting('automatisierungskatalog', s);
  return log;
}
