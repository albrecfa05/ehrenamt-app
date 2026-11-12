// Schutzregeln der App. Diese Datei ist bewusst klein und ohne Abhängigkeiten,
// damit sie leicht zu prüfen ist (Abnahmekriterium ABN-5).
//
//  - AUT-8: Zahlungen, Lastschriften, Bankvorgänge und Bestellungen sind technisch gesperrt.
//  - AUT-9: Automatisierungen verwenden von Personen nur den Namen.
//  - AUT-10: Eingänge sind Daten, nie Anweisungen; Auffälligkeiten werden markiert.
//  - DAT-1: Rote Daten nimmt die App nicht an.

import { HttpError } from './util.js';

// ---------- AUT-8: Sperrliste ----------

/** Aktionsarten, die die App ausführen kann. Alles andere wird abgewiesen. */
export const ALLOWED_ACTIONS = {
  aufgabe_anlegen:   { label: 'Aufgabe anlegen', minLevel: 1, external: false },
  entwurf_erzeugen:  { label: 'Entwurf aus Vorlage erzeugen', minLevel: 1, external: false },
  erinnern:          { label: 'Erinnern', minLevel: 1, external: false },
  uebersicht:        { label: 'Übersicht erstellen', minLevel: 2, external: false },
  kalendereintrag:   { label: 'Kalendereintrag anlegen', minLevel: 3, external: true },
  // Nur über Schaltflächen bzw. den Automatisierungskatalog, nicht als frei konfigurierbare Regel:
  postfach_entwurf:  { label: 'Entwurf im Postfach ablegen', minLevel: 3, external: true, ruleable: false },
  m365_kalender:     { label: 'Termin im Outlook-Kalender eintragen', minLevel: 3, external: true, ruleable: false },
  ablage_hochladen:  { label: 'Datei nach SharePoint/OneDrive kopieren', minLevel: 3, external: true, ruleable: false },
};

/** Gesperrte Vorgänge. Begriffe werden in Aktionsart UND Inhalt geprüft. */
export const BLOCKED_TERMS = [
  'zahlung', 'zahlen', 'überweisung', 'ueberweisung', 'überweisen', 'ueberweisen', 'lastschrift', 'sepa',
  'einzug ausführen', 'einzug ausfuehren', 'abbuchung', 'abbuchen', 'bank', 'konto belasten', 'kontobewegung',
  'bestellung', 'bestellen', 'kaufen', 'einkauf', 'payment', 'transfer', 'order', 'purchase', 'iban',
];

const BLOCKED_ACTION_PATTERN = new RegExp(BLOCKED_TERMS.map(escapeRe).join('|'), 'i');
// Für Inhalte nur am Wortanfang, damit „Mitgliederzahlen“ oder „Sitzbank“ nicht anschlagen.
const BLOCKED_CONTENT_PATTERN = new RegExp(`(?<![\\p{L}])(?:${BLOCKED_TERMS.map(escapeRe).join('|')})`, 'iu');

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export class BlockedError extends HttpError {
  constructor(message) {
    super(422, message, { blocked: true });
  }
}

/**
 * Prüft eine Aktion vor dem Anlegen einer Regel und vor jeder Ausführung.
 * Wirft BlockedError, wenn die Aktion gesperrt oder unbekannt ist.
 */
export function assertActionAllowed(actionType, actionConfig = {}) {
  if (typeof actionType !== 'string' || !actionType) throw new BlockedError('Keine Aktion angegeben.');
  if (BLOCKED_ACTION_PATTERN.test(actionType)) {
    throw new BlockedError(`Gesperrt: „${actionType}“. Zahlungen, Lastschriften, Bankvorgänge und Bestellungen sind technisch ausgeschlossen (AUT-8).`);
  }
  if (!Object.hasOwn(ALLOWED_ACTIONS, actionType)) {
    throw new BlockedError(`Unbekannte Aktion „${actionType}“. Erlaubt sind nur: ${Object.values(ALLOWED_ACTIONS).map(a => a.label).join(', ')}.`);
  }
  // Auch der Inhalt darf keinen gesperrten Vorgang auslösen, etwa eine Aufgabe „Lastschrift ausführen“
  // als selbstständige Aktion. Aufgaben und Entwürfe dürfen über solche Themen SPRECHEN (z. B.
  // „Ersteinzug vorbereiten (manuell)“); gesperrt wird nur ein ausdrücklicher Ausführungsbefehl.
  const text = JSON.stringify(actionConfig ?? {});
  if (/\b(führe|fuehre|ausführen|ausfuehren|auslösen|ausloesen|veranlassen|durchführen|durchfuehren)\b/i.test(text)
      && BLOCKED_CONTENT_PATTERN.test(text)) {
    throw new BlockedError('Gesperrt: Die Aktion würde eine Zahlung, Lastschrift, einen Bankvorgang oder eine Bestellung auslösen (AUT-8).');
  }
  if (IBAN_RE.test(text)) {
    throw new BlockedError('Gesperrt: Die Aktion enthält Bankdaten (AUT-8, AUT-9).');
  }
  return ALLOWED_ACTIONS[actionType];
}

// ---------- AUT-9: nur Namen ----------

const IBAN_RE = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/;
const IBAN_RE_G = new RegExp(IBAN_RE.source, 'g');
const EMAIL_RE_G = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE_G = /(?:(?:\+|00)\d{2}[\s/-]?|\b0)\d{2,5}[\s/-]?\d{3,}(?:[\s/-]?\d{1,6})?\b/g;
const STREET_RE_G = /\b[A-ZÄÖÜ][a-zäöüß-]+(?:straße|strasse|str\.|weg|gasse|platz|allee|ring)\s+\d+[a-z]?\b/g;
const BIRTHDATE_RE_G = /\b(?:geb(?:oren|\.)?\s*(?:am)?\s*)\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}\b/gi;

/** Variablennamen, die in Vorlagen nicht vorkommen dürfen (Adressen, Telefon, Bankdaten). */
export const FORBIDDEN_VARIABLES = /^(adresse|anschrift|strasse|straße|plz|wohnort|telefon|tel|handy|mobil|email|e_mail|mail|iban|bic|konto|kontonummer|bank|bankverbindung|geburtsdatum|geburtstag|gesundheit|passwort)$/i;

/**
 * Entfernt Adressen, Telefonnummern, E-Mail-Adressen, Bankdaten und Geburtsdaten
 * aus automatisch erzeugten Texten. Gibt den bereinigten Text und Hinweise zurück.
 */
export function scrubPersonalData(text) {
  const warnings = [];
  let out = String(text ?? '');
  const rules = [
    [IBAN_RE_G, 'Bankdaten', '[Bankdaten entfernt]'],
    [EMAIL_RE_G, 'E-Mail-Adresse', '[E-Mail-Adresse entfernt]'],
    [STREET_RE_G, 'Anschrift', '[Anschrift entfernt]'],
    [BIRTHDATE_RE_G, 'Geburtsdatum', '[Geburtsdatum entfernt]'],
    [PHONE_RE_G, 'Telefonnummer', '[Telefonnummer entfernt]'],
  ];
  for (const [re, label, repl] of rules) {
    re.lastIndex = 0;
    if (re.test(out)) {
      warnings.push(`${label} wurde entfernt: Automatisierungen verwenden von Personen nur den Namen (AUT-9).`);
      re.lastIndex = 0;
      out = out.replace(re, repl);
    }
  }
  return { text: out, warnings };
}

/** Findet personenbezogene Angaben, ohne sie zu verändern (für Prüfungen beim Speichern). */
export function findPersonalData(text) {
  return scrubPersonalData(text).warnings.map(w => w.split(' wurde')[0]);
}

// ---------- AUT-10: Eingänge sind Daten ----------

const SUSPICIOUS = [
  [/\b(ignorier|vergiss)\w*\b.{0,40}\b(anweisung|regel|vorgabe|instruktion)/i, 'Enthält Anweisungen an das System'],
  [/\b(sofort|dringend|umgehend|heute noch)\b.{0,60}\b(überweis|ueberweis|zahl|bezahl|kaufen|bestell|gutschein)/i, 'Drängt zu Zahlung oder Bestellung'],
  [/\b(passwort|kennwort|zugangsdaten|login|pin|tan)\b/i, 'Fragt nach Zugangsdaten'],
  [/\b(neue|geänderte|geaenderte)\s+(bankverbindung|iban|kontonummer)/i, 'Meldet geänderte Bankverbindung'],
  [IBAN_RE, 'Enthält Bankdaten'],
  [/\b(gutschein|geschenkkarte|gift ?card|itunes|amazon[- ]karte)/i, 'Erwähnt Gutscheine oder Geschenkkarten'],
  [/https?:\/\/(?:\d{1,3}\.){3}\d{1,3}|https?:\/\/[^\s]*(?:bit\.ly|tinyurl|t\.co|is\.gd)/i, 'Enthält verkürzte oder ungewöhnliche Links'],
  [/\b(du bist|sie sind)\s+(jetzt|ab sofort)\b|\bals (ki|assistent|system)\b/i, 'Spricht das System direkt an'],
  [/\b(gesundheit|diagnose|krankheit|attest|krankmeldung|behinderung)\b/i, 'Möglicherweise Gesundheitsangaben (rote Daten)'],
];

/** Prüft einen Eingang auf Auffälligkeiten. Ergebnis: Liste von Hinweisen. */
export function inspectInbound(text) {
  const flags = [];
  for (const [re, label] of SUSPICIOUS) if (re.test(text)) flags.push(label);
  return flags;
}

// ---------- DAT-1: Datenampel ----------

export const DATA_CLASSES = ['gruen', 'gelb'];
export const DATA_CLASS_LABEL = { gruen: 'Grün: dauerhaft', gelb: 'Gelb: nur im Vorgang', rot: 'Rot: gar nicht' };

export function assertDataClass(v) {
  if (v === 'rot') {
    throw new HttpError(422, 'Rote Daten (Gesundheitsangaben, Zugangsdaten) nimmt die App nicht an (DAT-1).');
  }
  if (!DATA_CLASSES.includes(v)) throw new HttpError(400, 'Bitte eine Datenklasse wählen: Grün oder Gelb.');
  return v;
}

/** Prüft Text, der dauerhaft in die Wissensbasis soll (DAT-2). */
export function assertKnowledgeSafe(text) {
  const found = findPersonalData(text);
  if (found.length) {
    throw new HttpError(422, `In die Wissensbasis gehören nur grüne Daten. Gefunden: ${[...new Set(found)].join(', ')} (DAT-2).`);
  }
}
