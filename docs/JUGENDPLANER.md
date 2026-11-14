# Jugendplaner anbinden

Der **TTV-Jugendplaner** (PHP-App auf dem Vereins-Webspace) bleibt, was er ist: Dort tragen
Jugendleitung, Mannschaftsführer und Eltern Spiele, Zusagen, Fahrer und Betreuer ein.
Die Ehrenamt-App **liest mit** und sagt dem Vorstand, wo es klemmt.

## Was die Anbindung kann

| | |
| --- | --- |
| **Spielbetrieb Jugend** (neue Seite) | alle künftigen Jugendspiele mit Status (Fahrer fest, Betreuer da, Mannschaft sucht, offen), Zusagen x/y und Hinweisen |
| **Hinweise** | dieselben Regeln wie im Jugendplaner: niemand fährt/betreut innerhalb der „dringend“-Frist, zu wenige Zusagen, zuständige Herren-/Damenmannschaft spielt selbst, Fahrer spielt zur selben Zeit, Jugendliche spielen zeitgleich bei den Erwachsenen |
| **Aufgaben** | kritische Hinweise werden zur Aufgabe (Vorgang VOR-14) für das Amt „Jugendwart“ – und schließen sich beim nächsten Abgleich von selbst, sobald es im Jugendplaner gelöst ist |
| **Kalender** | „Spielplan-Abo anlegen“ abonniert den Kalender des Jugendplaners: alle Jugendspiele im Kalender der App |
| **Übersicht** | Hinweis „Spielbetrieb Jugend: n Spiele mit kritischem Hinweis“ |
| **Zum Jugendplaner** | öffnet den Jugendplaner – mit der kleinen Ergänzung unten gleich angemeldet |

**Datenschutz:** Der Jugendplaner enthält Namen von Kindern, Eltern und Fahrern. Die App übernimmt
davon **nichts** – nur Termine, Mannschaften, Gegner und Hinweise ohne Namen
(„2 Zusagen – mindestens 3 nötig“, „Fahrer spielt selbst zur selben Zeit“). Im Jugendplaner wird nichts verändert.

## Einrichten

1. In die Datei `.env` der Ehrenamt-App (Vorlage `.env.beispiel`):
   ```
   JUGENDPLANER_URL=https://wp.ttvbuehlertal.de/jugendplaner
   JUGENDPLANER_SECRET=<der APP_SECRET aus der config.php des Jugendplaners>
   ```
   Alternativ zum Schlüssel geht `JUGENDPLANER_PIN=<Mannschaftsführer- oder Jugendleitungs-PIN>` –
   dann aber ohne automatische Anmeldung.
2. Server neu starten.
3. Adminpanel → Verbindungen → **Jugendplaner**: Bereich wählen (z. B. „Bühlertal“), „Jetzt abgleichen“,
   „Spielplan-Abo anlegen“.
4. Adminpanel → Automatisierungen → „Jugendplaner abgleichen“: Rhythmus (Standard: alle 3 Stunden) und ob
   Aufgaben angelegt werden.
5. Das Amt **Jugendwart** im Bereich besetzen – an diese Person gehen die Aufgaben.

Der Schlüssel gehört wie alle Zugangsdaten nur in die `.env`, nie in die Oberfläche oder ins Versionsarchiv.

## Automatische Anmeldung („Zum Jugendplaner“)

Die Ehrenamt-App stellt eine Anmeldung nach demselben Verfahren aus wie der Jugendplaner selbst
(HMAC mit dem `APP_SECRET`, gültig 8 Stunden; Admins und Inhaber der Ämter Jugendwart/Vorsitz als
Jugendleitung, alle anderen als Mannschaftsführer). Weil der Jugendplaner seine Anmeldung im Browser
speichert, braucht er dafür **eine kleine Ergänzung** in `index.html` – direkt hinter dem Block
`const S = { … };` (ca. Zeile 480):

```js
// Anmeldung aus der Ehrenamt-App übernehmen (#sso=…), danach aus der Adresse entfernen
(() => {
  const m = location.hash.match(/[#&]sso=([\w.-]+)/);
  if (m) { S.token = m[1]; store.set("token", m[1]); history.replaceState(null, "", location.pathname + location.search); }
})();
```

Ohne die Ergänzung öffnet „Zum Jugendplaner“ einfach die normale Anmeldung mit PIN – es funktioniert also auch so.

## Im Simulator ausprobieren

`npm run simulator`: Die Vereinswelt enthält einen Jugendplaner-Nachbau mit Fantasie-Mannschaften
(U11, U13, U15) – Menü „Jugendplaner“. Zugangsdaten setzt der Simulator selbst. In Kapitel 1 ist die
Anbindung ein Prüfpunkt, in Kapitel 2 gibt es das Ereignis „Jugend: Fahrer springt ab“.

## Technik

- Anschluss: `server/connectors/jugendplaner.js` (liest `api.php?action=state`, Anmeldung per Schlüssel oder PIN)
- Abgleich, Hinweise, Aufgaben: `server/services/jugendplaner.js`; Schnittstellen `server/api/jugendplaner.js`
- Oberfläche: `public/js/views/spielbetrieb.js`, Karte unter Verbindungen
- Nachbau für Tests und Simulator: `simulator/welt/jugendplaner.js`; Tests: `test/jugendplaner.test.js`
