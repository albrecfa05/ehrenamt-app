# Offene Punkte und Annahmen

## Aus dem Lastenheft noch zu entscheiden

| Thema | Stand in der App | Was nach der Entscheidung zu tun ist |
| --- | --- | --- |
| **Widerspruch Wissensbasis/Datenampel** | DAT-2 gilt: Die Wissensbasis weist personenbezogene Angaben ab. | Soll die Wissensbasis doch mehr aufnehmen, `assertKnowledgeSafe` in `server/guards.js` anpassen. |
| **Datenschutz** (Verband/Sportbund) | Regeln zu Vorgängen mit gelben Daten laufen nicht automatisch; meinVerein-Prüfung und Löschfrist sind gesperrt. Postfach-Abruf ist möglich (Eingänge sind Einzelvorgänge), aber standardmäßig aus. | Einstellungen → „Datenschutzfrage geklärt“ setzen, im Katalog Löschfrist und meinVerein-Prüfung einschalten. Auftragsverarbeitung mit Microsoft ist über die Vereinslizenz geregelt – prüfen lassen. Datenschutzinformation für Mitglieder ergänzen (3.5/4.3). |
| **Hosting** | Läuft lokal; Anleitung für Server mit HTTPS in BETRIEB.md. | Anbieter mit Serverstandort EU wählen, Auftragsverarbeitung klären. |
| **KI-Anbindung** | Claude als Berater für Automatisierungen (docs/KI.md): standardmäßig aus, nur grüne Daten, nichts ohne Übernahme durch einen Admin. Auskunft und Eingang arbeiten weiter regelbasiert. | Ein Sprachmodell könnte Entwürfe formulieren, Mails zusammenfassen oder Antworten aus den Fundstellen formulieren. Dafür müssten die Datenschutzfrage (Übermittlung in die USA, 4.3 ff.) und die Kosten geklärt sein. Gelbe Daten dürften nur im einzelnen Vorgang übergeben werden. |
| **Postfach, Kalender, Microsoft 365** | Anbindung fertig und mit simuliertem Server getestet; noch nicht mit dem echten Vereinsmandanten erprobt. | App-Registrierung nach docs/MICROSOFT-365.md anlegen, Zugangsdaten in `.env`, Verbindung testen. Erst mit einem Funktionspostfach pilotieren. |
| **Kosten, Recht, Eigentum** (10.1–10.8) | Privat betrieben. | — |
| **Pilot-Details** (12.1–12.6) | Kennzahlen und Protokoll liefern die Nachweise für ABN-3, ABN-4, ABN-6. | Pilotvorgang wählen, Vorher-Minuten in der Vorlage eintragen, 4–6 Wochen messen. |

## Annahmen, die beim Bau getroffen wurden

- **Daten im Jahreskalender** (Monat/Tag, Vorlauf) sind Schätzungen und in der App als *Annahme* markiert.
- **Beitragsstufen** (0–17 Jahre 60 €, ab 18 Jahren 120 €) und **Fristen** (Einladung 14 Tage, Anträge 7 Tage,
  Kündigung 3 Monate zum Jahresende) sind Platzhalter unter Einstellungen. Bitte aus der Satzung übernehmen.
- **Ämter** je Verein und im Bezirk sind ein Vorschlag; im Adminpanel änderbar.
- **Zuarbeit** sieht nur zugeordnete Bereiche und bearbeitet nur eigene Aufgaben (oder Vertretungen).
  Kommentare und Dateien zu fremden Aufgaben darf sie zuliefern.
- **Liegezeit** = Zeit von der Erfassung bis zur ersten echten Bearbeitung (Statuswechsel, Schritt, Entwurf,
  Zeiterfassung, Kommentar der verantwortlichen Person). **Durchlaufzeit** = Erfassung bis Abschluss.
- **Asana-Import:** Erledigte Aufgaben zählen nur als Vorher-Wert (Durchlaufzeit), nicht in die Monatswerte.
- **Viele Empfänger** beginnt bei 5 Namen (`MANY_RECIPIENTS` in `services/automation.js`).
- **Zeitplan-Regeln** gelten als Stufe 4 („regelmäßig ohne Anstoß“).
- Das Lastenheft selbst liegt als Dokument „Spielregeln der App“ in der Wissensbasis, damit die Auskunft
  von Anfang an Fragen zur App mit Fundstelle beantworten kann.
