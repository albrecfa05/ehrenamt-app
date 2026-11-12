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
Admin-Konto an (**Ersteinrichtung**). Weitere Konten vergibst du im **Adminpanel**.

### Erst einmal ausprobieren (Demo)

```bash
npm run demo
```

Die Demo startet auf http://localhost:3001 mit Beispieldaten in einem eigenen Ordner
`data-demo/`. Die echten Daten in `data/` bleiben unberührt. Die Zugänge stehen in
`data-demo/DEMO-ZUGANG.txt`. Zum Zurücksetzen der Demo den Ordner `data-demo/` löschen.

### Weitere Befehle

| Befehl | Zweck |
| --- | --- |
| `npm start` | App starten (Port 3000) |
| `npm run dev` | Start mit automatischem Neustart bei Codeänderungen |
| `npm run demo` | Demo mit Beispieldaten (Port 3001, eigener Datenordner) |
| `npm test` | Automatische Tests, u. a. der Abnahmekriterien ABN-5 bis ABN-7 |
| `npm run backup` | Sicherung von Datenbank und Ablage nach `backups/` |
| `npm run passwort-zuruecksetzen -- <anmeldename>` | Notfall, wenn sich kein Admin mehr anmelden kann |

## Erste Schritte nach der Einrichtung

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
9. **Verbindungen** (Adminpanel → Verbindungen): Spielpläne abonnieren; Microsoft 365 nach
   [docs/MICROSOFT-365.md](docs/MICROSOFT-365.md) einrichten (Zugangsdaten in `.env`, Vorlage `.env.beispiel`).

## Dokumentation

| Dokument | Inhalt |
| --- | --- |
| [docs/BEDIENUNG.md](docs/BEDIENUNG.md) | Bedienung für Amtsträger: Aufgaben, Vorgänge, Entwürfe, Freigaben |
| [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) | Aufbau, Datenmodell, Sicherheitskonzept, wie man die App erweitert |
| [docs/BETRIEB.md](docs/BETRIEB.md) | Hosting, HTTPS, Sicherung, Updates, Umgebungsvariablen |
| [docs/MICROSOFT-365.md](docs/MICROSOFT-365.md) | Postfach, Kalender und Ablage anbinden – Schritt für Schritt, mit engsten Rechten |
| [docs/ANFORDERUNGEN.md](docs/ANFORDERUNGEN.md) | Jede Anforderung des Lastenhefts → Umsetzung → Test |
| [docs/KI.md](docs/KI.md) | KI-Assistent: Automatisierungen mit Claude entwerfen – was übertragen wird, Kosten, Einrichtung |
| [docs/IDEEN.md](docs/IDEEN.md) | Was man als Nächstes bauen könnte |
| [docs/OFFENE-PUNKTE.md](docs/OFFENE-PUNKTE.md) | Was noch zu entscheiden ist und welche Annahmen getroffen wurden |

In der App selbst gibt es außerdem **Hilfe und FAQ** mit Grundsätzen, Tastenkürzeln und dem Änderungsverlauf.
