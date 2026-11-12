// Berechnungen per Code mit nachvollziehbarem Rechenweg (AUT-12).
// Jeder Rechner liefert { result, steps } – die Schritte landen im Protokoll des Vorgangs.
// Rechner arbeiten nur lesend und vorbereitend; sie lösen nie eine Zahlung aus.

import { addDays, bad, formatDateDe, isDate } from './util.js';
import { getSetting } from './db.js';

const eur = (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
const num = (v, name) => {
  const n = Number(String(v ?? '').replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) throw bad(`${name} ist keine Zahl.`);
  return n;
};

export const CALCULATORS = {
  beitragsstufe: {
    label: 'Beitragsstufe prüfen',
    description: 'Prüft anhand des Geburtsjahres, ob zum Stichtag eine andere Beitragsstufe gilt (z. B. Wechsel mit 18 vom ermäßigten zum aktiven Beitrag). Verwendet nur Name und Geburtsjahr.',
    fields: [
      { name: 'name', label: 'Name', type: 'text' },
      { name: 'geburtsjahr', label: 'Geburtsjahr', type: 'number' },
      { name: 'aktuelle_stufe', label: 'Aktuelle Stufe', type: 'select', optionsFrom: 'beitragsstufen' },
      { name: 'stichtag', label: 'Stichtag', type: 'date' },
    ],
    run(input) {
      const stufen = getSetting('beitragsstufen', DEFAULT_STUFEN);
      const jahr = num(input.geburtsjahr, 'Geburtsjahr');
      if (!isDate(input.stichtag)) throw bad('Stichtag fehlt.');
      const stichjahr = Number(input.stichtag.slice(0, 4));
      // Für die Stufe zählt das Alter, das im Jahr des Stichtags erreicht wird (Jahrgangsprinzip).
      const alter = stichjahr - jahr;
      const steps = [`Alter im Jahr ${stichjahr}: ${stichjahr} − ${jahr} = ${alter} Jahre (Jahrgangsprinzip)`];
      const passend = stufen.find(s => alter >= s.ab_alter && (s.bis_alter == null || alter <= s.bis_alter));
      if (!passend) throw bad('Für dieses Alter ist keine Beitragsstufe hinterlegt. Bitte unter Einstellungen ergänzen.');
      steps.push(`Hinterlegte Stufe für ${alter} Jahre: „${passend.name}“ (${passend.ab_alter}${passend.bis_alter != null ? '–' + passend.bis_alter : '+'} Jahre, ${eur(passend.beitrag)} pro Jahr)`);
      const wechsel = input.aktuelle_stufe && input.aktuelle_stufe !== passend.name;
      steps.push(wechsel ? `Aktuelle Stufe „${input.aktuelle_stufe}“ weicht ab → Wechsel nötig.` : 'Aktuelle Stufe passt → kein Wechsel.');
      steps.push('Hinweis: Die Umstellung in meinVerein erfolgt von Hand. Die App bucht nichts.');
      return {
        result: { name: input.name || '', stufe: passend.name, beitrag: passend.beitrag, wechsel: !!wechsel },
        summary: wechsel ? `${input.name || 'Mitglied'}: Wechsel zu „${passend.name}“ (${eur(passend.beitrag)})` : `${input.name || 'Mitglied'}: bleibt „${passend.name}“`,
        steps,
      };
    },
  },

  kuendigungsfrist: {
    label: 'Kündigungsfrist berechnen',
    description: 'Berechnet, zu welchem Termin eine Kündigung wirkt und bis wann sie eingehen muss.',
    fields: [
      { name: 'eingang', label: 'Eingang der Kündigung', type: 'date' },
      { name: 'frist_monate', label: 'Frist in Monaten (laut Satzung)', type: 'number', defaultFrom: 'kuendigung_frist_monate' },
      { name: 'zum', label: 'Wirksam zum', type: 'select', options: ['Jahresende', 'Halbjahresende', 'Quartalsende', 'Monatsende'] },
    ],
    run(input) {
      if (!isDate(input.eingang)) throw bad('Eingangsdatum fehlt.');
      const monate = num(input.frist_monate, 'Frist');
      const zum = input.zum || 'Jahresende';
      const ends = { Jahresende: [12], Halbjahresende: [6, 12], Quartalsende: [3, 6, 9, 12], Monatsende: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }[zum];
      if (!ends) throw bad('Unbekannter Termin.');
      const steps = [`Eingang: ${formatDateDe(input.eingang)}`, `Frist: ${monate} Monat(e) zum ${zum}`];
      const eingang = new Date(input.eingang + 'T12:00:00Z');
      let y = eingang.getUTCFullYear();
      for (let guard = 0; guard < 40; guard++) {
        for (const m of ends) {
          const end = new Date(Date.UTC(y, m, 0, 12)); // letzter Tag des Monats m
          // Spätester Eingang: letzter Tag des Monats, der „monate“ vor dem Endmonat liegt
          // (3 Monate zum 31.12. → Eingang bis 30.09.).
          const latestDay = new Date(Date.UTC(y, m - monate, 0, 12));
          if (eingang <= latestDay) {
            const wirksam = end.toISOString().slice(0, 10);
            const spaetestens = latestDay.toISOString().slice(0, 10);
            steps.push(`Nächstmöglicher Termin: ${formatDateDe(wirksam)}; dafür musste die Kündigung bis ${formatDateDe(spaetestens)} eingehen.`);
            steps.push(`${formatDateDe(input.eingang)} ≤ ${formatDateDe(spaetestens)} → wirksam zum ${formatDateDe(wirksam)}.`);
            return { result: { wirksam, spaetestens }, summary: `Kündigung wirksam zum ${formatDateDe(wirksam)}`, steps };
          }
        }
        y++;
      }
      throw bad('Frist konnte nicht berechnet werden.');
    },
  },

  einladungsfrist: {
    label: 'Einladungsfrist berechnen',
    description: 'Berechnet aus dem Versammlungstermin, bis wann eingeladen werden muss und wann Anträge eingehen müssen.',
    fields: [
      { name: 'termin', label: 'Termin der Versammlung', type: 'date' },
      { name: 'frist_tage', label: 'Einladungsfrist in Tagen (laut Satzung)', type: 'number', defaultFrom: 'einladung_frist_tage' },
      { name: 'antrag_tage', label: 'Antragsfrist in Tagen vor der Versammlung', type: 'number', defaultFrom: 'antrag_frist_tage' },
      { name: 'puffer_tage', label: 'Eigener Puffer in Tagen', type: 'number', default: 3 },
    ],
    run(input) {
      if (!isDate(input.termin)) throw bad('Termin fehlt.');
      const frist = num(input.frist_tage, 'Einladungsfrist');
      const antrag = num(input.antrag_tage || 0, 'Antragsfrist');
      const puffer = num(input.puffer_tage || 0, 'Puffer');
      const spaetestens = addDays(input.termin, -frist);
      const empfohlen = addDays(spaetestens, -puffer);
      const antragsschluss = antrag ? addDays(input.termin, -antrag) : null;
      const steps = [
        `Versammlung: ${formatDateDe(input.termin)}`,
        `Späteste Einladung: ${formatDateDe(input.termin)} − ${frist} Tage = ${formatDateDe(spaetestens)}`,
        `Empfohlen mit ${puffer} Tagen Puffer: ${formatDateDe(empfohlen)}`,
      ];
      if (antragsschluss) steps.push(`Antragsschluss: ${formatDateDe(input.termin)} − ${antrag} Tage = ${formatDateDe(antragsschluss)}`);
      steps.push('Fristen bitte gegen die gültige Satzung prüfen (Fundstelle in der Wissensbasis).');
      return { result: { spaetestens, empfohlen, antragsschluss }, summary: `Einladung spätestens ${formatDateDe(spaetestens)} versenden`, steps };
    },
  },

  budget_reserve: {
    label: 'Budget gegen Reserve prüfen',
    description: 'Vergleicht den geplanten Stand mit der selbst gesetzten Reserve (VOR-10). Nur lesend und vorbereitend; keine Bankdaten, nur Summen.',
    fields: [
      { name: 'stand', label: 'Aktueller Gesamtstand (€)', type: 'number' },
      { name: 'einnahmen', label: 'Geplante Einnahmen bis Jahresende (€)', type: 'number' },
      { name: 'ausgaben', label: 'Geplante Ausgaben bis Jahresende (€)', type: 'number' },
      { name: 'reserve', label: 'Reserve (€)', type: 'number', defaultFrom: 'budget_reserve' },
    ],
    run(input) {
      const stand = num(input.stand, 'Stand');
      const ein = num(input.einnahmen || 0, 'Einnahmen');
      const aus = num(input.ausgaben || 0, 'Ausgaben');
      const reserve = num(input.reserve, 'Reserve');
      const prognose = Math.round((stand + ein - aus) * 100) / 100;
      const abstand = Math.round((prognose - reserve) * 100) / 100;
      const steps = [
        `Prognose Jahresende: ${eur(stand)} + ${eur(ein)} − ${eur(aus)} = ${eur(prognose)}`,
        `Abstand zur Reserve: ${eur(prognose)} − ${eur(reserve)} = ${eur(abstand)}`,
        abstand >= 0 ? 'Reserve bleibt gewahrt.' : 'Achtung: Die Reserve wird unterschritten. Bitte im Vorstand besprechen.',
      ];
      return { result: { prognose, abstand, gewahrt: abstand >= 0 }, summary: abstand >= 0 ? `Reserve gewahrt (+${eur(abstand)})` : `Reserve unterschritten (${eur(abstand)})`, steps };
    },
  },

  faire_verteilung: {
    label: 'Einsätze fair verteilen',
    description: 'Verteilt Termine (Bewirtung, Arbeitseinsätze, Schiedsrichtereinsätze) gleichmäßig auf Personen und berücksichtigt bisherige Einsätze und Verfügbarkeiten. Liefert einen Vorschlag, keine Entscheidung.',
    fields: [
      { name: 'termine', label: 'Termine (eine Zeile je Termin, z. B. „2026-11-21 Heimspieltag“)', type: 'textarea' },
      { name: 'personen', label: 'Personen (eine Zeile je Person, optional „Name: bisherige Einsätze“)', type: 'textarea' },
      { name: 'nicht_verfuegbar', label: 'Nicht verfügbar (eine Zeile: „Name: 2026-11-21, 2026-12-05“)', type: 'textarea' },
      { name: 'je_termin', label: 'Personen je Termin', type: 'number', default: 2 },
    ],
    run(input) {
      const lines = (s) => String(s || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const termine = lines(input.termine).map(l => ({ date: (l.match(/\d{4}-\d{2}-\d{2}/) || [''])[0], label: l }));
      if (!termine.length) throw bad('Bitte Termine angeben.');
      const personen = lines(input.personen).map(l => {
        const [n, c] = l.split(':');
        return { name: n.trim(), count: Number(c) || 0, start: Number(c) || 0 };
      });
      if (!personen.length) throw bad('Bitte Personen angeben.');
      const away = new Map();
      for (const l of lines(input.nicht_verfuegbar)) {
        const [n, d] = l.split(':');
        away.set(n.trim(), new Set((d || '').split(/[,\s]+/).filter(Boolean)));
      }
      const per = Math.max(1, Math.min(10, Number(input.je_termin) || 1));
      const steps = [`${termine.length} Termin(e), ${personen.length} Person(en), je Termin ${per}.`,
        'Regel: Immer die Verfügbaren mit den wenigsten Einsätzen zuerst; bei Gleichstand alphabetisch.'];
      const plan = [];
      for (const t of termine) {
        const avail = personen.filter(p => !(away.get(p.name)?.has(t.date)));
        avail.sort((a, b) => a.count - b.count || a.name.localeCompare(b.name, 'de'));
        const chosen = avail.slice(0, per);
        chosen.forEach(p => p.count++);
        const fehlt = per - chosen.length;
        plan.push({ termin: t.label, personen: chosen.map(p => p.name), fehlt });
        steps.push(`${t.label}: ${chosen.map(p => p.name).join(', ') || '—'}${fehlt ? ` (es fehlen ${fehlt})` : ''}`);
      }
      steps.push('Einsätze danach: ' + personen.map(p => `${p.name} ${p.count}${p.start ? ` (vorher ${p.start})` : ''}`).join(', '));
      return { result: { plan, stand: personen.map(p => ({ name: p.name, einsaetze: p.count })) }, summary: `Einsatzplan für ${termine.length} Termin(e) vorgeschlagen`, steps };
    },
  },

  frist: {
    label: 'Frist rechnen',
    description: 'Rechnet ein Datum plus oder minus eine Anzahl Tage.',
    fields: [
      { name: 'datum', label: 'Ausgangsdatum', type: 'date' },
      { name: 'tage', label: 'Tage (negativ = davor)', type: 'number' },
    ],
    run(input) {
      if (!isDate(input.datum)) throw bad('Datum fehlt.');
      const n = num(input.tage, 'Tage');
      const r = addDays(input.datum, n);
      const wd = new Date(r + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'long', timeZone: 'UTC' });
      return { result: { datum: r }, summary: `${formatDateDe(r)} (${wd})`, steps: [`${formatDateDe(input.datum)} ${n >= 0 ? '+' : '−'} ${Math.abs(n)} Tage = ${formatDateDe(r)}, ein ${wd}`] };
    },
  },
};

// Annahme, bis die echten Beitragssätze eingetragen sind (Einstellungen → Beitragsstufen)
export const DEFAULT_STUFEN = [
  { name: 'Kinder und Jugendliche', ab_alter: 0, bis_alter: 17, beitrag: 60 },
  { name: 'Aktive', ab_alter: 18, bis_alter: null, beitrag: 120 },
];

export function runCalculator(key, input) {
  const c = CALCULATORS[key];
  if (!c) throw bad('Unbekannter Rechner.');
  return c.run(input || {});
}
