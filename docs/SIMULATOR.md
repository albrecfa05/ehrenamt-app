# Vorstandsarbeit-Simulator

Eine eigene Instanz der App mit einem **erfundenen Verein**, in der man alles ausprobieren kann –
auch das, was man mit echten Mitgliederdaten (noch) nicht einschalten würde. Es gibt nur Fantasiedaten,
deshalb sind dort **beide Datenschutz-Schalter an** und der **Automatisierungskatalog komplett eingeschaltet**.

```bash
npm run simulator                 # http://localhost:3002
npm run simulator -- --neu        # ganz von vorn
npm run simulator -- --echte-ki   # echten Claude statt Nachbau (ANTHROPIC_API_KEY aus der .env)
```

Zugänge: `data-simulator/SIMULATOR-ZUGANG.txt` (ein Passwort für alle Personen). Die echten Daten in `data/` bleiben unberührt.

## Der Demo-Verein

| | |
| --- | --- |
| Bereiche | TTV Musterhausen, SV Beispieldorf (Abt. Tischtennis), Bezirk Musterkreis |
| Personen | Mia Muster (Vorsitz, Admin), Ben Beispiel (Kasse, Admin), Tom Turnier (Bezirkssportwart, Admin), Jana Jugend (Jugendwartin, Zuarbeit), Paul Presse (Öffentlichkeitsarbeit, Zuarbeit) |
| Postfächer | vorstand@ttv-musterhausen.example, tischtennis@sv-beispieldorf.example, bezirk@tt-musterkreis.example |
| Spielpläne | Herren I und Jugend U15, eine Saison ab dem Starttag |
| Wissensbasis | erfundene Satzung (§ 1–11) und Beitragsordnung |
| Sonstiges | Sponsoren, Ablageregeln, laufende Aufgaben, Ideen; Satzungsfrist für Einladungen 21 Tage |

Alle Adressen enden auf `.example` – eine Endung, die es im Internet nicht gibt.

## Nachgebaute Dienste

Der Simulator startet im selben Prozess einen kleinen Server, der sich verhält wie

- **Microsoft Graph** – Postfächer liefern die Mails der Szenarien; Entwürfe, Outlook-Termine und SharePoint-Uploads werden *nicht* ausgeführt, sondern im Bereich „Was die App nach außen getan hätte“ angezeigt;
- **click-TT** – ICS-Spielpläne relativ zum simulierten Datum; Verlegungen ändern den Spielplan;
- **Claude** – feste Beispielvorschläge, damit der KI-Bereich ohne Kosten ausprobiert werden kann.

Auch wenn in der `.env` echte Microsoft-Zugangsdaten stehen: Der Simulator überschreibt sie mit dem Nachbau.

## Zeitraffer

„+1 Tag“, „+3 Tage“, „+1 Woche“ stellen die zentrale Uhr der App vor (auf 7:30 Uhr des nächsten Tages)
und lassen je Tag alles laufen, was auch im echten Betrieb passiert: Tageslauf (Jahreskalender,
Erinnerungen, Eskalation, Sponsoren, Ideen, Löschfristen), Zeitplan- und Fristregeln, Postfach- und
Spielplan-Abruf. Danach reagiert die Welt auf euer Handeln (z. B. die Staffelleitung genehmigt eine
Verlegung, die Familie schickt das SEPA-Mandat). Optional kommt **Alltagsrauschen** dazu: Newsletter,
Spielberichte, Hallenpläne, Anfragen. Zurückspulen gibt es nicht; dafür `--neu`.

## Szenarien

Jedes Szenario spielt eine Ausgangslage ein und **prüft selbst am Datenbestand**, ob das Problem gelöst ist.
Einmal erfüllte Prüfungen bleiben erfüllt. Punkte gibt es nach Schwierigkeit und für schnelles Lösen.

| Szenario | Typisches Problem | Was geprüft wird |
| --- | --- | --- |
| Schiedsrichter sagt kurzfristig ab | Schiedsrichtermangel, späte Absagen | Übernahme, VOR-3, Rundfrage-Entwurf, vor dem Spieltag erledigt |
| Halle gesperrt – Heimspiel verlegen | Hallenzeiten werden gestrichen | Ablageregel legt Hallenplan ab, Verlegungsantrag, neuer Termin kommt über den Spielplan |
| Helfermangel am Heimspieltag | immer weniger Freiwillige für Dienste | Heimspieltag-Aufgabe, Helferaufruf, Absage bearbeitet, rechtzeitig fertig |
| Aufnahmeantrag ohne SEPA-Mandat | unvollständige Anträge, Minderjährige | VOR-1, gelb, „Wartet auf“, Willkommensentwurf per Regel, Antwort zugeordnet |
| Mitgliederversammlung fristgerecht einladen | Formfehler machen Beschlüsse anfechtbar | Rechner Einladungsfrist, Einladungsentwurf, 21 Tage vorher fertig |
| Sponsorvertrag läuft aus | Vertragsende fällt erst bei fehlender Zahlung auf | automatische Aufgabe, Kontakt erfasst, verlängert oder bewusst beendet |
| Neue Bankverbindung per Mail | „Chef-Masche“ gegen Vereinskassen | Mail abgelegt statt übernommen, keine Zahlungsaufgabe |
| Kassenprüfung: Belege zusammensuchen | verstreute, fehlende Belege | neue Ablageregel, drei Rechnungen im Ordner, gelb, rechtzeitig |
| Kassenwart hört auf | Wissensverlust, fehlende Nachfolge | Amt neu besetzt, Vertretung, Aufgaben übergeben, Erfahrung festgehalten |
| Fördermittel: Antragsfrist | Zuschüsse verfallen | Frist vor Antragsschluss, Antragsentwurf, rechtzeitig |
| Fotos vom Jugendturnier per WhatsApp | Bilder Minderjähriger ohne Einwilligung | bearbeitet, nicht grün abgelegt, Einwilligung als Schritt |
| Jugend: Fahrdienst zum Ranglistenturnier | Elterninfos gehen in Chats unter | Elterninfo-Entwurf, Angebot zugeordnet, rechtzeitig |
| Ideen versanden im Ideenspeicher | Vorschläge werden nie entschieden | alle Ideen entschieden |
| Auskunftsersuchen nach Art. 15 DSGVO | Monatsfrist, Daten an vielen Stellen | Frist ≤ 1 Monat, gelb, fristgerecht |
| Alles hängt an der Vorsitzenden | Überlastung weniger Engagierter | Aufgaben verteilt, Vertretungen gesetzt |
| Kündigung kurz vor Jahresende | Streit um Austrittsfristen | VOR-2, Kündigungsrechner, bestätigt |

## Quellen für die typischen Probleme

- Deutscher Bundestag, Unterausschuss Bürgerschaftliches Engagement (2024): Ehrenamt im Sport, Nachwuchs für Vorstandsämter – https://www.bundestag.de/dokumente/textarchiv/2024/kw24-pa-ua-engagement-1005304
- Sportentwicklungsbericht: „Hauptsorge der Sportvereine bleibt die sinkende Bereitschaft zum ehrenamtlichen Engagement“ – https://breitensport.rad-net.de/aktuelles/2017/sportentwicklungsbericht-vorgelegt-«hauptsorge-der-sportvereine-bleibt-die-sinkende-bereitschaft-zum-ehrenamtlichen-engagement».html
- BTTV, Handout „Vereinswissen kompakt“ (Fristen, Satzung, Vorstandsarbeit im Tischtennis) – https://muehldorf.bttv.de/fileadmin/bttv/media/000/downloads/sonstiges/Handout_2_-_Vereinswissen_kompakt.pdf
- Verbandsbüro: die größten Probleme von Volleyball- und Turnvereinen (Hallenzeiten, Helfer, Kommunikation, Verwaltung) – https://www.verbandsbuero.de/11-groessten-probleme-fuer-volleyball-vereine/ und https://www.verbandsbuero.de/1-groessten-probleme-fuer-turnvereine/
- Kassenbericht und Belege im Verein – https://www.whk-controlling.de/wissen/kassenbericht-verein-vorlage
- VIBSS: Kassenprüfung nach Satzung – https://www.vibss.de/vereinsmanagement/recht/vereinsrecht/vereinssatzung/kassenpruefung?type=123
- Rheinpfalz: Schiedsrichtermangel im Amateursport – https://www.rheinpfalz.de/lokal/zweibruecken_artikel,-f%C3%BCnf-neue-schiedsrichter-w%C3%A4ren-schon-eine-riesenerleichterung-_arid,5606593.html

## Erweitern

Ein neues Szenario ist ein Eintrag in `server/sim/scenarios.js`: `start()` spielt die Lage ein,
`onDay()` (optional) lässt die Welt reagieren, `checks` prüfen am Datenbestand. Tests: `test/simulator.test.js`.
