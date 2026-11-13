# Einrichtung: von der leeren App bis zum Betrieb

## Leere App starten

| Wie | Wofür |
| --- | --- |
| `npm start` mit leerem `data/` | Die echte Einrichtung. Startet mit den Bereichen TTSF Hohberg, Bühlertal und Bezirk Mittelbaden; nicht benötigte Bereiche lassen sich im Assistenten entfernen, solange sie leer sind. |
| `npm run leer` | Zum Ausprobieren: ganz leere App auf Port 3003 im Ordner `data-leer/`, nur ein Platzhalter-Bereich „Mein Verein“. `npm run leer -- --neu` setzt sie zurück. |
| `TTE_LEER=1 npm start` | Echte App, aber mit „Mein Verein“ statt der vorgegebenen Bereiche (z. B. für einen anderen Verein). |

Nach dem ersten Admin-Konto öffnet sich der **Einrichtungsassistent** von selbst. Solange er nicht
abgeschlossen ist, steht „Einrichtung“ in der Navigation und ein Hinweis auf der Übersicht.
Bestehende Installationen sehen den Assistenten nicht ungefragt; er ist jederzeit unter `#/einrichtung` erreichbar.

## Die neun Schritte

Jeder Schritt zeigt seinen **tatsächlichen Stand aus den Daten** (z. B. „2 Admins, 7 von 9 Ämtern besetzt“)
und lässt sich zusätzlich als erledigt markieren. Nichts ist endgültig – alles bleibt im Adminpanel änderbar.

1. **Verein und Bezirk** – Bereiche umbenennen, Farbe, neue hinzufügen (bekommen automatisch die üblichen Ämter und den Jahreskalender), leere entfernen.
2. **Personen und Ämter** – Konten anlegen (vorläufiges Passwort wird einmal angezeigt), Inhaber und Vertretung je Amt. Empfehlung: mindestens zwei Admins.
3. **Fristen und Beiträge** – Einladungs-, Antrags- und Kündigungsfrist laut Satzung, Reserve, Beitragsstufen. Die Rechner verwenden diese Werte.
4. **Datenschutz** – die beiden Schalter (siehe unten).
5. **Verbindungen** – Stand von Microsoft 365, Spielplan-Abos, Claude und Kalender-Abo mit Link zur Einrichtung. Alles optional.
6. **Automatisierungen** – Voreinstellung *Vorsichtig*, *Empfohlen* oder *Umfassend*; optional die Beispielregeln gleich freigeben.
7. **Jahreskalender** – die geschätzten Termine anpassen und auf einmal bestätigen.
8. **Satzung und Ordnungen** – Text einfügen; „§ 5 …“-Überschriften werden zu Fundstellen der Auskunft.
9. **Los geht’s** – Links zu Asana-Import, Ablageregeln, Vorgangsvorlagen, KI-Assistent.

## Die beiden Datenschutz-Schalter

Die Automatisierungen der App laufen **algorithmisch auf eurem Server**. Für gelbe Daten
(Stammdaten, Bankdaten, Minderjährige) gibt es deshalb zwei getrennte Entscheidungen:

| Schalter | Was er erlaubt | Wann einschalten |
| --- | --- | --- |
| **Gelbe Daten lokal automatisch verarbeiten** | Regeln für gelbe Vorgänge (z. B. Willkommensmail-Entwurf bei Neuaufnahme), meinVerein-Prüfung der Beitragsstufen, Löschfrist für gelbe Anhänge | Wenn der Verein das für sich entschieden hat – die Daten verlassen den Server nicht. |
| **Gelbe Daten an Microsoft 365 geben** | SharePoint-Kopie gelber Dateien, Entwürfe gelber Vorgänge ins Postfach – jeweils nach Freigabe | Erst wenn die Auftragsverarbeitung mit Microsoft geklärt ist (Verband/Sportbund fragen). |

Unabhängig davon bekommt der **KI-Assistent nie gelbe Daten**. Der frühere einzelne Schalter
„gelbe Daten freigegeben“ wird weiter verstanden und setzt beide.
