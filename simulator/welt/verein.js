// Der virtuelle Verein: TTV Musterhausen 1962 e. V. – seit Jahrzehnten aktiv, aber ohne die App.
// Alles ist erfunden; Adressen enden auf .example (im Internet nicht vergeben).
// erschaffen() legt beim ersten Start die Welt an: Unterlagen im Vereinsordner, alte Mails,
// WhatsApp-Gruppen, Spielpläne. Die App startet dagegen leer und wird Schritt für Schritt eingerichtet.

import { addDays, formatDateDe, today } from '../../server/util.js';
import { clockNow } from '../../server/clock.js';
import { makePdf, textPdf } from './pdf.js';
import { initWelt, putFile, newId } from './zustand.js';

export const VEREIN = { name: 'Tischtennisverein Musterhausen 1962 e. V.', kurz: 'TTV Musterhausen', ort: 'Musterhausen', gegruendet: 1962, mitglieder: 64 };
export const HALL = 'Sporthalle Musterhausen, Schulstraße 1';

export const MAILBOX = {
  ttv: 'vorstand@ttv-musterhausen.example',
  sv: 'tischtennis@sv-beispieldorf.example',
  bezirk: 'bezirk@tt-musterkreis.example',
};

/** Vorstand und weitere Beteiligte. office = Amtsname in der App. */
export const PEOPLE = [
  { key: 'mia', name: 'Mia Muster', role: '1. Vorsitzende', office: 'Vorsitz', area: 'TTV Musterhausen', mail: 'mia.muster@mail.example', you: true, admin: true },
  { key: 'ben', name: 'Ben Beispiel', role: 'Kassenwart', office: 'Kasse', area: 'TTV Musterhausen', mail: 'ben.beispiel@mail.example', admin: true },
  { key: 'sara', name: 'Sara Satz', role: 'Sportwartin, stellv. Vorsitzende', office: 'Sportwart', area: 'TTV Musterhausen', mail: 'sara.satz@mail.example', admin: true },
  { key: 'jana', name: 'Jana Jugend', role: 'Jugendwartin', office: 'Jugendwart', area: 'TTV Musterhausen', mail: 'jana.jugend@mail.example' },
  { key: 'paul', name: 'Paul Presse', role: 'Öffentlichkeitsarbeit', office: 'Öffentlichkeitsarbeit', area: 'TTV Musterhausen', mail: 'paul.presse@mail.example' },
  { key: 'frieda', name: 'Frieda Feder', role: 'Schriftführerin', office: 'Schriftführung', area: 'TTV Musterhausen', mail: 'frieda.feder@mail.example' },
  { key: 'max', name: 'Max Mitglied', role: 'Mitgliederverwaltung', office: 'Mitgliederverwaltung', area: 'TTV Musterhausen', mail: 'max.mitglied@mail.example' },
  { key: 'karin', name: 'Karin Kuchen', role: 'Festausschuss', office: 'Veranstaltungen', area: 'TTV Musterhausen', mail: 'karin.kuchen@mail.example' },
  { key: 'udo', name: 'Udo Unger', role: 'Abteilungsleiter Tischtennis', office: 'Vorsitz', area: 'SV Beispieldorf', mail: 'udo.unger@mail.example' },
  { key: 'tom', name: 'Tom Turnier', role: 'Bezirkssportwart und Schiedsrichterwart', office: 'Bezirkssportwart', area: 'Bezirk Musterkreis', mail: 'tom.turnier@mail.example', admin: true },
];
export const person = (k) => PEOPLE.find(p => p.key === k);

export const OPPONENTS = ['SV Nachbarort', 'TTC Hügelhausen', 'DJK Talstadt', 'TSV Flussdorf', 'TTF Bergheim', 'SpVgg Weiler', 'TV Ackerland', 'TTG Seeblick'];
export const TEAMS = {
  herren1: { name: 'Herren I', liga: 'Bezirksliga Musterkreis', day: 6, time: '18:00', homeFirst: true },
  herren2: { name: 'Herren II', liga: 'Kreisliga A', day: 5, time: '19:30', homeFirst: false },
  jugend: { name: 'Jugend U15', liga: 'Bezirksklasse Jugend', day: 0, time: '10:00', homeFirst: false, suffix: ' U15' },
};

export function nextWeekday(from, weekday, min = 0) {
  let d = addDays(from, min);
  for (let i = 0; i < 7; i++) { if (new Date(d + 'T12:00:00Z').getUTCDay() === weekday) return d; d = addDays(d, 1); }
  return d;
}

export function makeSeason(start) {
  const games = [];
  for (const [key, t] of Object.entries(TEAMS)) {
    let d = nextWeekday(start, t.day, 2);
    for (let i = 0; i < 14; i++) {
      const opp = OPPONENTS[(i + key.length) % OPPONENTS.length] + (t.suffix || '');
      const home = (i % 2 === 0) === t.homeFirst;
      const us = `TTV Musterhausen${t.suffix || ''}${key === 'herren2' ? ' II' : ''}`;
      games.push({ uid: `ttv-${key}-${i}`, team: key, date: d, time: t.time, summary: home ? `${us} – ${opp}` : `${opp} – ${us}`, location: home ? HALL : `Halle ${opp.replace(/ U15$/, '')}`, home });
      d = addDays(d, 7);
    }
  }
  return games.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- Texte der Unterlagen ----------

export const SATZUNG = `§ 1 Name und Sitz
Der Verein führt den Namen „Tischtennisverein Musterhausen 1962 e. V.“ (TTV Musterhausen) und hat seinen Sitz in Musterhausen.

§ 2 Zweck
Zweck des Vereins ist die Förderung des Sports, insbesondere des Tischtennissports, und der Jugendarbeit. Der Verein ist selbstlos tätig.

§ 3 Mitgliedschaft
Mitglied kann jede natürliche Person werden. Über den schriftlichen Aufnahmeantrag entscheidet der Vorstand. Bei Minderjährigen ist die Unterschrift der Erziehungsberechtigten erforderlich. Mit dem Antrag ist ein SEPA-Lastschriftmandat zu erteilen.

§ 4 Austritt
Der Austritt erfolgt durch schriftliche Erklärung gegenüber dem Vorstand. Er ist nur zum Ende eines Kalenderjahres unter Einhaltung einer Frist von drei Monaten zulässig.

§ 5 Beiträge
Die Höhe der Beiträge regelt die Beitragsordnung, die die Mitgliederversammlung beschließt. Der Beitrag wird jährlich zum 1. März per Lastschrift eingezogen.

§ 6 Organe
Organe des Vereins sind die Mitgliederversammlung und der Vorstand.

§ 7 Mitgliederversammlung
Die ordentliche Mitgliederversammlung findet einmal jährlich im ersten Quartal statt. Sie wird vom Vorstand mindestens drei Wochen vorher in Textform unter Angabe der Tagesordnung einberufen. Anträge zur Tagesordnung sind spätestens eine Woche vor der Versammlung beim Vorstand einzureichen.

§ 8 Vorstand
Der Vorstand besteht aus der oder dem Vorsitzenden, der Stellvertretung, dem Kassenwart, dem Sportwart, dem Jugendwart, der Schriftführung und der Mitgliederverwaltung. Je zwei Vorstandsmitglieder vertreten den Verein gemeinsam. Scheidet ein Vorstandsmitglied vorzeitig aus, kann der Vorstand bis zur nächsten Mitgliederversammlung einen Nachfolger kommissarisch bestimmen.

§ 9 Kassenprüfung
Die Mitgliederversammlung wählt zwei Kassenprüfer für zwei Jahre. Sie prüfen die Kasse einschließlich aller Belege mindestens einmal jährlich und berichten der Mitgliederversammlung.

§ 10 Datenschutz
Der Verein verarbeitet personenbezogene Daten seiner Mitglieder nur zur Erfüllung des Vereinszwecks. Fotos von Mitgliedern werden nur mit Einwilligung veröffentlicht, bei Minderjährigen mit Einwilligung der Erziehungsberechtigten. Jedes Mitglied hat das Recht auf Auskunft über die zu seiner Person gespeicherten Daten; die Auskunft ist innerhalb eines Monats zu erteilen.

§ 11 Auflösung
Bei Auflösung des Vereins fällt das Vermögen an die Gemeinde Musterhausen, die es für die Förderung des Sports zu verwenden hat.`;

export const BEITRAGSORDNUNG = `§ 1 Beiträge
Kinder und Jugendliche bis einschließlich 17 Jahre zahlen 48 € im Jahr. Erwachsene ab 18 Jahren zahlen 96 € im Jahr.

§ 2 Wechsel der Beitragsstufe
Maßgeblich ist das Alter am 1. Januar des Beitragsjahres. Mitglieder, die wechseln, werden vorher schriftlich informiert.

§ 3 Ermäßigung
Auf Antrag kann der Vorstand Beiträge für Schüler, Studierende und Auszubildende ermäßigen.`;

function aemterText() {
  const by = (area) => PEOPLE.filter(p => p.area === area).map(p => `${p.role}: ${p.name} (${p.mail})${p.you ? ' – das bist du' : ''}`).join('\n');
  return `TTV Musterhausen – Vorstand\n${by('TTV Musterhausen')}\nVertretungen: Vorsitz ↔ Sportwartin; Kasse: bisher niemand; Jugend: Vorsitzende; Presse: Schriftführerin.\nSponsoring macht die Vorsitzende mit.\n\nSV Beispieldorf, Abteilung Tischtennis\n${by('SV Beispieldorf')}\nAlle anderen Aufgaben dort: ebenfalls Udo Unger, Vertretung Ben Beispiel.\n\nBezirk Musterkreis\n${by('Bezirk Musterkreis')}\nVertretung Bezirkssportwart: Mia Muster.\n\nFunktionspostfächer\nTTV Musterhausen: ${MAILBOX.ttv}\nSV Beispieldorf (Abt. TT): ${MAILBOX.sv}\nBezirk Musterkreis: ${MAILBOX.bezirk}`;
}

function jahresplanText(year) {
  return `Jahresplan des Vorstands (bisher als Notiz im Vorstandsordner)

Januar: Jahresabschluss bis 15. Januar (Kasse), danach Kassenprüfung.
Dezember: Beitragsstufen prüfen (wer wird 18?) – Mitgliederverwaltung, Anfang Dezember.
März: Beitragseinzug zum 1. März (Kasse, Vorbereitung ab Mitte Februar).
März: Mitgliederversammlung am dritten Freitag im März (${year + 1}: ${formatDateDe(thirdFriday(year + 1, 3))}), Einladung drei Wochen vorher.
Quartalsweise: Budgetplan aktualisieren (jeweils Anfang Januar, April, Juli, Oktober).
Mai: Mannschaftsmeldung Vorrunde bis 31. Mai (Sportwartin).
August: Saisonstart vorbereiten ab 20. August.
November: Sponsorentreffen Anfang November (Vorsitzende).
Dezember: Mannschaftsmeldung Rückrunde bis 1. Dezember (Sportwartin).

Bezirk Musterkreis: Bezirkstag im Juni, Schiedsrichtertreffen Ende August, Bezirksmeisterschaften im Januar (Ankündigung im Oktober).`;
}

function thirdFriday(year, month) {
  let d = `${year}-${String(month).padStart(2, '0')}-01`;
  let n = 0;
  for (let i = 0; i < 31; i++) { if (new Date(d + 'T12:00:00Z').getUTCDay() === 5 && ++n === 3) return d; d = addDays(d, 1); }
  return d;
}

export function sponsors(start) {
  return [
    { company: 'Autohaus Blechle', contact: 'Herr Blechle', kategorie: 'Trikot', start: '2024-07-01', ende: addDays(start, 430), pate: 'Mia Muster', status: 'aktiv', letzter_kontakt: addDays(start, -40) },
    { company: 'Bäckerei Krümel', contact: 'Frau Krümel', kategorie: 'Bande', start: '2023-01-01', ende: addDays(start, 45), pate: 'Mia Muster', status: 'aktiv', letzter_kontakt: addDays(start, -310) },
    { company: 'Malerbetrieb Pinsel & Söhne', contact: 'Frau Pinsel', kategorie: 'Bande', start: '2025-01-01', ende: addDays(start, 200), pate: 'Ben Beispiel', status: 'aktiv', letzter_kontakt: addDays(start, -90) },
    { company: 'Getränke Spritzig', contact: 'Herr Sprudel', kategorie: 'Förderer', start: '', ende: '', pate: 'Udo Unger', status: 'in Verhandlung (SV Beispieldorf)', letzter_kontakt: addDays(start, -20) },
  ];
}

const csv = (rows) => rows.map(r => r.map(v => /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)).join(',')).join('\n') + '\n';

function asanaCsv(start) {
  const head = ['Task ID', 'Created At', 'Completed At', 'Last Modified', 'Name', 'Section/Column', 'Assignee', 'Assignee Email', 'Start Date', 'Due Date', 'Tags', 'Notes', 'Projects', 'Parent task'];
  const rows = [];
  let id = 120000;
  const add = (name, section, who, due, { done = null, notes = '', parent = '', created = -60, tags = '' } = {}) => {
    const p = who ? person(who) : null;
    rows.push([String(++id), addDays(start, created), done === null ? '' : addDays(start, done), addDays(start, -1), name, section, p?.name || '', p?.mail || '', '', due === null ? '' : addDays(start, due), tags, notes, 'Vorstand TTV', parent]);
  };
  add('Hallenzeiten Rückrunde mit Gemeinde abstimmen', 'Laufend', 'mia', 14, { notes: 'Gemeinde will Belegung neu verteilen.' });
  add('Trikots für Herren II nachbestellen', 'Laufend', 'sara', 21, { notes: 'Größen bei den Spielern abfragen.' });
  add('Größen abfragen', '', 'sara', 7, { parent: 'Trikots für Herren II nachbestellen' });
  add('Angebot Autohaus Blechle einholen (Sponsoring Druck)', '', 'mia', 14, { parent: 'Trikots für Herren II nachbestellen' });
  add('Homepage: Trainingszeiten aktualisieren', 'Laufend', 'paul', 5);
  add('Weihnachtsfeier planen', 'Laufend', 'karin', 30, { notes: 'Vereinsheim ist reserviert.' });
  add('Essen bestellen', '', 'karin', 20, { parent: 'Weihnachtsfeier planen' });
  add('Einladung an Mitglieder', '', 'frieda', 16, { parent: 'Weihnachtsfeier planen' });
  add('Zuschuss Gemeinde für Jugendarbeit abrechnen', 'Kasse', 'ben', 25, { notes: 'Belege der Jugendfahrten sammeln.' });
  add('Schiedsrichterlehrgang: zwei Leute anmelden', 'Sport', 'sara', 18);
  add('Ballmaschine reparieren lassen', 'Sport', 'sara', null, { notes: 'Seit Sommer kaputt.', created: -150 });
  add('Mannschaftsmeldung Vorrunde', 'Sport', 'sara', -150, { done: -152, created: -190 });
  add('Mitgliederversammlung durchführen', 'Vorstand', 'mia', -230, { done: -230, created: -280 });
  add('Jahresabschluss Vorjahr', 'Kasse', 'ben', -290, { done: -295, created: -330 });
  add('Spendenbescheinigungen erstellen', 'Kasse', 'ben', -260, { done: -250, created: -300 });
  add('Vereinsausflug zum Bundesliga-Spiel', 'Ideen', '', null, { notes: 'Vorschlag aus der letzten MV.', created: -230, tags: 'Idee' });
  add('Mini-Meisterschaften an der Grundschule', 'Ideen', 'jana', null, { notes: 'Vorschlag aus der letzten MV.', created: -230, tags: 'Idee' });
  add('Hobbyrunde für Eltern am Freitag', 'Ideen', '', null, { notes: 'Vorschlag aus der letzten MV.', created: -230, tags: 'Idee' });
  return csv([head, ...rows]);
}

const VORNAMEN = ['Anna', 'Lukas', 'Mila', 'Jonas', 'Lina', 'Felix', 'Emma', 'Paul', 'Lea', 'Noah', 'Clara', 'Elias', 'Ida', 'Finn', 'Greta', 'Leon', 'Marie', 'Theo', 'Hanna', 'Emil', 'Sophie', 'Karl', 'Frieda', 'Moritz'];
const NACHNAMEN = ['Ahorn', 'Birke', 'Erle', 'Esche', 'Fichte', 'Linde', 'Pappel', 'Ulme', 'Weide', 'Eiche', 'Kiefer', 'Buche', 'Tanne', 'Lärche', 'Hasel', 'Holunder'];

function mitgliederCsv(start) {
  const year = Number(start.slice(0, 4));
  const rows = [['Mitgliedsnummer', 'Vorname', 'Nachname', 'Geburtsdatum', 'Eintritt', 'Beitragsart', 'Abteilung']];
  for (let i = 0; i < VEREIN.mitglieder; i++) {
    const age = i < 22 ? 7 + (i % 11) : 18 + ((i * 7) % 60);         // 22 Jugendliche, Rest Erwachsene
    const born = year - age;
    const birth = `${String(1 + (i * 3) % 28).padStart(2, '0')}.${String(1 + (i * 5) % 12).padStart(2, '0')}.${born}`;
    const stufe = age <= 17 ? 'Kinder und Jugendliche' : (i === 30 ? 'Kinder und Jugendliche' : 'Erwachsene'); // ein Fehler im Bestand
    rows.push([String(1000 + i), VORNAMEN[i % VORNAMEN.length], NACHNAMEN[(i * 7) % NACHNAMEN.length], birth, `${2000 + (i % 25)}-0${1 + (i % 9)}-01`, stufe, 'Tischtennis']);
  }
  return csv(rows);
}

function protokollBlocks(start) {
  const mv = addDays(start, -230);
  return [
    { text: 'Protokoll der Mitgliederversammlung', size: 16, bold: true, gap: 0 },
    { text: `TTV Musterhausen 1962 e. V. · ${formatDateDe(mv)}, 19:30 Uhr, Vereinsheim · 31 stimmberechtigte Mitglieder`, size: 9 },
    { rule: true },
    { text: 'TOP 1 Berichte des Vorstands', bold: true, gap: 10 },
    { text: 'Die Vorsitzende berichtet über die Saison. Kassenwart Ben Beispiel legt den Kassenbericht vor; die Kassenprüfer bestätigen eine ordnungsgemäße Kassenführung, bemängeln aber, dass mehrere Belege erst nachgereicht werden mussten.' },
    { text: 'TOP 2 Entlastung', bold: true, gap: 10 },
    { text: 'Der Vorstand wird einstimmig entlastet.' },
    { text: 'TOP 3 Wahlen', bold: true, gap: 10 },
    { text: 'Gewählt: Mia Muster (Vorsitz), Sara Satz (Sportwartin, Stellvertretung), Ben Beispiel (Kasse). Kassenprüfer: Gerd Genau und Petra Prüf.' },
    { text: 'TOP 4 Anträge und Ideen', bold: true, gap: 10 },
    { text: 'Vorgeschlagen und an den Vorstand zur Entscheidung gegeben: Vereinsausflug zum Bundesliga-Spiel; Mini-Meisterschaften an der Grundschule; Hobbyrunde für Eltern am Freitag.' },
    { text: 'TOP 5 Verschiedenes', bold: true, gap: 10 },
    { text: 'Hinweis eines Mitglieds: Fotos von Kindern auf der Homepage nur mit Einwilligung der Eltern. Der Vorstand sagt zu, das künftig sauber zu dokumentieren.' },
    { space: 20 }, { text: 'Protokoll: Frieda Feder (Schriftführerin)        Versammlungsleitung: Mia Muster', size: 9 },
  ];
}

// ---------- Welt anlegen ----------

export function erschaffen() {
  const start = today();
  const year = Number(start.slice(0, 4));
  const s = {
    version: 1, created_at: clockNow().toISOString(), start, offset: 0,
    files: {}, log: [], mails: [], post: [], docs: [], aussen: [], ereignisse: {}, kapitel: { achieved: {} },
    saison: true, rauschen: true,
    mailboxes: { [MAILBOX.ttv]: 'TTV Musterhausen – Vorstand', [MAILBOX.sv]: 'SV Beispieldorf – Abteilung Tischtennis', [MAILBOX.bezirk]: 'Bezirk Musterkreis' },
    chats: {
      vorstand: { name: 'Vorstand TTV', messages: [] },
      helfer: { name: 'TTV Helfer & Fest', messages: [] },
      eltern: { name: 'Eltern Jugend TTV', messages: [] },
    },
    games: makeSeason(start),
  };
  initWelt(s);

  const doc = (title, kind, description, file, text = null) => s.docs.push({ id: newId('d'), title, kind, description, file, text });
  doc('Satzung', 'pdf', 'Die gültige Satzung. Für die Auskunft der App den Text in die Wissensbasis übernehmen.', putFile('Satzung_TTV_Musterhausen.pdf', 'application/pdf', textPdf('Satzung des TTV Musterhausen 1962 e. V.', SATZUNG)), SATZUNG);
  doc('Beitragsordnung', 'pdf', 'Beiträge und Stichtag – gehört in die Einstellungen (Beitragsstufen) und in die Wissensbasis.', putFile('Beitragsordnung_TTV.pdf', 'application/pdf', textPdf('Beitragsordnung des TTV Musterhausen', BEITRAGSORDNUNG)), BEITRAGSORDNUNG);
  doc('Ämterliste und Postfächer', 'pdf', 'Wer welches Amt hat, wer vertritt – für Konten und Ämter in der App.', putFile('Aemterliste_Vorstand.pdf', 'application/pdf', textPdf('Ämterliste und Funktionspostfächer', aemterText())), aemterText());
  doc('Jahresplan des Vorstands', 'pdf', 'Die festen Termine im Vereinsjahr – damit lässt sich der geschätzte Jahreskalender der App korrigieren.', putFile('Jahresplan_Vorstand.pdf', 'application/pdf', textPdf('Jahresplan des Vorstands', jahresplanText(year))), jahresplanText(year));
  const sp = sponsors(start);
  const spText = sp.map(x => `${x.company} (${x.kategorie}) – Ansprechpartner ${x.contact}, Pate ${x.pate}, Laufzeit ${x.start ? formatDateDe(x.start) : '–'} bis ${x.ende ? formatDateDe(x.ende) : 'offen'}, Status ${x.status}, letzter Kontakt ${formatDateDe(x.letzter_kontakt)}`).join('\n');
  doc('Sponsorenübersicht', 'pdf', 'Bisher eine Liste in der Vorstandsmappe. In der App unter „Sponsoren“ anlegen.', putFile('Sponsoren_Uebersicht.pdf', 'application/pdf', textPdf('Sponsoren und Förderer', spText)), spText);
  doc('Asana-Export „Vorstand TTV“', 'csv', 'Bisherige Aufgabenliste aus Asana. In der App: Adminpanel → Asana-Import.', putFile('Asana_Vorstand_TTV.csv', 'text/csv', Buffer.from(asanaCsv(start))));
  doc('meinVerein-Export Mitglieder', 'csv', 'Gelbe Daten! Für die Prüfung der Beitragsstufen (nur mit Schalter „Gelb lokal“). Die App speichert den Export nicht.', putFile('meinVerein_Mitglieder.csv', 'text/csv', Buffer.from(mitgliederCsv(start))));
  doc('Protokoll der letzten Mitgliederversammlung', 'pdf', 'Mit offenen Ideen aus der Versammlung.', putFile('Protokoll_MV.pdf', 'application/pdf', makePdf(protokollBlocks(start), { title: 'Protokoll Mitgliederversammlung' })));
  doc('Hallenbelegungsplan', 'pdf', 'Aktueller Plan der Gemeinde.', putFile('Hallenbelegung_Sporthalle.pdf', 'application/pdf', makePdf([
    { text: 'Hallenbelegung Sporthalle Musterhausen', size: 15, bold: true, gap: 0 }, { rule: true },
    { text: 'Montag 18–20 Uhr: TTV Jugend\nMittwoch 19–22 Uhr: TTV Training Erwachsene\nFreitag 19–22 Uhr: TTV Herren II (Heimspiele)\nSamstag 16–22 Uhr: TTV Herren I (Heimspiele)\nSonntag 9–14 Uhr: TTV Jugend (Heimspiele)' },
  ], { title: 'Hallenbelegung' })));
  return s;
}

/** Ältere Mails, die schon im Postfach liegen (die App holt beim ersten Abruf nur die letzten 7 Tage). */
export function history(addMail) {
  const s = today();
  const at = (d, h = 10) => new Date(Date.parse(`${addDays(s, d)}T${String(h).padStart(2, '0')}:15:00Z`)).toISOString();
  addMail(MAILBOX.ttv, { from: 'info@ttvb-musterland.example', fromName: 'Tischtennisverband Musterland', subject: 'Newsletter Oktober', body: 'Liebe Vereine,\ndie Lizenzen für die Rückrunde müssen bis Monatsende beantragt sein.\nEuer Verband', received: at(-21) });
  addMail(MAILBOX.ttv, { from: 'rechnung@ball-versand.example', fromName: 'Ball-Versand', subject: 'Rechnung 88120 – Trainingsbälle', body: 'Anbei die Rechnung zu Ihrer Bestellung.', received: at(-15), attachments: [['Rechnung_88120.pdf', makePdf([{ text: 'Rechnung 88120', size: 15, bold: true }, { text: '72 Trainingsbälle 40+ … 64,80 €' }], { title: 'Rechnung 88120' })]] });
  addMail(MAILBOX.ttv, { from: 'kapitaen.h1@mail.example', fromName: 'Kapitän Herren I', subject: 'Spielbericht gegen TV Ackerland', body: 'Moin, 9:6 gewonnen! Bericht anbei.', received: at(-5, 21), attachments: [['Spielbericht_Ackerland.txt', Buffer.from('TTV Musterhausen – TV Ackerland 9:6 (Fantasie)')]] });
  addMail(MAILBOX.ttv, { from: 'halle@gemeinde-musterhausen.example', fromName: 'Gemeinde Musterhausen – Hallenverwaltung', subject: 'Hallenbelegungsplan Winter', body: 'Sehr geehrte Damen und Herren,\nanbei der Belegungsplan für die Wintermonate.', received: at(-3), attachments: [['Hallenplan_Winter.pdf', makePdf([{ text: 'Hallenbelegung Winter', size: 15, bold: true }, { text: 'Unverändert gegenüber dem Herbst.' }], { title: 'Hallenplan Winter' })]] });
  addMail(MAILBOX.ttv, { from: 'sara.satz@mail.example', fromName: 'Sara Satz', subject: 'Schiedsrichterlehrgang', body: 'Hi Mia, der Lehrgang ist am Monatsende. Wer könnte noch mit? Gruß Sara', received: at(-2, 19) });
  addMail(MAILBOX.bezirk, { from: 'staffel@tt-musterkreis.example', fromName: 'Staffelleitung Bezirksliga', subject: 'Erinnerung: Ergebnismeldung bis Sonntag 18 Uhr', body: 'Bitte die Ergebnisse weiterhin bis Sonntag 18 Uhr in click-TT eintragen.', received: at(-9) });
  addMail(MAILBOX.bezirk, { from: 'sport@tt-musterkreis.example', fromName: 'Bezirkssportwart', subject: 'Ausschreibung Bezirksmeisterschaften', body: 'Anbei die Ausschreibung. Meldeschluss sechs Wochen vorher.', received: at(-4), attachments: [['Ausschreibung_BM.pdf', makePdf([{ text: 'Ausschreibung Bezirksmeisterschaften', size: 15, bold: true }, { text: 'Fantasie-Ausschreibung des Bezirks Musterkreis.' }], { title: 'Ausschreibung' })]] });
  addMail(MAILBOX.sv, { from: 'abteilungen@sv-beispieldorf.example', fromName: 'Hauptverein SV Beispieldorf', subject: 'Abteilungsberichte bis Monatsende', body: 'Bitte die Abteilungsberichte für die Hauptversammlung schicken.', received: at(-6) });
}
