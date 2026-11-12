# KI-Assistent: Automatisierungen mit Claude entwerfen

Unter **Automatisierungen → Mit KI erstellen** beschreiben Admins in eigenen Worten, was die App ihnen abnehmen
soll – oder lassen Claude in den Zahlen der letzten 90 Tage nach lohnenden Abläufen suchen. Claude antwortet mit
Vorschlägen; die App prüft sie, ein Admin übernimmt sie.

## Was Claude darf – und was nicht

| | |
| --- | --- |
| **Rolle** | Berater auf Stufe 1 („Entwurf“). Claude bekommt keine Werkzeuge und kann nichts ausführen. |
| **Vorschlagsarten** | neue Regel (Auslöser → Aktion), fertigen Katalog-Ablauf einschalten, „nicht möglich, weil …“ |
| **Prüfung** | Jeder Vorschlag läuft durch dieselben Prüfungen wie eine von Hand angelegte Regel: Sperrliste (AUT-8), Höchststufe des Vorgangs (AUT-1), Pflichtangaben, existierende Vorlagen. Ungültige Vorschläge lassen sich nicht übernehmen. |
| **Übernahme** | nur durch einen Admin, einzeln per Klick. Neue Regeln sind danach **nicht freigegeben** und laufen erst nach der üblichen Freigabe (ROL-3). |
| **Nachvollziehbarkeit** | Jede Anfrage steht mit Eingabe, Antwort, Prüfergebnis, Tokens und Übernahmen in der App und im Protokoll. |

## Was übertragen wird (DAT-2)

- Die Beschreibung des Admins – vorher automatisch bereinigt (Adressen, Telefonnummern, Mailadressen, Bankdaten werden entfernt).
- Die Bausteine der App: Auslöser, Aktionen, Stufen, Automatisierungskatalog, Namen von Bereichen, Ämtern, Vorgangs- und Textvorlagen, bestehende Regeln.
- Nur bei „Ideen finden“: Zählwerte der letzten 90 Tage (Aufgaben je Vorgang, Minuten, Eingangskanäle, Überfällige) und bis zu 60 **Titel von Aufgaben mit grüner Datenklasse** ohne Vorlage.
- **Nie:** gelbe Aufgaben, Beschreibungen, Kommentare, Eingänge, Dateien, Mitglieder- oder Bankdaten.

In der Oberfläche zeigt „Was wird an Claude übertragen?“ den genauen Inhalt.

## Einrichtung

1. Auf dem Server im App-Ordner einmal `npm install` ausführen (installiert das offizielle Paket `@anthropic-ai/sdk`).
2. Unter https://platform.claude.com eine Organisation für den Verein anlegen, **ein monatliches Ausgabenlimit setzen**
   und einen API-Schlüssel erzeugen.
3. Den Schlüssel in die `.env` eintragen (`ANTHROPIC_API_KEY=…`, Vorlage `.env.beispiel`), Server neu starten.
4. Adminpanel → Automatisierungen → „Automatisierungen mit KI entwerfen“ einschalten.

## Kosten

Standardmodell ist Claude Opus 5.5 (4 $ je Million Eingabe-Tokens, 20 $ je Million Ausgabe-Tokens). Eine Anfrage
braucht typischerweise 4.000–8.000 Eingabe- und 1.000–2.000 Ausgabe-Tokens, also **etwa 3–6 Cent**. Die App zeigt die
Kosten je Anfrage und die Summe der letzten 30 Tage. Mit `CLAUDE_MODEL=claude-sonnet-5-5` in der `.env` wird es etwa
halb so teuer, die Vorschläge können dann etwas einfacher ausfallen.

## Technik

- `server/connectors/claude.js` – Aufruf über das SDK mit strukturierter Ausgabe (JSON-Schema) und automatischem
  Ausweichen auf ein anderes Modell, falls eine Anfrage aus Sicherheitsgründen abgelehnt wird.
- `server/services/ki.js` – Kontext (nur grüne Daten), Antwortformat, Prüfung, Übernahme.
- `test/ki.test.js` – Tests gegen einen simulierten Claude-Server: Prüfung der Vorschläge, kein Versand von
  Telefonnummern und gelben Aufgaben, Ablehnungen, Rechte.

## Offen

- **Datenschutz:** Auch wenn nur grüne Daten übertragen werden, sollte die Nutzung (Anbieter in den USA,
  Auftragsverarbeitung) mit der Datenschutzanfrage an Verband/Sportbund abgestimmt werden – deshalb ist der
  Assistent standardmäßig ausgeschaltet.
- **Weitere KI-Einsätze** (Entwürfe formulieren, Mails zusammenfassen, Auskunft in ganzen Sätzen) sind in
  docs/IDEEN.md beschrieben; sie würden denselben Anschluss nutzen.
