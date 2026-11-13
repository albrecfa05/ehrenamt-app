# Bedienung

Kurzanleitung für alle, die mit der App arbeiten. Die Hilfe in der App (unten links) enthält dieselben Grundsätze.

## Der Tag in der App

1. **Übersicht** öffnen: überfällig, heute fällig, wartet auf Zulieferung, liegt lange, offene Freigaben und Eingänge.
2. **Eingang** einsortieren: Nachrichten aus WhatsApp, Post oder Mail erfassen bzw. als `.eml` einlesen.
   Die App schlägt Bereich, Vorgang und Frist vor. Auffällige Nachrichten (Zahlungsdruck, Passwortfragen,
   neue Bankverbindung) sind markiert und werden nie ausgeführt.
3. **Aufgaben** abarbeiten. Kleinkram am Stück: mehrere auswählen → „Nacheinander abarbeiten“.

## Eine Aufgabe bearbeiten

- **Neue Aufgabe:** Taste `N` oder oben rechts. Mit einer **Vorgangsvorlage** kommen Teilschritte und Anleitung mit.
- **Teilschritte** abhaken. Der nächste offene Schritt ist markiert. Nach einer Unterbrechung sieht man sofort den Stand.
- **Wartet auf Zulieferung:** Immer eintragen, wer was schuldet. Die App erinnert ans Nachfassen.
- **Entwurf aus Vorlage:** Variablen ausfüllen, Empfänger nur mit Namen. Danach „Übernehmen“ (du verschickst selbst)
  oder „Im Mailprogramm öffnen“. Ab 5 Empfängern bestätigst du die Liste ausdrücklich.
- **Rechner:** Fristen, Beitragsstufen, Budget gegen Reserve, faire Einsatzverteilung. Der Rechenweg wird gespeichert.
- **Zeit erfassen:** Minuten inkl. Prüfzeit. Daraus entsteht die Zeitersparnis in den Kennzahlen.
- **Abschließen:** Beim Status „Erledigt“ fragt die App nach Erfahrungen für den nächsten Durchlauf.
- **Lernprotokoll:** Korrekturen oder Entscheidungen, die künftig gelten sollen, über „Ins Lernprotokoll“ festhalten.

## Eingang und Ablage: Regeln

Unter **Eingang → Regeln** (nur Admins) legst du fest, wohin Mailanhänge kommen:

- **Wenn** Absender (Name oder Domain, z. B. `gemeinde-hohberg.de`), Betreff, Dateiname oder Dateityp passen,
- **dann** Bereich, Ordner (z. B. `Sponsoring/Rechnungen`), Datenklasse und Anlass im Dateinamen –
- und mit der Mail: **nur ablegen** (ohne Aufgabe, Mail optional danach erledigt), **Aufgabe anlegen** (mit Vorgang) oder **vormerken** (gilt, wenn jemand die Mail übernimmt).

Die erste passende Regel gewinnt; die Reihenfolge lässt sich mit den Pfeilen ändern. Der **Probelauf** zeigt vorher,
welche Regel bei einer Beispiel-Mail greifen würde. Auffällige Mails (Zahlungsdruck, Passwortfragen, Gesundheitsangaben)
sortiert die App nie automatisch ein, und Mails mit Personendaten bleiben gelb – egal, was die Regel sagt.
Gleiche Dateien werden nicht doppelt abgelegt.

Im Eingang steht bei jedem Anhang, wohin er ginge. Beim **Ablegen ohne Aufgabe** fragt die App, ob die Anhänge in die
Ablage sollen (mit Bereich, Ordner, Datenklasse) – sonst werden sie verworfen.

In der **Ablage** zeigt die Ordnerleiste links alle Themen-Ordner; mehrere Dateien lassen sich auf einmal verschieben.

## Freigaben (nur Admins)

Alles, was die App verlässt, braucht vor jeder Ausführung dein Ja: unter **Automatisierungen → Freigaben**.
Neue oder geänderte Regeln müssen ebenfalls freigegeben werden. Jede Freigabe steht mit Name und Zeit im Protokoll.

## Auskunft

Frage in normalen Worten stellen. Jede Antwort zeigt die **Fundstelle** (z. B. „Satzung § 7“). Ohne Fundstelle ist
sie als **ungeprüft** markiert. Satzung und Ordnungen nimmt ein Admin unter „Wissensbasis“ auf.

## Datenampel

| Farbe | Bedeutung | Beispiele |
| --- | --- | --- |
| Rot | gar nicht in die App | Gesundheitsangaben, Zugangsdaten |
| Gelb | nur im einzelnen Vorgang | Stammdaten, Bankdaten, Daten Minderjähriger |
| Grün | dauerhaft | Satzung, Ordnungen, Vorlagen, öffentliche Spielpläne, Ergebnisse |

**Zwei Schalter für gelbe Daten** (Adminpanel → Einstellungen): „lokal automatisch verarbeiten“
(die Daten bleiben auf dem Server) und „an Microsoft 365 geben“ (SharePoint-Kopie, Postfach-Entwürfe –
erst nach geklärter Auftragsverarbeitung). Der KI-Assistent bekommt nie gelbe Daten. Mehr in [EINRICHTUNG.md](EINRICHTUNG.md).

## Ausprobieren ohne echte Daten

Im **Vorstandsarbeit-Simulator** (`npm run simulator`) gibt es einen erfundenen Verein, einen Zeitraffer
und Übungsszenarien wie „Schiedsrichter sagt ab“ oder „Neue Bankverbindung per Mail“. Gut für
Schulungen neuer Amtsträger. Mehr in [SIMULATOR.md](SIMULATOR.md).

## Übergabe eines Amts

Unter **Handbuch je Amt** entsteht aus Vorlagen, Jahreskalender und Lernprotokoll die Übergabedokumentation.
Drucken oder als PDF speichern. Lücken (Vorgänge ohne Anleitung) zeigt die Seite oben an.
