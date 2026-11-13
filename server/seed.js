// Grunddaten beim ersten Start: Bereiche, Ämter, Vorgangsvorlagen VOR-1 … VOR-15, Textvorlagen,
// Jahreskalender, Systemlandkarte, Hilfe/FAQ, Wissensbasis-Grundstock und Beispielregeln.
// Läuft nur, wenn die Datenbank noch leer ist. Alle Inhalte sind danach in der App änderbar.
// Daten im Jahreskalender sind Annahmen (markiert) und müssen von den Ämtern geprüft werden.

import { q, tx } from './db.js';
import { nowIso } from './util.js';
import { splitSections } from './api/knowledge.js';

const AREAS = [
  { key: 'ttsf-hohberg', name: 'TTSF Hohberg', type: 'verein', color: '#2563eb' },
  { key: 'buehlertal', name: 'Bühlertal', type: 'verein', color: '#0d9488' },
  { key: 'bezirk-mittelbaden', name: 'Bezirk Mittelbaden', type: 'bezirk', color: '#9333ea' },
];

const VEREIN_OFFICES = ['Vorsitz', 'Kasse', 'Sportwart', 'Jugendwart', 'Öffentlichkeitsarbeit', 'Schriftführung', 'Mitgliederverwaltung', 'Sponsoring', 'Veranstaltungen'];
const BEZIRK_OFFICES = ['Bezirksvorsitz', 'Bezirkssportwart', 'Schiedsrichterwart', 'Bezirksjugendwart', 'Pressewart'];

// ---------- Textvorlagen (ABL-3) ----------
const TEXTS = [
  {
    key: 'T-WILLKOMMEN', name: 'Willkommensmail neues Mitglied', category: 'Mitglieder', kind: 'mail',
    subject: 'Herzlich willkommen bei {{verein}}!',
    body: `Hallo {{vorname}},

schön, dass du ab dem {{eintrittsdatum}} bei {{verein}} dabei bist! Wir freuen uns auf viele gemeinsame Ballwechsel.

Ein paar Dinge zum Start:
- Training: {{trainingszeiten|siehe Website}}
- Ansprechperson für alle Fragen: {{ansprechperson}}
- Spielberechtigung: Wir kümmern uns um die Anmeldung beim Verband, falls du Punktspiele bestreiten möchtest.
- Beitrag: {{beitragsstufe}}. Der Einzug erfolgt wie im Aufnahmeantrag angegeben.

Melde dich gerne, wenn du Fragen hast.

Sportliche Grüße
{{absender}}
{{verein}}`,
    notes: 'Persönliche Angaben wie Adresse oder Bankverbindung gehören nicht in die Vorlage. Die Mailadresse ergänzt ein Mensch beim Versand.',
  },
  {
    key: 'T-BEITRAG-WECHSEL', name: 'Info Wechsel der Beitragsstufe', category: 'Mitglieder', kind: 'mail',
    subject: 'Deine Mitgliedschaft bei {{verein}}: neue Beitragsstufe ab {{ab_datum}}',
    body: `Hallo {{vorname}},

zum {{ab_datum}} wechselst du von der Stufe „{{alte_stufe}}“ in die Stufe „{{neue_stufe}}“. Der Jahresbeitrag beträgt dann {{beitrag}}.

Falls du Fragen hast oder sich bei dir etwas geändert hat, melde dich gerne bei {{absender}}.

Viele Grüße
{{absender}}
{{verein}}`,
  },
  {
    key: 'T-SR-RUNDFRAGE', name: 'Rundfrage Schiedsrichter-Ersatz', category: 'Spielbetrieb', kind: 'mail',
    subject: 'Ersatz gesucht: Schiedsrichtereinsatz am {{spieldatum}}',
    body: `Hallo zusammen,

für das Spiel {{begegnung}} am {{spieldatum}} um {{uhrzeit}} in {{spielort}} suchen wir kurzfristig einen Ersatz als Schiedsrichter.

Wer kann einspringen? Bitte bis {{rueckmeldung_bis}} kurz zurückmelden.

Danke euch!
{{absender}}`,
    notes: 'Rundfrage an mehrere Personen: Beim Übernehmen ist eine eigene Bestätigung der Empfängerliste nötig (AUT-7).',
  },
  {
    key: 'T-VERLEGUNG', name: 'Anfrage Spielverlegung', category: 'Spielbetrieb', kind: 'mail',
    subject: 'Anfrage Spielverlegung {{begegnung}} ({{liga}})',
    body: `Hallo {{gegner_ansprechperson}},

wir möchten das Spiel {{begegnung}} in der {{liga}}, angesetzt am {{alter_termin}}, gerne verlegen. Grund: {{grund}}.

Unser Vorschlag: {{neuer_termin}}. Alternativ: {{alternativtermin|nach Absprache}}.

Wenn ihr einverstanden seid, stellen wir den Verlegungsantrag in click-TT bzw. melden ihn der Staffelleitung.

Viele Grüße
{{absender}}
{{verein}}`,
  },
  {
    key: 'T-SPENDE', name: 'Spendenbescheinigung (Begleitschreiben)', category: 'Finanzen', kind: 'dokument',
    subject: 'Zuwendungsbestätigung für {{jahr}}',
    body: `Liebe/r {{name}},

herzlichen Dank für Ihre Unterstützung von {{verein}}. Anbei erhalten Sie die Zuwendungsbestätigung über {{betrag}} vom {{zuwendungsdatum}}.

Verwendungszweck: {{zweck|Förderung des Sports}}

Mit sportlichen Grüßen
{{absender}}
{{verein}}

— Hinweis für die Bearbeitung —
Die Bestätigung selbst nach dem amtlichen Muster erstellen und unterschreiben. Die App bereitet nur das Begleitschreiben vor; Unterschrift und Ausstellung bleiben beim Amt.`,
  },
  {
    key: 'T-VERZICHT', name: 'Verzichtserklärung Aufwandserstattung', category: 'Finanzen', kind: 'dokument',
    subject: 'Verzicht auf Erstattung von Aufwendungen',
    body: `Verzichtserklärung

Ich, {{name}}, verzichte hiermit auf die Erstattung meiner Aufwendungen für {{anlass}} in Höhe von {{betrag}} gegenüber {{verein}}.

Der Anspruch auf Erstattung wurde vor der Tätigkeit durch {{grundlage|Vorstandsbeschluss}} eingeräumt.

Ort, Datum: ____________________   Unterschrift: ____________________`,
    notes: 'Vor Verwendung mit der Kasse und der aktuellen Rechtslage abgleichen.',
  },
  {
    key: 'T-FOERDER', name: 'Förder- oder Zuschussantrag', category: 'Finanzen', kind: 'dokument',
    subject: 'Antrag auf {{foerderart}} – {{verein}}',
    body: `Antrag auf {{foerderart}}

Antragsteller: {{verein}}
Ansprechperson: {{absender}}
Maßnahme: {{massnahme}}
Zeitraum: {{zeitraum}}
Beantragte Summe: {{betrag}}

Begründung:
{{begruendung}}

Anlagen: {{anlagen|keine}}`,
  },
  {
    key: 'T-SPONSORRECHNUNG', name: 'Sponsorenrechnung', category: 'Sponsoring', kind: 'dokument',
    subject: 'Rechnung Sponsoring {{jahr}} – {{sponsor}}',
    body: `Rechnung Nr. {{rechnungsnummer}}

An: {{sponsor}}
Leistung: {{leistung}} im Zeitraum {{zeitraum}}
Betrag: {{betrag}}

Vielen Dank für Ihre Unterstützung von {{verein}}.

— Hinweis: Rechnungsangaben (Steuernummer, Bankverbindung) ergänzt die Kasse von Hand. Die App erstellt nur den Entwurf. —`,
  },
  {
    key: 'T-SPONSOR-KONTAKT', name: 'Sponsorenkontakt und Verlängerung', category: 'Sponsoring', kind: 'mail',
    subject: 'Unsere Partnerschaft {{jahr}}',
    body: `Hallo {{ansprechperson}},

die Partnerschaft zwischen {{sponsor}} und {{verein}} läuft zum {{laufzeit_ende}} aus. Wir möchten uns herzlich für die Unterstützung bedanken und würden die Zusammenarbeit gerne fortsetzen.

Hätten Sie in den nächsten Wochen Zeit für ein kurzes Gespräch? Vorschlag: {{terminvorschlag}}.

Viele Grüße
{{absender}}`,
  },
  {
    key: 'T-EINLADUNG-MV', name: 'Einladung Mitgliederversammlung', category: 'Versammlungen', kind: 'mail',
    subject: 'Einladung zur Mitgliederversammlung am {{termin}}',
    body: `Liebe Mitglieder,

hiermit laden wir satzungsgemäß zur ordentlichen Mitgliederversammlung ein.

Termin: {{termin}}, {{uhrzeit}} Uhr
Ort: {{ort}}

Tagesordnung:
{{tagesordnung}}

Anträge zur Tagesordnung bitte bis {{antragsschluss}} schriftlich an den Vorstand.

Wir freuen uns auf euer Kommen!
Der Vorstand von {{verein}}`,
    notes: 'Fristen mit dem Rechner „Einladungsfrist“ aus der Satzung bestimmen.',
  },
  {
    key: 'T-PROTOKOLL', name: 'Protokoll (Gerüst)', category: 'Versammlungen', kind: 'dokument',
    subject: 'Protokoll {{sitzung}} vom {{termin}}',
    body: `Protokoll {{sitzung}}

Datum: {{termin}}   Ort: {{ort}}
Beginn: {{beginn}}   Ende: {{ende}}
Anwesend: {{anwesend}}
Protokoll: {{absender}}

TOP 1 Begrüßung und Feststellung der Beschlussfähigkeit
TOP 2 …

Beschlüsse:
- …

Ort, Datum, Unterschriften: Versammlungsleitung / Protokollführung`,
  },
  {
    key: 'T-SPIELBERICHT', name: 'Spielbericht', category: 'Öffentlichkeitsarbeit', kind: 'text',
    subject: '{{mannschaft}}: {{ergebnis}} gegen {{gegner}}',
    body: `{{mannschaft}} {{ergebnis_wort|trennt sich}} {{ergebnis}} von {{gegner}}

Am {{spieltag}} traf die {{mannschaft}} in der {{liga}} auf {{gegner}}. {{verlauf}}

Punkte für uns: {{punkte}}

Nächstes Spiel: {{naechstes_spiel}}`,
    notes: 'Ergebnisse aus click-TT/myTischtennis übernehmen (öffentlich, grün).',
  },
  {
    key: 'T-TURNIER', name: 'Termin- oder Turnierankündigung', category: 'Öffentlichkeitsarbeit', kind: 'text',
    subject: '{{veranstaltung}} am {{termin}}',
    body: `{{veranstaltung}} am {{termin}} in {{ort}}

{{beschreibung}}

Konkurrenzen: {{konkurrenzen}}
Meldeschluss: {{meldeschluss}}
Ausschreibung: {{link|folgt}}

Wir freuen uns auf viele Teilnehmende!`,
  },
  {
    key: 'T-ELTERN', name: 'Elterninformation Jugend', category: 'Jugend', kind: 'mail',
    subject: 'Info für Eltern: {{anlass}}',
    body: `Liebe Eltern,

kurze Info zu {{anlass}} am {{termin}}:

{{information}}

Fahrdienst: {{fahrdienst|wird noch abgestimmt}}
Rückmeldung bitte bis {{rueckmeldung_bis}}.

Viele Grüße
{{absender}}
Jugendabteilung {{verein}}`,
    notes: 'Daten Minderjähriger: nur Vornamen, keine weiteren Angaben in Entwürfe übernehmen.',
  },
  {
    key: 'T-HELFER', name: 'Helferaufruf Bewirtung / Arbeitseinsatz', category: 'Veranstaltungen', kind: 'mail',
    subject: 'Helfer gesucht: {{anlass}} am {{termin}}',
    body: `Hallo zusammen,

für {{anlass}} am {{termin}} brauchen wir Unterstützung. Der Einsatzplan (fair verteilt nach bisherigen Einsätzen):

{{einsatzplan}}

Wer nicht kann, bitte bis {{rueckmeldung_bis}} Bescheid geben und möglichst selbst Ersatz suchen.

Ablauf und Hinweise zur Küche: siehe Auskunft in der App bzw. Aushang.

Danke euch!
{{absender}}`,
  },
];

// ---------- Vorgangsvorlagen VOR-1 … VOR-15 (Kapitel 5) ----------
// steps: [Titel, Beschreibung, manuell?, Textvorlage-Key?, Rechner?]
const PROCESSES = [
  {
    key: 'VOR-1', name: 'Neuaufnahme eines Mitglieds', scope: 'verein', office_name: 'Mitgliederverwaltung, Kasse', max_level: 2, data_class: 'gelb', source_ref: '1.1, 2.6, Anh. A',
    summary: 'Antrag prüfen, Daten in meinVerein eingeben, Ersteinzug vorbereiten, Willkommensmail als Entwurf, Unterlagen ablegen.',
    guide: `Ziel: Ein neues Mitglied ist vollständig erfasst, begrüßt und die Unterlagen liegen in der Ablage.

So gehst du vor:
1. Aufnahmeantrag prüfen: unterschrieben, Beitragsstufe angekreuzt, bei Minderjährigen Unterschrift der Erziehungsberechtigten, SEPA-Mandat vorhanden.
2. Daten in meinVerein eingeben (von Hand, die App schreibt nicht in meinVerein).
3. Ersteinzug vorbereiten: in meinVerein vormerken. Die App löst keine Lastschrift aus.
4. Willkommensmail aus der Vorlage erzeugen, prüfen und selbst verschicken.
5. Antrag mit einheitlichem Namen ablegen, z. B. „2026-11-12 - Mitglied - Aufnahmeantrag“ (gelb).

Stolpersteine: Fehlendes SEPA-Mandat → Status „Wartet auf Zulieferung“ setzen und eintragen, wer es schuldet.`,
    steps: [
      ['Aufnahmeantrag prüfen', 'Unterschrift, Beitragsstufe, SEPA-Mandat, bei Minderjährigen Unterschrift der Eltern.'],
      ['Daten in meinVerein eingeben', 'Von Hand in meinVerein. Die App schreibt nicht in die Vereinssoftware.', true],
      ['Ersteinzug vorbereiten', 'In meinVerein vormerken. Lastschriften löst die App nie aus.', true],
      ['Willkommensmail als Entwurf erzeugen und verschicken', 'Entwurf aus der Vorlage, prüfen, selbst versenden.', false, 'T-WILLKOMMEN'],
      ['Unterlagen ablegen', 'Antrag als gelbe Datei an diese Aufgabe hängen.'],
    ],
  },
  {
    key: 'VOR-2', name: 'Mitgliederänderungen und Beitragsstufen', scope: 'verein', office_name: 'Mitgliederverwaltung, Kasse', max_level: 1, data_class: 'gelb', source_ref: '1.5, 2.3',
    summary: 'Jährliche Prüfung der Beitragsstufen (z. B. Wechsel mit 18), Kündigungen mit Frist.',
    guide: `Ziel: Alle Mitglieder stehen in der richtigen Beitragsstufe, Kündigungen werden fristgerecht verbucht.

Jährliche Prüfung:
1. In meinVerein die Liste der Jahrgänge exportieren, die im neuen Jahr eine Altersgrenze erreichen (z. B. 18).
2. Je Person den Rechner „Beitragsstufe prüfen“ nutzen (nur Name und Geburtsjahr eingeben).
3. Umstellungen in meinVerein von Hand vornehmen und die Info-Mail als Entwurf erzeugen.

Kündigung:
1. Eingangsdatum notieren, Rechner „Kündigungsfrist berechnen“ nutzen.
2. Austritt in meinVerein zum berechneten Termin eintragen, Bestätigung schicken.`,
    steps: [
      ['Betroffene Jahrgänge aus meinVerein ermitteln', 'Excel-Export bereitstellen; nur lesend.', true],
      ['Beitragsstufe je Person prüfen', 'Rechner „Beitragsstufe prüfen“.', false, null, 'beitragsstufe'],
      ['Umstellung in meinVerein vornehmen', 'Von Hand.', true],
      ['Info an Mitglied als Entwurf', '', false, 'T-BEITRAG-WECHSEL'],
      ['Kündigungen: Frist berechnen', 'Nur bei Kündigungen.', false, null, 'kuendigungsfrist'],
    ],
  },
  {
    key: 'VOR-3', name: 'Schiedsrichter-Ersatz, Spielverlegung, Kleinanfragen', scope: 'beide', office_name: 'Sportwart, Bezirkssportwart, Schiedsrichterwart', max_level: 1, data_class: 'gelb', baseline_minutes: 10, source_ref: '1.1, Anh. A',
    summary: 'Anfrage erfassen, Rundfrage oder Anfrage als Entwurf, Rückmeldungen nachhalten.',
    guide: `Ziel: Kleinanfragen sind in wenigen Minuten erledigt und nichts geht verloren.

1. Anfrage erfassen (Eingang oder direkt als Aufgabe), Frist eintragen.
2. Passenden Entwurf erzeugen: Rundfrage Schiedsrichter-Ersatz oder Anfrage Spielverlegung. Empfänger nur mit Namen eintragen.
3. Entwurf übernehmen und selbst verschicken. Bei vielen Empfängern die Liste bestätigen.
4. Status „Wartet auf Zulieferung“ setzen: wer muss antworten?
5. Ergebnis in click-TT bzw. bei der Staffelleitung eintragen (von Hand) und abschließen. Minuten erfassen.`,
    steps: [
      ['Anfrage erfassen und Frist setzen', ''],
      ['Rundfrage bzw. Anfrage als Entwurf', 'Vorlage passend wählen.', false, 'T-SR-RUNDFRAGE'],
      ['Rückmeldungen nachhalten', 'Status „Wartet auf Zulieferung“ mit Namen.'],
      ['Ergebnis eintragen (click-TT/Staffelleitung)', 'Von Hand; die App ändert nichts im Verbandssystem.', true],
    ],
  },
  {
    key: 'VOR-4', name: 'Mannschaftsmeldung', scope: 'verein', office_name: 'Sportwart', max_level: 1, data_class: 'gruen', source_ref: '2.2, Anh. A',
    summary: 'Meldung und Aufstellungsvarianten gegen die Regeln prüfen, Frist im Kalender.',
    guide: `Ziel: Fristgerechte, regelkonforme Mannschaftsmeldung.

1. Meldefrist aus dem Jahreskalender prüfen (Termin des Bezirks).
2. Spielerwünsche sammeln (Kommentare an dieser Aufgabe).
3. Aufstellungsvarianten erstellen; Regeln (Sollstärke, Reihenfolge nach Q-TTR, Sperrvermerke) in der Auskunft nachschlagen – immer mit Fundstelle der Wettspielordnung.
4. Meldung in click-TT von Hand eintragen, Bestätigung ablegen.`,
    steps: [
      ['Meldefrist prüfen', 'Termin im Jahreskalender und bei der Staffelleitung.'],
      ['Spielerwünsche einsammeln', 'Als Kommentare an der Aufgabe.'],
      ['Aufstellungsvarianten gegen die Regeln prüfen', 'Auskunft nutzen, Fundstelle notieren.'],
      ['Meldung in click-TT eintragen', 'Von Hand.', true],
      ['Bestätigung ablegen', ''],
    ],
  },
  {
    key: 'VOR-5', name: 'Bescheinigungen und Anträge', scope: 'verein', office_name: 'Kasse, Vorsitz', max_level: 1, never_execute: 1, data_class: 'gelb', source_ref: '2.2, 2.6, Anh. A',
    summary: 'Spendenbescheinigung, Verzichtserklärung, Trainerförderung, Zuschussantrag, Sponsorenrechnung aus Vorlage vorbereiten. Nie ausführen.',
    guide: `Ziel: Das Dokument liegt als prüfbarer Entwurf vor; Unterschrift und Versand bleiben beim Amt.

1. Passende Textvorlage wählen und Variablen ausfüllen.
2. Entwurf prüfen, ins Dokument übernehmen (amtliche Muster beachten).
3. Unterschreiben und versenden durch das Amt.
4. Kopie ablegen (gelb).

Wichtig: Die App bucht nichts, stellt nichts aus und überweist nichts.`,
    steps: [
      ['Vorlage wählen und Entwurf erzeugen', '', false, 'T-SPENDE'],
      ['Entwurf prüfen und ins Dokument übernehmen', 'Amtliche Muster beachten.', true],
      ['Unterschreiben und versenden', 'Durch das Amt.', true],
      ['Kopie ablegen', ''],
    ],
  },
  {
    key: 'VOR-6', name: 'Sponsorenpflege', scope: 'verein', office_name: 'Sponsoring, Vorsitz', max_level: 1, data_class: 'gelb', source_ref: '1.5, 2.4, Anh. A',
    summary: 'Kontakte, Paten, Laufzeiten und Verlängerungen nachhalten; Erinnerung an Kontaktpflege und Sponsorentreffen.',
    guide: `Ziel: Kein Sponsorvertrag läuft unbemerkt aus, jeder Sponsor hat eine Patin oder einen Paten.

1. Übersicht der Sponsoren mit Laufzeit und Pate aktuell halten (Ablage, grün: nur Firmenname, Laufzeit, Pate).
2. Drei Monate vor Laufzeitende: Kontakt-Entwurf erzeugen, Termin vereinbaren.
3. Ergebnis (Verlängerung/Ende) kommentieren, ggf. Rechnung über VOR-5 vorbereiten.
4. Einmal jährlich Sponsorentreffen planen (Jahreskalender).`,
    steps: [
      ['Laufzeiten und Paten prüfen', ''],
      ['Kontakt aufnehmen (Entwurf)', '', false, 'T-SPONSOR-KONTAKT'],
      ['Ergebnis festhalten', 'Kommentar: verlängert / beendet / offen.'],
      ['Rechnung anstoßen (VOR-5)', 'Falls verlängert.'],
    ],
  },
  {
    key: 'VOR-7', name: 'Öffentlichkeitsarbeit', scope: 'beide', office_name: 'Öffentlichkeitsarbeit, Pressewart', max_level: 1, data_class: 'gruen', source_ref: '1.1, 1.5, Anh. A',
    summary: 'Artikel, Spielberichte und Website-Beiträge als Entwurf; Bilder und Infos aus mehreren Kanälen an einer Aufgabe sammeln.',
    guide: `Ziel: Berichte erscheinen zeitnah, Material liegt gesammelt an einer Stelle.

1. Aufgabe je Bericht anlegen; Bilder und Infos aus WhatsApp und Mail als Dateien bzw. Kommentare anhängen.
2. Status „Wartet auf Zulieferung“, solange Material fehlt (wer schuldet was?).
3. Entwurf aus der Vorlage „Spielbericht“ erzeugen, Ergebnisse aus click-TT übernehmen.
4. Auf Website/Presse von Hand veröffentlichen; Bildrechte beachten (bei Minderjährigen Einwilligung).`,
    steps: [
      ['Material sammeln', 'Bilder und Infos an diese Aufgabe hängen.'],
      ['Text als Entwurf', '', false, 'T-SPIELBERICHT'],
      ['Bildrechte prüfen', 'Einwilligungen, besonders bei Minderjährigen.'],
      ['Veröffentlichen', 'Von Hand auf Website, Social Media oder Presse.', true],
    ],
  },
  {
    key: 'VOR-8', name: 'Einladungen und Protokolle', scope: 'beide', office_name: 'Vorsitz, Schriftführung, Bezirksvorsitz', max_level: 1, data_class: 'gelb', source_ref: '1.1, Anh. A',
    summary: 'Einladung mit Fristen aus der Satzung; Protokoll auf Rechtschreibung und Grammatik prüfen und fertigstellen.',
    guide: `Ziel: Fristgerechte Einladung, sauberes Protokoll.

Einladung:
1. Termin festlegen, Rechner „Einladungsfrist“ nutzen; Frist mit Fundstelle in der Satzung prüfen.
2. Tagesordnung abstimmen, Entwurf aus Vorlage erzeugen, selbst verschicken (Empfängerliste bestätigen).

Protokoll:
1. Gerüst aus Vorlage, während der Sitzung ausfüllen.
2. Rechtschreibung und Grammatik prüfen, Beschlüsse hervorheben.
3. Unterschreiben lassen und ablegen. Beschlüsse ggf. in die Wissensbasis (grün) übernehmen.`,
    steps: [
      ['Fristen berechnen', '', false, null, 'einladungsfrist'],
      ['Einladung als Entwurf', '', false, 'T-EINLADUNG-MV'],
      ['Einladung verschicken', 'Durch das Amt.', true],
      ['Protokoll-Gerüst erstellen', '', false, 'T-PROTOKOLL'],
      ['Protokoll prüfen, unterschreiben, ablegen', ''],
    ],
  },
  {
    key: 'VOR-9', name: 'Bewirtung und Arbeitseinsätze', scope: 'verein', office_name: 'Veranstaltungen', max_level: 1, data_class: 'gelb', source_ref: '2.3, 2.4, Anh. A',
    summary: 'Einsatzplan mit fairer Verteilung; Ablaufauskunft für Helfer, etwa zur Küchennutzung.',
    guide: `Ziel: Einsätze sind fair verteilt, Helfer wissen ohne Rückfrage, was zu tun ist.

1. Termine und Helferliste zusammenstellen (nur Namen).
2. Rechner „Einsätze fair verteilen“ nutzen; bisherige Einsätze angeben.
3. Helferaufruf als Entwurf erzeugen, Plan einfügen, verschicken.
4. Ablauf (Küche, Kasse, Aufräumen) als Dokument in der Wissensbasis pflegen, damit die Auskunft ihn findet.`,
    steps: [
      ['Termine und Helfer sammeln', 'Nur Namen.'],
      ['Einsatzplan fair verteilen', '', false, null, 'faire_verteilung'],
      ['Helferaufruf als Entwurf', '', false, 'T-HELFER'],
      ['Nachbereitung: Einsätze zählen', 'Für die nächste faire Verteilung kommentieren.'],
    ],
  },
  {
    key: 'VOR-10', name: 'Budgetplan', scope: 'verein', office_name: 'Kasse, Vorsitz', max_level: 1, never_execute: 1, data_class: 'gelb', baseline_minutes: 240, source_ref: '2.7',
    summary: 'Quartalsweise Aktualisierung vorbereiten (heute rund 4 Stunden); Abgleich mit der Reserve von 20.000 €. Nur lesend und vorbereitend.',
    guide: `Ziel: Der Budgetplan ist quartalsweise aktuell und die Reserve im Blick.

1. Summen aus der Buchhaltung übernehmen (nur Gesamtsummen, keine Kontodaten).
2. Geplante Einnahmen und Ausgaben bis Jahresende schätzen.
3. Rechner „Budget gegen Reserve prüfen“ nutzen.
4. Ergebnis im Vorstand vorstellen. Die App bucht oder überweist nichts.`,
    steps: [
      ['Summen zusammenstellen', 'Nur Summen, keine Kontodaten.', true],
      ['Planwerte aktualisieren', ''],
      ['Reserve prüfen', '', false, null, 'budget_reserve'],
      ['Im Vorstand vorstellen', '', true],
    ],
  },
  {
    key: 'VOR-11', name: 'Regel- und Ablaufauskunft', scope: 'beide', office_name: 'Vorsitz, Bezirksvorsitz', max_level: 0, data_class: 'gruen', source_ref: '2.3, 9.5, Anh. A',
    summary: 'Auskunftsassistent je Bereich, der auf das zugrunde liegende Dokument verweist. Nur mit Fundstelle.',
    guide: `Ziel: Fragen zu Satzung, Ordnungen und Abläufen werden mit Fundstelle beantwortet.

1. Frage im Bereich „Auskunft“ stellen.
2. Treffer mit Fundstelle prüfen; ohne Fundstelle gilt die Auskunft als ungeprüft.
3. Fehlt etwas: Dokument (Satzung, Ordnung, Beschluss) als Admin in die Wissensbasis aufnehmen.
4. Bei Widersprüchen gilt: Satzung vor Ordnungen vor Vorstandsbeschluss vor Formularen vor Website.`,
    steps: [
      ['Frage stellen', 'Bereich „Auskunft“.'],
      ['Fundstelle prüfen', 'Ohne Fundstelle: ungeprüft.'],
      ['Antwort weitergeben', ''],
    ],
  },
  {
    key: 'VOR-12', name: 'Schiedsrichtereinteilung und Schiedsrichtertreffen', scope: 'bezirk', office_name: 'Schiedsrichterwart', max_level: 1, data_class: 'gelb', source_ref: '1.5, 11.4, Anh. A',
    summary: 'Einteilungsvorschlag aus Verfügbarkeiten; jährliches Treffen als wiederkehrende Aufgabe.',
    guide: `Ziel: Eine faire Einteilung ist schnell erstellt, das jährliche Treffen findet statt.

1. Verfügbarkeiten einsammeln (Kommentare oder Datei).
2. Rechner „Einsätze fair verteilen“: Termine, Schiedsrichter (mit bisherigen Einsätzen), Abwesenheiten.
3. Vorschlag prüfen und von Hand anpassen, verschicken.
4. Schiedsrichtertreffen jährlich aus dem Jahreskalender planen.`,
    steps: [
      ['Verfügbarkeiten einsammeln', ''],
      ['Einteilungsvorschlag erstellen', '', false, null, 'faire_verteilung'],
      ['Einteilung prüfen und verschicken', '', true],
    ],
  },
  {
    key: 'VOR-13', name: 'Termin- und Turnierankündigungen, Bezirkswebsite', scope: 'bezirk', office_name: 'Pressewart, Bezirkssportwart', max_level: 1, data_class: 'gruen', source_ref: '1.5, Anh. A',
    summary: 'Texte für Ankündigungen und die Bezirkswebsite als Entwurf.',
    guide: `1. Eckdaten sammeln (Termin, Ort, Konkurrenzen, Meldeschluss, Ausschreibung).
2. Entwurf aus der Vorlage erzeugen.
3. Auf der Bezirkswebsite von Hand veröffentlichen.`,
    steps: [
      ['Eckdaten sammeln', ''],
      ['Ankündigung als Entwurf', '', false, 'T-TURNIER'],
      ['Veröffentlichen', 'Von Hand.', true],
    ],
  },
  {
    key: 'VOR-14', name: 'Jugend: Elterninformationen, Fahrdienst, Lehrgangshinweise', scope: 'verein', office_name: 'Jugendwart', max_level: 1, data_class: 'gelb', minors: 1, source_ref: 'Anh. A, 4.8',
    summary: 'Informationen und Pläne als Entwurf. Daten Minderjähriger: besonders sparsam.',
    guide: `Ziel: Eltern sind rechtzeitig informiert, der Fahrdienst steht.

1. Anlass und Termin erfassen.
2. Fahrdienst mit dem Rechner „Einsätze fair verteilen“ planen (nur Namen der Eltern).
3. Elterninfo als Entwurf, nur Vornamen der Kinder verwenden.
4. Verschicken durch das Amt; Empfängerliste bestätigen.

Daten Minderjähriger sind gelb: nur im einzelnen Vorgang, nie in die Wissensbasis.`,
    steps: [
      ['Anlass und Termin erfassen', ''],
      ['Fahrdienst planen', '', false, null, 'faire_verteilung'],
      ['Elterninfo als Entwurf', '', false, 'T-ELTERN'],
      ['Verschicken', '', true],
    ],
  },
  {
    key: 'VOR-15', name: 'Handbuch je Amt', scope: 'beide', office_name: '', max_level: 1, data_class: 'gruen', source_ref: '2.4, Anh. A',
    summary: 'Aus den Vorgangsvorlagen entsteht die Übergabedokumentation.',
    guide: `Ziel: Eine zweite Person kann das Amt anhand des Handbuchs übernehmen (ABN-1).

1. Im Bereich „Handbuch“ den Bereich und das Amt wählen.
2. Prüfen: Hat jeder Vorgang eine Anleitung? Sind Stolpersteine im Lernprotokoll?
3. Lücken in den Vorgangsvorlagen schließen (Admin).
4. Handbuch drucken oder als PDF speichern und an die Vertretung geben.`,
    steps: [
      ['Handbuch öffnen und prüfen', 'Bereich „Handbuch“.'],
      ['Lücken in den Vorlagen schließen', ''],
      ['An die Vertretung übergeben', ''],
    ],
  },
];

// ---------- Jahreskalender (AUF-4) – Daten sind Annahmen ----------
// [Titel, Rhythmus, Monat, Tag, Vorlauf, Amt, Vorlage-Key, Beschreibung]
const VEREIN_CALENDAR = [
  ['Jahresabschluss', 'jaehrlich', 1, 31, 21, 'Kasse', null, 'Kassenabschluss des Vorjahres erstellen und Kassenprüfung vorbereiten.'],
  ['Beitragsstufen prüfen', 'jaehrlich', 1, 15, 14, 'Mitgliederverwaltung', 'VOR-2', 'Wer wechselt in diesem Jahr die Beitragsstufe (z. B. mit 18)?'],
  ['Beitragseinzug vorbereiten', 'jaehrlich', 2, 15, 21, 'Kasse', null, 'Einzug in meinVerein vorbereiten und auslösen – von Hand, die App löst keine Lastschrift aus.'],
  ['Mitgliederversammlung', 'jaehrlich', 3, 20, 42, 'Vorsitz', 'VOR-8', 'Einladung mit Frist aus der Satzung, Tagesordnung, Protokoll.'],
  ['Budgetplan aktualisieren', 'quartalsweise', 1, 10, 14, 'Kasse', 'VOR-10', 'Quartalsweise Aktualisierung und Abgleich mit der Reserve.'],
  ['Mannschaftsmeldung Vorrunde', 'jaehrlich', 6, 1, 28, 'Sportwart', 'VOR-4', 'Meldefrist laut Bezirk prüfen.'],
  ['Saisonstart vorbereiten', 'jaehrlich', 8, 15, 21, 'Sportwart', null, 'Spielpläne prüfen, Hallenzeiten, Schiedsrichtereinsätze, Trikots.'],
  ['Sponsorentreffen', 'jaehrlich', 10, 15, 42, 'Sponsoring', 'VOR-6', 'Jährliches Treffen mit Sponsoren und Paten.'],
  ['Mannschaftsmeldung Rückrunde', 'jaehrlich', 12, 1, 21, 'Sportwart', 'VOR-4', 'Änderungen zur Rückrunde melden.'],
];
const BEZIRK_CALENDAR = [
  ['Bezirkstag', 'jaehrlich', 6, 20, 56, 'Bezirksvorsitz', 'VOR-8', 'Einladung, Berichte der Ressorts, Protokoll.'],
  ['Schiedsrichtertreffen', 'jaehrlich', 8, 30, 42, 'Schiedsrichterwart', 'VOR-12', 'Jährliches Treffen der Schiedsrichter.'],
  ['Bezirksmeisterschaften ankündigen', 'jaehrlich', 9, 15, 28, 'Pressewart', 'VOR-13', 'Ausschreibung und Ankündigung auf der Bezirkswebsite.'],
  ['Schiedsrichtereinteilung Rückrunde', 'jaehrlich', 12, 10, 21, 'Schiedsrichterwart', 'VOR-12', 'Einteilungsvorschlag aus Verfügbarkeiten.'],
  ['Schiedsrichtereinteilung Vorrunde', 'jaehrlich', 8, 10, 21, 'Schiedsrichterwart', 'VOR-12', 'Einteilungsvorschlag aus Verfügbarkeiten.'],
];

// ---------- Systemlandkarte (DAT-7) ----------
const SYSTEMS = [
  ['meinVerein', 'Mitgliederverwaltung, Beiträge', 'Mitgliederdaten (TTSF Hohberg, wahrscheinlich Bühlertal)', 'Nur lesend über Excel-Export, den ein Mensch bereitstellt', 'Export in meinVerein → Excel', 'Eigenes Lesekonto mit minimaler Rolle (DAT-4) – noch einzurichten', 'Keine öffentliche Schnittstelle gefunden.'],
  ['click-TT / nuLiga', 'Spielbetrieb: Meldungen, Spielpläne, Ergebnisse', 'Spielbetrieb (öffentlich)', 'Lesend; keine Änderungen im Verbandssystem', 'Öffentliche Seiten', '—', 'Meldungen und Verlegungen trägt ein Mensch ein.'],
  ['myTischtennis', 'Spielerprofile, Q-TTR', 'Namen, Ergebnisse (öffentlich)', 'Lesend', 'Öffentliche Seiten', '—', 'Namen gelten als unkritisch.'],
  ['Microsoft 365 für Vereine', 'Ablage, Dokumente, Postfächer', 'Dokumente', 'Anbindung für Ablage und Dokumente (geplant)', 'OneDrive/SharePoint', 'Funktionskonto statt privatem Konto (DAT-6)', ''],
  ['E-Mail-Postfächer', 'Wichtigster Eingangskanal', '—', 'Lesen, Entwürfe ablegen (geplant); heute: .eml hochladen oder einfügen', '.eml speichern', 'Funktionspostfach', 'Versand löst immer ein Mensch aus.'],
  ['Kalender', 'Termine und Fristen', '—', 'Abo-Link (ICS) aus der App; Einträge nur nach Freigabe', 'ICS-Abo', '—', ''],
  ['WhatsApp-Gruppen', 'Anfragen und Bilder', '—', 'Manuelle Erfassung im Eingang', '—', '—', 'Keine Schnittstelle.'],
  ['Websites', 'Veröffentlichung', 'Öffentliche Inhalte', 'Entwürfe für Beiträge', '—', '—', ''],
  ['Post', 'Eingangskanal', '—', 'Manuelle Erfassung im Eingang', 'Scan in die Ablage', '—', ''],
];

// ---------- Hilfe und FAQ (NFA-7) ----------
const FAQ = [
  ['Erste Schritte', 'Wie lege ich eine Aufgabe an?', 'Oben rechts „Neue Aufgabe“ oder Taste N. Wähle Bereich, optional Amt und Vorgangsvorlage. Mit Vorlage werden die Teilschritte automatisch übernommen.'],
  ['Erste Schritte', 'Was bedeutet „Wartet auf Zulieferung“?', 'Die Aufgabe hängt an jemand anderem. Trage ein, wer was schuldet. Die App erinnert nach der eingestellten Zahl an Tagen ohne Bewegung ans Nachfassen.'],
  ['Erste Schritte', 'Wie setze ich einen unterbrochenen Vorgang fort?', 'Öffne die Aufgabe: Die Teilschritte zeigen den erreichten Stand, Notizen und wer was wann erledigt hat. Der Verlauf unten zeigt jeden Schritt.'],
  ['Automatisierung', 'Was darf die App selbst tun?', 'Nur, was die Stufe des Vorgangs erlaubt (0 Auskunft bis 4 selbstständig nach Plan). Alles, was die App verlässt, braucht vor jeder Ausführung das Ja eines Admins. Zahlungen, Lastschriften, Bankvorgänge und Bestellungen sind technisch gesperrt.'],
  ['Automatisierung', 'Verschickt die App Mails?', 'Nein. Mails entstehen nur als Entwurf. Du übernimmst den Entwurf und verschickst ihn selbst, z. B. über „Im Mailprogramm öffnen“.'],
  ['Automatisierung', 'Warum laufen manche Regeln nicht?', 'Regeln laufen nur nach Freigabe durch einen Admin. Vorgänge mit gelben Daten laufen nicht automatisch, solange die Datenschutzfrage nicht geklärt ist (Einstellungen).'],
  ['Daten', 'Was bedeutet die Datenampel?', 'Rot (Gesundheitsangaben, Zugangsdaten): nimmt die App nicht an. Gelb (Stammdaten, Bankdaten, Daten Minderjähriger): nur im einzelnen Vorgang. Grün (Satzung, Ordnungen, Vorlagen, öffentliche Spielpläne): dauerhaft.'],
  ['Daten', 'Wie benenne ich Dateien?', 'Einheitlich: „JJJJ-MM-TT - Aussteller - Anlass“. Die App schlägt den Namen beim Hochladen vor.'],
  ['Auskunft', 'Woher kommen die Antworten in der Auskunft?', 'Ausschließlich aus den hinterlegten Dokumenten. Jede Antwort nennt ihre Fundstelle. Fehlt sie, ist die Auskunft als ungeprüft markiert.'],
  ['Zugang', 'Ich habe mein Handy verloren. Was tun?', 'Ein Admin beendet im Adminpanel sofort alle Sitzungen deines Kontos. Selbst kannst du unter „Mein Konto“ alle anderen Sitzungen beenden und das Passwort ändern.'],
  ['Zugang', 'Wie abonniere ich den Kalender?', 'Unter „Mein Konto“ findest du deinen persönlichen Abo-Link (ICS). In Outlook, Google oder Apple-Kalender als Internetkalender hinzufügen.'],
];

// ---------- Wissensbasis-Grundstock: Spielregeln der App (aus dem Lastenheft, grün) ----------
const APP_RULES_DOC = `§ 1 Zweck der App
Die Web App bündelt alle Ehrenamtsaufgaben aus Verein und Bezirk an einer Stelle, macht sie bearbeitbar und nimmt wiederkehrende Kleinvorgänge per Automatisierung ab. Sie liefert Entwürfe, Prüfungen und Übersichten. Entscheidungen, Unterschriften und Zahlungen bleiben beim Amt.

§ 2 Was die App nicht tut
Zahlungen, Lastschriften und alles mit Banken sind ausgeschlossen. Bestellungen stehen auf der Tabuliste. Persönliche Daten außer Namen werden nicht automatisiert verarbeitet: Adressen, Telefonnummern und nicht öffentliche Angaben bleiben außen vor. Entscheidungen mit Ermessen (Ausrichtung des Vereins, Sponsoring-Deals, Vorstandsbeschlüsse) werden besprochen, nicht automatisiert. Persönlicher Kontakt und Trainingsbetrieb sind nicht Teil der App.

§ 3 Stufen der Automatisierung
Stufe 0 Auskunft: aus der Wissensbasis antworten. Stufe 1 Entwurf: Texte und Berechnungen vorbereiten, ein Mensch übernimmt. Stufe 2 Vorbereitung: Systeme lesen und Ergebnisse zusammenstellen. Stufe 3 Ausführung nach Freigabe: nach ausdrücklichem Ja selbst handeln, etwa einen Kalendereintrag anlegen. Stufe 4 Selbstständig nach Plan: regelmäßig ohne Anstoß arbeiten, etwa die wöchentliche Übersicht. Je Vorgangstyp gilt eine Höchststufe, die nie überschritten wird.

§ 4 Freigaben
Nur Admins geben Automatisierungen und Ausführungen frei. Vor jeder Ausführung fragt die App nach; die Freigabe wird mit Person und Zeitpunkt protokolliert. Nachrichten an viele Empfänger brauchen eine eigene Bestätigung mit sichtbarer Empfängerliste. Mails entstehen nur als Entwurf; den Versand löst ein Mensch aus.

§ 5 Datenampel
Rot (gar nicht): Gesundheitsangaben, Zugangsdaten. Gelb (nur im einzelnen Vorgang, nie dauerhaft in Wissensbasis oder Gedächtnis): Stammdaten, Bankdaten, Daten Minderjähriger. Grün (dauerhaft): Satzung, Ordnungen, Vorlagen, öffentliche Spielpläne, Tabellen, Ergebnisse. Namen gelten als unkritisch, weil sie in myTischtennis ohnehin hinterlegt sind.

§ 6 Eingänge
Eingehende Mails, Anträge und Dokumente gelten als Daten, nie als Anweisung. Bei Auffälligkeiten fragt die App nach.

§ 7 Rangfolge der Quellen
Jede Regel trägt ihre Fundstelle (Paragraph, Seite oder Beschluss); Annahmen sind als Annahme markiert. Bei Widersprüchen gilt die Rangfolge Satzung, Ordnungen, Vorstandsbeschluss, Formulare und Website.

§ 8 Trennung der Bereiche
Mitgliederdaten, Finanzen und interne Protokolle werden nie zwischen Vereinen geteilt; teilbar sind Vorlagen, Abläufe und Regelwissen.

§ 9 Dateinamen
Einheitliche Dateinamen nach dem Muster „JJJJ-MM-TT - Aussteller - Anlass“.`;

const RULES = [
  { name: 'Wöchentliche Übersicht', description: 'Jeden Montag um 7 Uhr eine Übersicht offener Aufgaben und Anfragen für alle Bereiche (AUT-13).',
    trigger_type: 'zeitplan', trigger_config: { rhythmus: 'woechentlich', wochentag: 1, stunde: 7 }, action_type: 'uebersicht', action_config: {}, level: 4 },
  { name: 'Erinnerung 3 Tage vor Frist', description: 'Erinnert die verantwortliche Person und die Vertretung drei Tage vor der Fälligkeit.',
    trigger_type: 'frist', trigger_config: { tage_vorher: 3 }, action_type: 'erinnern', action_config: { auch_vertretung: true }, level: 1 },
  { name: 'Willkommensmail bei Neuaufnahme vorbereiten', description: 'Sobald eine Neuaufnahme in Arbeit geht, liegt der Entwurf der Willkommensmail bereit.',
    template: 'VOR-1', trigger_type: 'statuswechsel', trigger_config: { zu: 'in_arbeit' }, action_type: 'entwurf_erzeugen', action_config: { text: 'T-WILLKOMMEN' }, level: 1 },
];

export function seedBase() {
  if (q.get('SELECT 1 FROM areas LIMIT 1')) return false;
  tx(() => {
    const now = nowIso();
    const areaIds = {};
    for (const a of AREAS) areaIds[a.key] = Number(q.run('INSERT INTO areas (key, name, type, color) VALUES (?, ?, ?, ?)', a.key, a.name, a.type, a.color).lastInsertRowid);
    const officeIds = {};
    for (const a of AREAS) {
      for (const o of a.type === 'verein' ? VEREIN_OFFICES : BEZIRK_OFFICES) {
        officeIds[`${a.key}|${o}`] = Number(q.run('INSERT INTO offices (area_id, name) VALUES (?, ?)', areaIds[a.key], o).lastInsertRowid);
      }
    }
    const textIds = {};
    for (const t of TEXTS) {
      textIds[t.key] = Number(q.run('INSERT INTO text_templates (key, name, category, kind, subject, body, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        t.key, t.name, t.category, t.kind, t.subject, t.body, t.notes || '', now).lastInsertRowid);
    }
    const procIds = {};
    for (const p of PROCESSES) {
      const id = Number(q.run(`INSERT INTO process_templates (key, name, scope, office_name, summary, guide, max_level, never_execute, data_class, minors, baseline_minutes, source_ref, updated_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        p.key, p.name, p.scope, p.office_name, p.summary, p.guide, p.max_level, p.never_execute || 0, p.data_class, p.minors || 0, p.baseline_minutes ?? null, p.source_ref, now).lastInsertRowid);
      procIds[p.key] = id;
      p.steps.forEach(([title, desc, manual, textKey, calc], i) => q.run(
        'INSERT INTO process_steps (template_id, pos, title, description, manual, text_template_id, calc) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, i + 1, title, desc || '', manual ? 1 : 0, textKey ? textIds[textKey] : null, calc || null));
    }
    const addCal = (areaKey, rows) => rows.forEach(([title, freq, month, day, lead, office, tpl, desc]) => q.run(
      'INSERT INTO recurring (area_id, office_id, template_id, title, description, freq, month, day, lead_days, assumption) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
      areaIds[areaKey], officeIds[`${areaKey}|${office}`] ?? null, tpl ? procIds[tpl] : null, title, desc, freq, month, day, lead));
    addCal('ttsf-hohberg', VEREIN_CALENDAR);
    addCal('buehlertal', VEREIN_CALENDAR);
    addCal('bezirk-mittelbaden', BEZIRK_CALENDAR);
    SYSTEMS.forEach((s, i) => q.run('INSERT INTO systems (name, purpose, leading_data, access, export_path, account, notes, pos) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ...s, i + 1));
    FAQ.forEach(([c, qq, a], i) => q.run('INSERT INTO faq (category, question, answer, pos, updated_at) VALUES (?, ?, ?, ?, ?)', c, qq, a, i, now));
    const docId = Number(q.run(`INSERT INTO kb_documents (area_id, title, source_type, valid_from, notes, created_at, updated_at) VALUES (NULL, ?, 'sonstiges', ?, ?, ?, ?)`,
      'Spielregeln der App (Lastenheft)', '2026-11-12', 'Aus dem Lastenheft, Entscheidungen vom 12.11.2026. Satzungen und Ordnungen der Vereine bitte als eigene Dokumente aufnehmen.', now, now).lastInsertRowid);
    splitSections(APP_RULES_DOC).forEach(s => q.run('INSERT INTO kb_sections (document_id, pos, reference, heading, body) VALUES (?, ?, ?, ?, ?)', docId, s.pos, `Lastenheft ${s.reference}`, s.heading, s.body));
    for (const r of RULES) {
      const ac = { ...r.action_config };
      if (ac.text) { ac.text_template_id = textIds[ac.text]; delete ac.text; }
      q.run(`INSERT INTO rules (name, description, template_id, trigger_type, trigger_config, action_type, action_config, level, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        r.name, r.description, r.template ? procIds[r.template] : null, r.trigger_type, JSON.stringify(r.trigger_config), r.action_type, JSON.stringify(ac), r.level, now, now);
    }
    q.run('INSERT INTO changelog (entity, title, note, created_at) VALUES (?, ?, ?, ?)', 'system', 'App eingerichtet',
      '15 Vorgangsvorlagen, 15 Textvorlagen, Jahreskalender (Daten sind Annahmen, bitte prüfen), drei Beispielregeln (warten auf Freigabe).', now);
    q.run(`INSERT INTO audit_log (at, user_name, entity, action, summary) VALUES (?, 'System', 'system', 'einrichtung', 'Grunddaten angelegt')`, now);
  });
  return true;
}

// ---------- Ergänzungen für bestehende Installationen ----------
// Läuft bei jedem Start; legt nur an, was anhand des Schlüssels noch fehlt. Bestehendes bleibt unverändert.

const UPGRADE_TEXTS = [
  {
    key: 'T-HEIMSPIEL', name: 'Heimspieltag: Aufruf Hallen- und Küchendienst', category: 'Veranstaltungen', kind: 'mail',
    subject: 'Heimspieltag am {{spieltag}}: Hallen- und Küchendienst',
    body: `Hallo zusammen,

am {{spieltag}} haben wir Heimspiel: {{begegnung}} ({{uhrzeit}} Uhr, {{halle}}).

Hallendienst (Aufbau ab {{aufbau|eine Stunde vorher}}): {{hallendienst}}
Küche/Bewirtung: {{kuechendienst}}
Schiedsrichter: {{schiedsrichter|laut Einteilung}}

Wer verhindert ist, bitte bis {{rueckmeldung_bis}} Bescheid geben und Ersatz suchen.

Danke euch!
{{absender}}`,
  },
];

const UPGRADE_PROCESSES = [
  {
    key: 'VOR-16', name: 'Heimspieltag organisieren', scope: 'verein', office_name: 'Sportwart, Veranstaltungen', max_level: 1, data_class: 'gruen', source_ref: 'VOR-9, 5.1',
    summary: 'Hallendienst, Bewirtung, Schiedsrichter und Spielbericht für ein Heimspiel – entsteht automatisch aus dem Spielplan-Abo.',
    guide: `Ziel: Am Heimspieltag ist Halle, Küche und Schiedsrichter geklärt, danach erscheint der Spielbericht.

1. Termin und Gegner prüfen (stammt aus dem Spielplan; Verlegungen zieht die App automatisch nach).
2. Hallen- und Küchendienst fair verteilen (Rechner „Einsätze fair verteilen“).
3. Aufruf als Entwurf erzeugen und verschicken.
4. Schiedsrichter klären (bei Bedarf Vorgang VOR-3 starten).
5. Nach dem Spiel: Ergebnis und Bilder sammeln, Spielbericht (VOR-7).

Stolpersteine: Hallenschlüssel rechtzeitig organisieren; bei Doppelspieltagen zweite Küchenschicht.`,
    steps: [
      ['Termin und Gegner prüfen', 'Kommt aus dem Spielplan-Abo.'],
      ['Hallen- und Küchendienst verteilen', '', false, null, 'faire_verteilung'],
      ['Aufruf an die Helfer', '', false, 'T-HEIMSPIEL'],
      ['Schiedsrichter klären', 'Bei Ausfall Vorgang VOR-3 starten.'],
      ['Spielbericht anstoßen', 'Ergebnis und Bilder sammeln (VOR-7).', false, 'T-SPIELBERICHT'],
    ],
  },
];

const UPGRADE_FAQ = [
  ['Verbindungen', 'Wie verbinde ich das Vereinspostfach (Microsoft 365)?', 'Ein Admin richtet eine App-Registrierung ein und trägt die Zugangsdaten in die Datei .env auf dem Server ein (Anleitung: docs/MICROSOFT-365.md). Danach im Adminpanel unter „Verbindungen“ die Funktionspostfächer eintragen und testen. Die App liest Mails, legt nach Freigabe Entwürfe und Termine an – verschickt aber nie selbst.'],
  ['Verbindungen', 'Wie kommen die Spielpläne in den Kalender?', 'In click-TT/nuLiga gibt es je Mannschaft einen Kalender-Export (iCal). Die Adresse im Adminpanel unter „Verbindungen → Spielpläne“ eintragen. Mit dem Vereinsnamen als „Heimspiel-Erkennung“ legt die App für Heimspiele automatisch eine Aufgabe an.'],
  ['Automatisierung', 'Wo schalte ich Automatisierungen ein oder aus?', 'Adminpanel → Automatisierungen. Dort steht jede Automatik mit Stufe, Beschreibung und Parametern. Was eine Voraussetzung braucht (z. B. Microsoft 365 oder die geklärte Datenschutzfrage), ist markiert.'],
  ['Automatisierung', 'Wie ordnet die App Antworten zu?', 'Entwürfe, die über das Postfach gehen, tragen die Vorgangsnummer im Betreff, z. B. [#42]. Kommt eine Antwort, hängt die App sie als Kommentar an die Aufgabe, legt Anhänge ab und beendet „Wartet auf Zulieferung“.'],
  ['Verbindungen', 'Wie kommen Mailanhänge automatisch in den richtigen Ordner?', 'Unter Eingang → Regeln eine Ablageregel anlegen: Wenn Absender (Name oder Domain), Betreff, Dateiname oder Dateityp passen, landet der Anhang in Bereich und Ordner – wahlweise ohne Aufgabe, als Aufgabe oder erst beim Übernehmen. Der Probelauf zeigt vorher, was passieren würde. Auffällige Mails werden nie automatisch einsortiert.'],
  ['Daten', 'Jemand fragt, welche Daten wir über ihn haben. Was tun?', 'Adminpanel → Datenschutz: Namen eingeben. Die App listet alle Fundstellen (Aufgaben, Kommentare, Eingang, Dateien, Sponsoren, Protokoll) und exportiert sie als CSV.'],
];

export function seedUpgrades() {
  tx(() => {
    const now = nowIso();
    const textId = (key) => q.get('SELECT id FROM text_templates WHERE key = ?', key)?.id ?? null;
    const added = [];
    for (const t of UPGRADE_TEXTS) {
      if (textId(t.key)) continue;
      q.run('INSERT INTO text_templates (key, name, category, kind, subject, body, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', t.key, t.name, t.category, t.kind, t.subject, t.body, t.notes || '', now);
      added.push(`Textvorlage „${t.name}“`);
    }
    for (const p of UPGRADE_PROCESSES) {
      if (q.get('SELECT 1 FROM process_templates WHERE key = ?', p.key)) continue;
      const id = Number(q.run(`INSERT INTO process_templates (key, name, scope, office_name, summary, guide, max_level, never_execute, data_class, minors, baseline_minutes, source_ref, updated_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?)`,
        p.key, p.name, p.scope, p.office_name, p.summary, p.guide, p.max_level, p.data_class, p.baseline_minutes ?? null, p.source_ref, now).lastInsertRowid);
      p.steps.forEach(([title, desc, manual, textKey, calc], i) => q.run(
        'INSERT INTO process_steps (template_id, pos, title, description, manual, text_template_id, calc) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, i + 1, title, desc || '', manual ? 1 : 0, textKey ? textId(textKey) : null, calc || null));
      added.push(`Vorgang „${p.key} ${p.name}“`);
    }
    for (const [c, qq, a] of UPGRADE_FAQ) {
      if (q.get('SELECT 1 FROM faq WHERE question = ?', qq)) continue;
      q.run('INSERT INTO faq (category, question, answer, pos, updated_at) VALUES (?, ?, ?, ?, ?)', c, qq, a, 50, now);
    }
    if (added.length) {
      q.run('INSERT INTO changelog (entity, title, note, created_at) VALUES (?, ?, ?, ?)', 'system', 'Neue Vorlagen ergänzt', added.join('\n'), now);
    }
  });
}
