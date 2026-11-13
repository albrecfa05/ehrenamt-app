# Vorstandsarbeit-Simulator

Eine **virtuelle Vereinswelt** und daneben eine **leere Ehrenamt-App**. Der TTV Musterhausen gibt es
seit 1962 – mit Ordnern, Asana, Mails und WhatsApp. Du bist die Vorsitzende Mia Muster und führst die
App neu ein: erst einrichten (Kapitel 1), dann den Vereinsalltag damit bewältigen (Kapitel 2).
Alles ist erfunden; nichts verlässt den Rechner.

```bash
npm run simulator                 # Vereinswelt http://localhost:3002, App http://localhost:3004
npm run simulator -- --neu        # alles von vorn
npm run simulator -- --echte-ki   # echten Claude statt Nachbau (ANTHROPIC_API_KEY aus der .env)
```

(In PowerShell ggf. `npm.cmd run simulator`.) Alle Daten liegen in `data-simulator/` – `app/` für die App,
`welt/` für die Vereinswelt. Die echten Daten in `data/` bleiben unberührt.

## Die Vereinswelt (eigene Seite, Port 3002)

| Bereich | Was es dort gibt | Wie es in die App kommt |
| --- | --- | --- |
| **Start und Geschichte** | Deine Rolle, Fortschritt, Kapitel 1 und 2, Protokoll | – |
| **Postfächer** | Vorstand TTV, SV Beispieldorf, Bezirk – mit alten Mails, Posteingang, Entwürfe, Gesendet | Postfach in der App verbinden (sie ruft selbst ab) oder Mail als `.eml` herunterladen und im Eingang einlesen |
| **Briefkasten** | Papierpost, z. B. der **ausgefüllte Mitgliedsantrag als PDF** | „Scannen und ans Vorstandspostfach“ oder PDF herunterladen → App „Eingang erfassen“ mit Anhang |
| **WhatsApp** | Gruppen Vorstand, Helfer & Fest, Eltern Jugend | Text kopieren / Fotos herunterladen → App „Eingang erfassen“ |
| **Vereinsordner** | Satzung, Beitragsordnung, Ämterliste, Jahresplan, Sponsorenübersicht, Asana-Export, meinVerein-Export, MV-Protokoll, Hallenplan | Für die Einrichtung: Text kopieren, CSV importieren, Werte übernehmen |
| **click-TT** | Spielpläne von Herren I, Herren II, Jugend U15 mit ICS-Adresse | ICS-Adresse in der App als Spielplan-Abo eintragen |
| **Microsoft 365** | Was in der App einzutragen ist; was die App im Tenant getan hat (Entwürfe, Termine, SharePoint, KI) | Zugangsdaten sind im Simulator schon gesetzt, nur Postfächer eintragen |

Entwürfe, die die App ins Postfach legt, erscheinen im Ordner „Entwürfe“ und lassen sich dort mit
Empfänger verschicken – wie in Outlook. Auf manche Mails reagiert die Welt (z. B. genehmigt die
Staffelleitung eine Spielverlegung).

## Kapitel 1: Die App einrichten

Geprüft wird jeweils gegen die Unterlagen des Vereins: Bereiche richtig benannt, Konten für den Vorstand,
Ämter und Vertretungen laut Ämterliste, Fristen laut Satzung (21 Tage Einladung), Beiträge laut
Beitragsordnung (48 €/96 € – die Voreinstellung der App passt bewusst nicht), Satzung in der
Wissensbasis, Datenschutz-Schalter entschieden, Postfach verbunden, Spielplan abonniert, Asana
übernommen, Jahreskalender abgeglichen, Sponsoren erfasst, Automatik-Voreinstellung, Abschluss.

## Kapitel 2: Vereinsalltag

Mit **Saisonverlauf** treten die Ereignisse an ihrem Tag von selbst ein; jedes lässt sich auch sofort auslösen.
Jedes prüft selbst am Datenbestand der App, ob es gelöst ist (erfüllte Prüfungen bleiben erfüllt).

| Tag | Ereignis | Kanal |
| --- | --- | --- |
| 1 | Mitgliedsantrag Lea Lustig (12) ohne SEPA-Mandat, Foto-Einwilligung fehlt; Mandat kommt nach 3 Tagen per Mail mit Vorgangsnummer | Briefkasten |
| 3 | Schiedsrichter sagt kurzfristig ab | Postfach Bezirk |
| 4 | Fördermittel: Antragsfrist | Postfach |
| 5 | Neue Bankverbindung per Mail („Chef-Masche“) | Postfach, WhatsApp |
| 6 | Halle gesperrt – Heimspiel verlegen; Staffel genehmigt, Spielplan ändert sich | Postfach, click-TT |
| 7 | Ideen aus der Versammlung entscheiden | Postfach (Asana-Ideen) |
| 8 | Helfermangel am Heimspieltag | WhatsApp, click-TT |
| 9 | Fotos vom Jugendturnier ohne Einwilligung | WhatsApp |
| 10 | Außerordentliche Mitgliederversammlung fristgerecht einladen | Postfach |
| 11 | Jugend: Fahrdienst zur Rangliste | Postfach Bezirk, WhatsApp |
| 12 | Sponsorvertrag läuft aus | Postfach |
| 13 | Auskunftsersuchen nach Art. 15 DSGVO | Postfach |
| 14 | Kündigung kurz vor Jahresende | Postfach |
| 15 | Kassenprüfung: Belege zusammensuchen (Rechnungen über drei Tage) | Postfach |
| 16 | Alles hängt an der Vorsitzenden (Protokoll der Vorstandssitzung) | Postfach, WhatsApp |
| 18 | Beitragsstufen zum Jahreswechsel prüfen (meinVerein-Export) | Postfach, Vereinsordner |
| 20 | Kassenwart hört auf | Postfach |

## Zeitraffer

„+1 Tag“ usw. stellen die zentrale Uhr vor. Je Tag läuft der normale Tageslauf der App (Erinnerungen,
Jahreskalender, Eskalation, Sponsoren, Regeln, Postfach- und Spielplan-Abruf – soweit in der App
eingeschaltet), dann treten fällige Ereignisse ein und die Welt reagiert. Zurückspulen gibt es nicht.

## Quellen für die typischen Probleme

- Deutscher Bundestag, Unterausschuss Bürgerschaftliches Engagement (2024) – https://www.bundestag.de/dokumente/textarchiv/2024/kw24-pa-ua-engagement-1005304
- Sportentwicklungsbericht: sinkende Bereitschaft zum Ehrenamt – https://breitensport.rad-net.de/aktuelles/2017/sportentwicklungsbericht-vorgelegt-«hauptsorge-der-sportvereine-bleibt-die-sinkende-bereitschaft-zum-ehrenamtlichen-engagement».html
- BTTV, „Vereinswissen kompakt“ – https://muehldorf.bttv.de/fileadmin/bttv/media/000/downloads/sonstiges/Handout_2_-_Vereinswissen_kompakt.pdf
- Verbandsbüro: Probleme von Volleyball- und Turnvereinen – https://www.verbandsbuero.de/11-groessten-probleme-fuer-volleyball-vereine/, https://www.verbandsbuero.de/1-groessten-probleme-fuer-turnvereine/
- Kassenbericht und Belege – https://www.whk-controlling.de/wissen/kassenbericht-verein-vorlage
- VIBSS: Kassenprüfung – https://www.vibss.de/vereinsmanagement/recht/vereinsrecht/vereinssatzung/kassenpruefung?type=123
- Rheinpfalz: Schiedsrichtermangel – https://www.rheinpfalz.de/lokal/zweibruecken_artikel,-f%C3%BCnf-neue-schiedsrichter-w%C3%A4ren-schon-eine-riesenerleichterung-_arid,5606593.html

## Aufbau und Erweitern

```
simulator/
  welt/zustand.js    Zustand der Welt (welt.json + Dateien), getrennt von der App-Datenbank
  welt/verein.js     Der Verein: Personen, Satzung, Unterlagen, Spielpläne, alte Mails
  welt/kanaele.js    Postfach, Briefkasten, WhatsApp, Scanner
  welt/dienste.js    Nachbau von Microsoft Graph, click-TT (ICS) und Claude
  welt/geschichte.js Kapitel 1 (Einrichtung) und Kapitel 2 (Ereignisse) mit Prüfungen
  welt/motor.js      Zeitraffer, Saisonverlauf, Reaktionen, Auswertung
  welt/pdf.js        Kleiner PDF-Erzeuger (Formulare, Satzung, Rechnungen)
  welt/server.js     Seite und Schnittstellen der Vereinswelt
  public/            Die Seite der Vereinswelt
scripts/simulator.js Startet Welt und leere App in einem Prozess (gemeinsame Uhr)
```

Die Welt **schreibt nie in die App**; sie liest dort nur, um abzuhaken. Ein neues Ereignis ist ein
Eintrag in `simulator/welt/geschichte.js`: `start()` spielt die Lage über einen Kanal ein, `onDay()` bzw.
`react()` lassen die Welt reagieren, `checks` prüfen am Datenbestand der App. Tests: `test/simulator.test.js`.
