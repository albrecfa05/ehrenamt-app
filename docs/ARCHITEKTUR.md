# Architektur

Diese Beschreibung richtet sich an alle, die die App weiterentwickeln oder übernehmen (NFA-6).
Sie setzt Grundkenntnisse in JavaScript voraus, aber keine Kenntnis der ursprünglichen Erbauer.

## Leitentscheidungen

| Entscheidung | Begründung |
| --- | --- |
| **Node.js ohne externe Pakete** | Keine Abhängigkeiten, die veralten oder Sicherheitslücken mitbringen. Ein Nachfolger braucht nur Node.js. |
| **SQLite über `node:sqlite`** | Eine einzige Datei als Datenbank, leicht zu sichern, für zwei bis zwanzig Nutzer mehr als ausreichend. |
| **Browser-Oberfläche ohne Build-Schritt** | Die Dateien in `public/` werden so ausgeliefert, wie sie geschrieben sind. Keine Werkzeugkette nötig. |
| **Regeln im Code, nicht nur in der Oberfläche** | Sperrliste, Höchststufen und Bereichstrennung prüft der Server. Eine manipulierte Oberfläche kann sie nicht umgehen. |
| **Protokoll nur anhängend** | Datenbank-Trigger verhindern Änderungen und Löschungen im Protokoll (NFA-2). |

## Verzeichnisse

```
server/
  index.js          Einstieg: Datenbank öffnen, Grunddaten, Schnittstellen laden, Server starten
  config.js         Einstellungen über Umgebungsvariablen (Port, Datenordner, Cookies …)
  db.js             Schema als nummerierte Migrationen, Hilfen für Abfragen und Transaktionen
  http.js           Kleiner HTTP-Rahmen: Routing, JSON, Dateien, Sicherheits-Header, Fehler
  auth.js           Passwörter (scrypt), Sitzungen, Passwortregeln, Schutz vor Durchprobieren
  access.js         Bereichstrennung und Rollenprüfung
  guards.js         Schutzregeln: Sperrliste (AUT-8), nur Namen (AUT-9), Eingangsprüfung (AUT-10), Datenampel
  templating.js     Textvorlagen mit {{variablen}}
  calc.js           Rechner mit Rechenweg (AUT-12)
  search.js         Volltextsuche für Deutsch (BM25, Umlaute, einfache Stammformen)
  seed.js           Grunddaten beim ersten Start; seedUpgrades() ergänzt neue Vorlagen in bestehenden Installationen
  connectors/
    m365.js         Microsoft Graph: Mails lesen, Entwürfe/Termine/Dateien anlegen – keine Sendefunktion
    claude.js       Claude (Anthropic SDK): strukturierte Vorschläge, keine Werkzeuge
    ics.js          Kalender-Abos (Spielpläne) lesen, Heimspiele erkennen
  services/
    tasks.js        Fachlogik der Aufgaben: Anlegen aus Vorlagen, Statuswechsel, Liegezeit, Erfahrungswerte
    automation.js   Regeln, Stufen, Freigaben (asynchron ausgeführt), Übersichten
    catalog.js      Automatisierungskatalog: was die App kann, an/aus, Parameter, Voraussetzungen
    inbox.js        Eingang: Vorschläge, Antwortzuordnung, Übernahme mit Anhängen, Postfach-Abruf
    jobs.js         Spielpläne, Sponsoren, Eskalation, Monatsbericht, meinVerein-Prüfung, Auto-Abschluss
    files.js        Ablage speichern (Upload, Mailanhänge), Themen-Ordner, SharePoint-Kopie vorschlagen
    filing.js       Eingangs- und Ablageregeln: Abgleich, Vorschau, Ablegen, Anwenden auf neue Eingänge
    ki.js           KI-Assistent: Kontext (nur grüne Daten), Antwortformat, Prüfung, Übernahme
    scheduler.js    Minütlicher Takt: ruft alle Abläufe auf, jeder prüft selbst, ob er eingeschaltet ist
  api/              Schnittstellen je Fachgebiet (registrieren sich beim Import selbst)
public/
  index.html, css/app.css
  js/app.js         Anmeldung, Grundgerüst, Router (#/pfad)
  js/api.js         Aufrufe an den Server
  js/ui.js          DOM-Helfer h(), Dialoge, Formate, Abzeichen, Icons
  js/state.js       Gemeinsame Stammdaten im Browser
  js/views/*.js     Eine Datei je Seite
scripts/            demo.js, backup.js, reset-password.js
test/               Automatische Tests (node --test)
data/               Laufzeitdaten: ehrenamt.sqlite und ablage/ (nicht ins Versionsarchiv!)
```

## Ablauf einer Anfrage

1. `http.js` prüft die Route und bei schreibenden Aufrufen den Header `X-Requested-With: tte`
   (Schutz vor Cross-Site-Anfragen, zusätzlich zum `SameSite=Strict`-Cookie).
2. `auth.js` ermittelt die Person aus dem Sitzungs-Cookie. Gesperrte Konten zählen nicht.
3. Der Handler in `api/*.js` prüft Bereich und Rolle (`access.js`), validiert die Eingaben
   (`util.js`: `str`, `int`, `oneOf` …) und ruft die Fachlogik auf.
4. Jede Änderung schreibt über `audit()` einen Protokolleintrag.

## Datenmodell (Kurzfassung)

| Tabelle | Inhalt |
| --- | --- |
| `users`, `sessions`, `user_areas` | Konten, Sitzungen (nur Token-Hash), Bereichszuordnung für Zuarbeit |
| `areas`, `offices` | Bereiche (Vereine, Bezirk) und Ämter mit Inhaber und Vertretung |
| `tasks` | Aufgaben und Ideen (`kind`), mit Status, Frist, Datenklasse, Stufe, Herkunft, Zeitstempeln für Liegezeit/Durchlaufzeit |
| `task_steps`, `comments`, `time_entries`, `calculations` | Teilschritte, Kommentare, erfasste Minuten, Berechnungen mit Rechenweg |
| `process_templates`, `process_steps` | Vorgangsvorlagen (Höchststufe, „nie ausführen“, Anleitung) |
| `text_templates`, `drafts` | Textvorlagen und daraus erzeugte Entwürfe |
| `versions`, `changelog` | Abgelöste Stände von Vorlagen/Regeln/Wissensbasis; Update-Fenster |
| `recurring` | Jahreskalender: wiederkehrende Aufgaben mit Vorlauf |
| `rules`, `rule_runs`, `approvals`, `reports` | Automatisierungen, Läufe, Freigaben, Übersichten |
| `events` | Termine (eigene und nach Freigabe eingetragene) für Kalender und ICS-Abo |
| `inbox` | Eingänge als Aufgabenvorschläge |
| `files` | Ablage mit Metadaten; Dateien liegen in `data/ablage/<bereich>/<jahr>/` |
| `kb_documents`, `kb_sections`, `kb_questions` | Wissensbasis mit Fundstellen, gestellte Fragen |
| `learnings`, `faq`, `systems`, `settings` | Lernprotokoll, Hilfe, Systemlandkarte, Einstellungen |
| `audit_log` | Protokoll; Trigger verbieten UPDATE und DELETE |

Das vollständige Schema steht in `server/db.js`.

## Sicherheitskonzept

- **Anmeldung:** Passwörter mit scrypt (N=16384) gehasht, Mindestanforderungen in `checkPasswordStrength`.
  Nach acht Fehlversuchen je IP und Konto 15 Minuten Sperre.
- **Sitzungen:** Zufälliges 256-Bit-Token im HttpOnly-Cookie (`SameSite=Strict`), in der Datenbank
  nur als SHA-256-Hash. Admins entziehen Sitzungen sofort (NFA-5). Passwortwechsel beendet andere Sitzungen.
- **Bereichstrennung:** Zuarbeitende sehen nur zugeordnete Bereiche. Jede Abfrage nutzt `areaClause`/`canSeeArea`.
- **Sperrliste (AUT-8):** `guards.js → assertActionAllowed` lässt nur fünf bekannte Aktionsarten zu
  und prüft Aktionsart und Inhalt auf Zahlung, Lastschrift, Bank, Bestellung und IBAN. Die Prüfung läuft
  beim Anlegen einer Regel, vor jedem Lauf und erneut bei jeder Freigabe.
- **Nur Namen (AUT-9):** `scrubPersonalData` entfernt IBAN, Mailadressen, Telefonnummern, Anschriften und
  Geburtsdaten aus automatisch erzeugten Texten. Variablen wie `{{adresse}}` sind in Vorlagen verboten.
- **Eingänge (AUT-10):** Werden nie ausgeführt. `inspectInbound` markiert Zahlungsdruck, Fragen nach
  Zugangsdaten, geänderte Bankverbindungen, Anweisungen an das System und Gesundheitsangaben.
- **Browser:** Strikte Content-Security-Policy (nur eigene Skripte, keine Inline-Skripte), `X-Frame-Options: DENY`.

## Stufenmodell im Code

| Stufe | Wo durchgesetzt |
| --- | --- |
| Höchststufe je Vorgang (AUT-1) | `validateRule`, `createTask`, `updateTask`, beim Ändern einer Vorlage |
| Regel braucht Freigabe (ROL-3) | `runRule` bricht ab, wenn `approved = 0`; jede Änderung setzt die Freigabe zurück |
| Stufe 3 (AUT-6) | `runRule` führt externe Aktionen nie direkt aus, sondern legt eine `approval` an |
| Viele Empfänger (AUT-7) | `decideApproval` und `drafts/:id/take` verlangen ab 5 Empfängern eine ausdrückliche Bestätigung |
| Zeitplan = Stufe 4 | `validateRule` verlangt für Auslöser „Zeitplan“ Stufe 4 |
| Gelbe Daten (Kap. 9) | `yellowBlocked`: Regeln zu gelben Vorgängen laufen erst nach Einstellung „Datenschutzfrage geklärt“ |

## Automatisierungskatalog und Verbindungen

Jeder automatische Ablauf ist ein Eintrag in `services/catalog.js` (Schlüssel, Stufe, Standard an/aus, Parameter,
Voraussetzungen `m365` oder `datenschutz`). Der Ablauf selbst fragt `isOn('schlüssel')` und `param('schlüssel', 'name')`.
Ein neuer Ablauf braucht also: Katalogeintrag + Code mit `isOn`-Prüfung + Aufruf im Zeitplan oder an der passenden Stelle.

Externe Ausführungen (Stufe 3) laufen immer über `requestApproval` → Freigabe → `executeApproved` (asynchron,
Ergebnis oder Fehler im Protokoll). Die Aktionsarten stehen in `guards.js → ALLOWED_ACTIONS`; mit `ruleable: false`
sind sie nur über Schaltflächen bzw. den Katalog erreichbar, nicht als frei konfigurierbare Regel.

Zugangsdaten für Verbindungen stehen ausschließlich in `.env` (über `process.loadEnvFile`), nie in der Datenbank.
Für Tests lassen sich die Microsoft-Adressen umbiegen (`M365_LOGIN_URL`, `M365_GRAPH_URL`); `test/integrations.test.js`
startet dafür einen simulierten Graph-Server.

## Erweitern

**Neuer Vorgangstyp:** Ohne Code in der App (Vorgangsvorlagen → Neuer Vorgangstyp).

**Neuer Rechner:** In `server/calc.js` einen Eintrag in `CALCULATORS` ergänzen (`label`, `fields`, `run`).
`run` gibt `{ result, summary, steps }` zurück. Danach steht er in Aufgaben und Vorlagen zur Auswahl.

**Neue Aktionsart für Regeln:** In `guards.js → ALLOWED_ACTIONS` eintragen (mit `minLevel` und `external`),
in `services/automation.js` ausführen (intern: `executeInternal`; extern: `buildExternalPayload` und
`executeApproved`). Externe Aktionen laufen dann automatisch über die Freigabe. Die Sperrliste gilt weiter.

**Anbindung an Microsoft 365 (Postfach, Kalender, Ablage):** Vorgesehen ist ein eigenes Funktionskonto
mit den engsten Rechten (DAT-4, DAT-5). Ein Kalendereintrag über Graph wäre eine neue externe
Aktionsart wie oben; der Mail-Abruf würde Eingänge über dieselbe Funktion wie `POST /api/inbox` anlegen.

**Neue Datenbankspalte:** In `server/db.js` eine **neue** Migration an `MIGRATIONS` anhängen
(z. B. `ALTER TABLE tasks ADD COLUMN …`). Bestehende Migrationen nie ändern.

**Neue Seite:** Datei in `public/js/views/` mit `export default async function (el, params)`,
in `public/js/app.js` in `ROUTES` und ggf. `NAV` eintragen.

## Tests

`npm test` startet die App mit einem temporären Datenordner und prüft über die echte HTTP-Schnittstelle
unter anderem: Sperrliste (ABN-5), Protokoll von Freigaben (ABN-6), Fundstellen (ABN-7), Bereichstrennung,
sofortigen Entzug, Höchststufen, Versionen, Datenampel, Asana-Import, Rechner und Kalender-Abo.
