# Ehrenamt Tischtennis – Web App

Eine Web App, die alle Ehrenamtsaufgaben aus Verein und Bezirk an einer Stelle bündelt:
Aufgaben mit Frist und Verantwortlichen, Vorgangsvorlagen mit Teilschritten, Jahreskalender,
Entwürfe aus Textvorlagen, Automatisierungen mit Freigabe, Ablage, Auskunft mit Fundstelle
und ein unveränderliches Protokoll. Dazu: Anbindung an Microsoft 365 (Postfach, Kalender, Ablage),
Spielplan-Abos aus click-TT/nuLiga, Sponsorenregister und ein Automatisierungskatalog, in dem
Admins jede Automatik einzeln ein- und ausschalten.

Grundlage ist das Lastenheft vom 12.11.2026. Welche Anforderung wo umgesetzt ist, steht in
[docs/ANFORDERUNGEN.md](docs/ANFORDERUNGEN.md).

> **Grundsatz:** Die App liefert Entwürfe, Prüfungen und Übersichten. Entscheidungen,
> Unterschriften und Zahlungen bleiben beim Amt. Zahlungen, Lastschriften, Bankvorgänge und
> Bestellungen sind technisch gesperrt. Mails entstehen nur als Entwurf.

## Schnellstart

Voraussetzung ist **Node.js ab Version 22.13** (https://nodejs.org, Version „LTS“). Die App selbst
braucht keine weiteren Pakete. Nur für den optionalen KI-Assistenten (Claude) einmal `npm install`
ausführen – ohne das Paket läuft alles andere unverändert.

```bash
npm start
```

Dann im Browser http://localhost:3000 öffnen. Beim ersten Aufruf legst du das erste
Admin-Konto an (**Ersteinrichtung**). Danach führt der **Einrichtungsassistent** durch alles
Weitere: Bereiche, Personen und Ämter, Satzungsfristen, Datenschutz-Schalter, Verbindungen,
Automatisierungen, Jahreskalender und Satzung (siehe [docs/EINRICHTUNG.md](docs/EINRICHTUNG.md)).

### Leere App ausprobieren

```bash
npm run leer
```

Startet eine ganz leere App auf http://localhost:3003 (eigener Ordner `data-leer/`, ein
Platzhalter-Bereich „Mein Verein“), um die Ersteinrichtung mit dem Assistenten durchzuspielen.
`npm run leer -- --neu` beginnt wieder ganz von vorn.

### Vorstandsarbeit-Simulator

```bash
npm run simulator
```

Startet eine **virtuelle Vereinswelt** (http://localhost:3002) und daneben eine **leere App**
(http://localhost:3004). Der erfundene TTV Musterhausen hat Postfächer mit alten Mails, einen Briefkasten
(z. B. ein ausgefüllter Mitgliedsantrag als PDF), WhatsApp-Gruppen, einen Vereinsordner mit Satzung,
Ämterliste, Asana- und meinVerein-Export sowie click-TT-Spielpläne. Du richtest die App damit ein
(Kapitel 1) und bewältigst danach mit Zeitraffer den Vereinsalltag (Kapitel 2, 17 Ereignisse aus
typischen Vereinsproblemen). Details: [docs/SIMULATOR.md](docs/SIMULATOR.md).

### Weitere Befehle

Unter Windows-PowerShell meldet `npm` evtl. „Ausführung von Skripts deaktiviert“ – dann `npm.cmd` statt `npm` schreiben
(z. B. `npm.cmd run simulator`) oder die Eingabeaufforderung (`cmd`) nutzen.

| Befehl | Zweck |
| --- | --- |
| `npm start` | App starten (Port 3000) |
| `npm run dev` | Start mit automatischem Neustart bei Codeänderungen |
| `npm run demo` | Demo mit Beispieldaten (Port 3001, eigener Datenordner) |
| `npm run simulator` | Vereinswelt (Port 3002) und leere App (Port 3004); `-- --neu` setzt zurück, `-- --echte-ki` nutzt den echten Claude |
| `npm run leer` | Leere App für die Ersteinrichtung (Port 3003); `-- --neu` setzt zurück |
| `npm test` | Automatische Tests, u. a. der Abnahmekriterien ABN-5 bis ABN-7 |
| `npm run backup` | Sicherung von Datenbank und Ablage nach `backups/` |
| `npm run passwort-zuruecksetzen -- <anmeldename>` | Notfall, wenn sich kein Admin mehr anmelden kann |

## Erste Schritte nach der Einrichtung

Der Einrichtungsassistent (Navigation „Einrichtung“, solange er nicht abgeschlossen ist, sonst `#/einrichtung`)
führt durch die Punkte 1–5, 7, 8 und 10. Die vollständige Liste:

1. **Zweites Admin-Konto** anlegen (Adminpanel → Konten). Das vorläufige Passwort wird einmal angezeigt.
2. **Ämter besetzen** (Adminpanel → Bereiche und Ämter): Inhaber und Vertretung je Amt.
   Neue Aufgaben eines Amts bekommen diese automatisch.
3. **Jahreskalender prüfen** (Kalender → Jahreskalender): Alle Daten sind als *Annahme*
   markiert und müssen von den Ämtern bestätigt oder korrigiert werden.
4. **Einstellungen** prüfen (Adminpanel → Einstellungen): Fristen laut Satzung, Beitragsstufen, Reserve.
5. **Satzung und Ordnungen** in die Wissensbasis aufnehmen (Auskunft → Wissensbasis).
   Überschriften wie „§ 5 …“ werden automatisch zu Fundstellen.
6. **Asana übernehmen** (Adminpanel → Asana-Import): CSV-Export je Projekt, einmal importieren.
7. **Beispielregeln freigeben** (Automatisierungen): Sie sind angelegt, laufen aber erst nach Freigabe.
8. **Automatisierungen wählen** (Adminpanel → Automatisierungen): Was die App selbstständig tun soll.
9. **Ablageregeln** (Eingang → Regeln): festlegen, in welchen Ordner Mailanhänge kommen – z. B. Hallenpläne der Gemeinde, Rechnungen, Ausschreibungen.
10. **Verbindungen** (Adminpanel → Verbindungen): Spielpläne abonnieren; Microsoft 365 nach
   [docs/MICROSOFT-365.md](docs/MICROSOFT-365.md) einrichten (Zugangsdaten in `.env`, Vorlage `.env.beispiel`).

## Dokumentation

**Bebilderte Anleitung:** [docs/anleitung/index.html](docs/anleitung/index.html) – im Browser öffnen (Doppelklick). Erklärt alle Funktionen und den Simulator mit Screenshots.

| Dokument | Inhalt |
| --- | --- |
| [docs/BEDIENUNG.md](docs/BEDIENUNG.md) | Bedienung für Amtsträger: Aufgaben, Vorgänge, Entwürfe, Freigaben |
| [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) | Aufbau, Datenmodell, Sicherheitskonzept, wie man die App erweitert |
| [docs/BETRIEB.md](docs/BETRIEB.md) | Hosting, HTTPS, Sicherung, Updates, Umgebungsvariablen |
| [docs/MICROSOFT-365.md](docs/MICROSOFT-365.md) | Postfach, Kalender und Ablage anbinden – Schritt für Schritt, mit engsten Rechten |
| [docs/EINRICHTUNG.md](docs/EINRICHTUNG.md) | Leere App, Einrichtungsassistent, die beiden Datenschutz-Schalter |
| [docs/SIMULATOR.md](docs/SIMULATOR.md) | Vorstandsarbeit-Simulator: Demo-Verein, Zeitraffer, Szenarien und ihre Quellen |
| [docs/ANFORDERUNGEN.md](docs/ANFORDERUNGEN.md) | Jede Anforderung des Lastenhefts → Umsetzung → Test |
| [docs/JUGENDPLANER.md](docs/JUGENDPLANER.md) | Jugendplaner anbinden: Spielbetrieb Jugend, Hinweise als Aufgaben, Kalender, Anmeldung |
| [docs/KI.md](docs/KI.md) | KI-Assistent: Automatisierungen mit Claude entwerfen – was übertragen wird, Kosten, Einrichtung |
| [docs/IDEEN.md](docs/IDEEN.md) | Was man als Nächstes bauen könnte |
| [docs/OFFENE-PUNKTE.md](docs/OFFENE-PUNKTE.md) | Was noch zu entscheiden ist und welche Annahmen getroffen wurden |

In der App selbst gibt es außerdem **Hilfe und FAQ** mit Grundsätzen, Tastenkürzeln und dem Änderungsverlauf.
