# Ideen für die nächsten Ausbaustufen

Sortiert nach Nutzen für das Lastenheft-Ziel (Zeitersparnis, kürzere Liegezeit) und nach Aufwand.
Alles hält die Grundsätze ein: Entwürfe statt Handeln, Freigabe ab Stufe 3, keine Zahlungen, nur Namen.

## Großer Nutzen, überschaubarer Aufwand

| Idee | Was es bringt | Hinweise |
| --- | --- | --- |
| **Rückmelde-Links für Helfer und Schiedsrichter** | Rundfrage enthält einen persönlichen Link „Ich kann / kann nicht“. Antworten landen ohne Anmeldung direkt an der Aufgabe, der Einsatzplan füllt sich selbst. Löst „Rückmeldungen nachhalten“ (VOR-3, VOR-9, VOR-12). | Link je Person und Termin, nur Name, läuft ab. Kein Konto nötig. |
| **Teilen vom Handy in die App** (Web Share Target) | Bilder und Texte aus WhatsApp per „Teilen → Ehrenamt“ direkt in den Eingang – statt abtippen (1.1 „Material über mehrere Kanäle“). | Funktioniert, wenn die App auf dem Handy als App-Symbol installiert ist (Android; iOS eingeschränkt). |
| **Abwesenheit / Urlaubsmodus** | Für einen Zeitraum gehen neue und fällige Aufgaben automatisch an die Vertretung (2.4 „hängt an genau einer Person“). | Einfach umzusetzen; Katalogeintrag. |
| **Tages- oder Wochenmail an sich selbst** | Die eigene Übersicht morgens im Postfach statt nur in der App. | Ist eine Nachricht an sich selbst; trotzdem mit dem Grundsatz AUT-14 abstimmen. Bräuchte `Mail.Send` nur für das eigene Postfach – oder als Entwurf im eigenen Postfach. |
| **Vorlagen-Bibliothek für den Bezirk** (11.2) | Vorgangsvorlagen, Textvorlagen und Regelwissen als Datei exportieren und in andere Vereine importieren. | Nur teilbare Inhalte (DAT-8), keine Aufgaben oder Personen. |

## Großer Nutzen, mehr Aufwand oder Entscheidung nötig

| Idee | Was es bringt | Voraussetzung |
| --- | --- | --- |
| **KI-Assistent** (z. B. Claude) | Entwürfe aus Stichworten formulieren, lange Mails zusammenfassen, Auskunft in ganzen Sätzen – mit Fundstelle. Protokolle auf Rechtschreibung prüfen (VOR-8). | Datenschutzfrage (Übermittlung, 4.3 ff.), Kosten. Technisch: nur grüne Daten und Namen übergeben, Gelbes nur im einzelnen Vorgang; jede Antwort bleibt Entwurf (Stufe 1). |
| **Ergebnisse aus click-TT in den Spielbericht** | Nach dem Spiel liegt der Spielbericht-Entwurf mit Ergebnis und Punkten schon bereit. | click-TT hat keine offizielle Schnittstelle; Auslesen der öffentlichen Seite ist möglich, aber bricht bei Änderungen. |
| **Mitgliederversammlung als Paket** | Einladung, Anwesenheit, Abstimmungsergebnisse, Protokoll – Beschlüsse wandern danach mit Fundstelle in die Wissensbasis. | Baut auf VOR-8 auf. |
| **Outlook-Kalender lesen** | Termine, die im Vereinskalender eingetragen werden, erscheinen auch in der App. | Nur `Calendars.Read`; einfach, aber doppelte Pflege vermeiden. |
| **IMAP für andere Mailanbieter** | Postfach-Abruf auch ohne Microsoft 365 (z. B. Bühlertal mit anderem Anbieter). | Eigener Anschluss in `server/connectors/`. |
| **Nachweis der Ehrenamtsstunden** | Aus der Zeiterfassung eine Jahresübersicht je Person – für Ehrenamtspreise, Förderanträge oder die Würdigung in der MV. | Nur auf Wunsch der Person auswerten. |

## Bewusst nicht vorgesehen

- Zahlungen, Lastschriften, SEPA-Dateien, Bestellungen (AUT-8)
- Automatischer Versand von Mails an andere (AUT-14)
- Trainingsbetrieb (2.8)
- Dauerhafte Speicherung von Mitgliederdaten außerhalb von meinVerein (DAT-2)
