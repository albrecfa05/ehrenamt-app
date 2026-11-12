// Textvorlagen mit Variablen (ABL-3, AUT-5).
// Syntax: {{variable}} oder {{variable|Standardwert}}. Variablennamen: Buchstaben, Ziffern, Unterstrich.
// Eingebaute Variablen: heute, jahr, bereich, verein, absender, aufgabe, frist.

import { FORBIDDEN_VARIABLES, scrubPersonalData } from './guards.js';
import { formatDateDe, today, bad } from './util.js';

const VAR_RE = /\{\{\s*([A-Za-zÄÖÜäöüß_][\wÄÖÜäöüß]*)\s*(?:\|([^}]*))?\}\}/g;

export const BUILTIN_VARIABLES = ['heute', 'jahr', 'bereich', 'verein', 'absender', 'aufgabe', 'frist'];

/** Liefert die Variablen einer Vorlage in Reihenfolge des ersten Auftretens. */
export function extractVariables(...texts) {
  const seen = new Map();
  for (const t of texts) {
    for (const m of String(t || '').matchAll(VAR_RE)) {
      if (!seen.has(m[1])) seen.set(m[1], { name: m[1], default: m[2]?.trim() ?? '', builtin: BUILTIN_VARIABLES.includes(m[1]) });
    }
  }
  return [...seen.values()];
}

/** Prüft eine Vorlage beim Speichern: keine Variablen für Adressen, Telefon, Bankdaten (AUT-9). */
export function validateTemplate(subject, body) {
  const vars = extractVariables(subject, body);
  const forbidden = vars.filter(v => FORBIDDEN_VARIABLES.test(v.name));
  if (forbidden.length) {
    throw bad(`Diese Variablen sind nicht erlaubt, weil die App von Personen nur Namen verwendet (AUT-9): ${forbidden.map(v => v.name).join(', ')}. Solche Angaben ergänzt ein Mensch im Entwurf.`);
  }
  // Unausgeglichene Klammern finden
  const opens = (String(subject) + body).split('{{').length - 1;
  const closes = (String(subject) + body).split('}}').length - 1;
  if (opens !== closes) throw bad('Die Vorlage enthält unvollständige Variablen: Jede {{ braucht ein }}.');
  return vars;
}

/**
 * Setzt Variablen ein. Fehlende Werte werden als [[name]] sichtbar markiert, damit nichts
 * unbemerkt leer bleibt. Das Ergebnis wird auf personenbezogene Daten geprüft.
 */
export function render(text, values = {}, context = {}) {
  const builtins = {
    heute: formatDateDe(today()),
    jahr: today().slice(0, 4),
    bereich: context.areaName || '',
    verein: context.areaType === 'verein' ? context.areaName : (context.areaName || ''),
    absender: context.userName || '',
    aufgabe: context.taskTitle || '',
    frist: context.dueDate ? formatDateDe(context.dueDate) : '',
  };
  const missing = new Set();
  const out = String(text || '').replace(VAR_RE, (_, name, def) => {
    let v = values[name];
    if (v === undefined || v === null || v === '') v = builtins[name];
    if (v === undefined || v === null || v === '') v = def?.trim();
    if (v === undefined || v === null || v === '') { missing.add(name); return `[[${name}]]`; }
    return String(v);
  });
  return { text: out, missing: [...missing] };
}

/** Rendert Betreff und Text und entfernt personenbezogene Angaben (nur Namen, AUT-9). */
export function renderDraft(tpl, values, context) {
  const s = render(tpl.subject, values, context);
  const b = render(tpl.body, values, context);
  const scrubS = scrubPersonalData(s.text);
  const scrubB = scrubPersonalData(b.text);
  const warnings = [...new Set([...scrubS.warnings, ...scrubB.warnings])];
  const missing = [...new Set([...s.missing, ...b.missing])];
  if (missing.length) warnings.push(`Noch auszufüllen: ${missing.join(', ')}`);
  return { subject: scrubS.text, body: scrubB.text, warnings, missing };
}
