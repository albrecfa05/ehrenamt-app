# Anforderungen → Umsetzung

Status: ✅ umgesetzt · 🟡 teilweise (Grund in der Spalte) · ⏸ bewusst offen (Entscheidung steht aus) · — entfällt laut Entscheidung

## Kapitel 2: Nutzer, Rollen und Einsatzbereiche

| ID | Status | Umsetzung | Test |
| --- | --- | --- | --- |
| ROL-1 | ✅ | Bereiche TTSF Hohberg, Bühlertal, Bezirk Mittelbaden; weitere im Adminpanel. `access.js` trennt je Bereich. | api.test „Zuarbeit sieht nur zugeordnete Bereiche“ |
| ROL-2 | ✅ | Regeln, Vorlagen, Wissensbasis: Schreibrechte nur für Admins (`requireAdmin`). | ebd. (Regel anlegen → 403) |
| ROL-3 | ✅ | Regeln laufen erst nach Freigabe; Ausführungen ab Stufe 3 nur nach Admin-Ja. | „Regel braucht Freigabe“ |
| ROL-4 | ✅ | Rolle „Zuarbeit“ mit Bereichszuordnung, ohne Umbau. | ebd. |
| ROL-5 | ✅ | Adminpanel → Konten: anlegen, sperren, Sitzungen beenden, Passwort zurücksetzen. | „… Entzug wirkt sofort“ |
| ROL-6 | ✅ | Aufgaben, Termine und Datengrundlage sind für alle Nutzer ihrer Bereiche sichtbar; Admins sehen alles. | — |

## Kapitel 4: Aufgaben sehen und bearbeiten

| ID | Status | Umsetzung |
| --- | --- | --- |
| AUF-1 | ✅ | Seite „Aufgaben“: Filter nach Bereich, Amt, Person, Status, Fälligkeit, Vorgangstyp; Gruppierung; Startseite. |
| AUF-2 | ✅ | Alle genannten Felder inkl. Vertretung, Eingangskanal, Anhänge, Datenklasse, Automatisierungsstufe. |
| AUF-3 | ✅ | Vorgangsvorlagen mit Teilschritten; Aufgabe zeigt erreichten Stand, „als Nächstes“, Notizen je Schritt. |
| AUF-4 | ✅ | Jahreskalender je Amt (jährlich, halbjährlich, quartalsweise, monatlich, wöchentlich) mit Vorlauf; legt Aufgaben automatisch an. Saisonstart, Mannschaftsmeldung, Beitragseinzug, MV, Jahresabschluss, Bezirkstag vorbelegt (Daten = Annahme). |
| AUF-5 | ✅ | „Aus früheren Durchläufen“: Datum, Dauer, Minuten und Notizen des letzten Durchlaufs. |
| AUF-6 | ✅ | Status „Wartet auf Zulieferung“ verlangt „wer schuldet was“. |
| AUF-7 | ✅ | Hervorhebung überfällig/lange still; tägliche Erinnerungen (Benachrichtigungen); Schwelle einstellbar. |
| AUF-8 | ✅ | Ideenspeicher; Ideen ohne Bewegung werden regelmäßig zur Entscheidung vorgelegt. |
| AUF-9 | ✅ | Mehrfachauswahl → „Nacheinander abarbeiten“ und Sammeländerungen. |
| AUF-10 | ✅ | Kennzahlen: Liegezeit, Durchlaufzeit, Minuten je Monat; Zeiterfassung je Aufgabe. |
| AUF-11 | ✅ | Kalender (Monatsansicht) mit Fristen, Terminen und künftigen Jahreskalender-Einträgen. |
| AUF-12 | ✅ | Asana-CSV-Import mit Zuordnung der Personen, Teilaufgaben → Teilschritte, kein Doppelimport. |
| AUF-13 | ✅ | Verlauf je Aufgabe aus dem unveränderlichen Protokoll. |
| AUF-14 | ✅ | Anleitung je Vorgangstyp (für VOR-1…15 vorbelegt), sichtbar in jeder Aufgabe und im Handbuch. |
| ABL-1 | ✅ | Gemeinsame Ablage, Zuordnung zu Aufgaben, Suche über Name, Aussteller, Anlass und Textinhalt. |
| ABL-2 | ✅ | Einheitlicher Name „JJJJ-MM-TT - Aussteller - Anlass“ wird vorgeschlagen und gesetzt. |
| ABL-3 | ✅ | 15 Textvorlagen mit Variablen, u. a. Willkommensmail, Spendenbescheinigung, Verzichtserklärung, Förderantrag, Sponsorenrechnung. |
| ABL-4 | ✅ | Genau eine gültige Version; abgelöste Stände in `versions`; Änderungsnotiz Pflicht. |
| ABL-5 | ✅ | Update-Fenster nach der Anmeldung; Änderungsverlauf unter Hilfe → Änderungen. |

## Kapitel 5: Vorgänge

VOR-1 bis VOR-15 sind als Vorgangsvorlagen mit Teilschritten, Anleitung, Höchststufe laut Anhang A,
Datenklasse, zugeordneten Textvorlagen und Rechnern angelegt. Neue Vorgangstypen legen Admins ohne Umbau an (7.8).

| ID | Besonderheit |
| --- | --- |
| VOR-1 | Höchststufe 2; meinVerein und Ersteinzug als „von Hand“ markiert |
| VOR-2 | Rechner „Beitragsstufe prüfen“ (nur Name und Geburtsjahr) und „Kündigungsfrist“ |
| VOR-3 | Vorher-Aufwand 10 Minuten hinterlegt (für ABN-4) |
| VOR-5, VOR-10 | „nie ausführen“; Budget-Rechner gegen Reserve 20.000 € (einstellbar) |
| VOR-8 | Rechner „Einladungsfrist“ |
| VOR-9, VOR-12, VOR-14 | Rechner „Einsätze fair verteilen“ |
| VOR-11 | Höchststufe 0, Auskunft nur mit Fundstelle |
| VOR-14 | Markiert „Minderjährige“ |
| VOR-15 | Seite „Handbuch je Amt“, druckbar |

## Kapitel 6: Automatisierungen

| ID | Status | Umsetzung |
| --- | --- | --- |
| AUT-1 | ✅ | Höchststufe je Vorgangstyp; Regeln, Aufgaben und Vorlagenänderungen prüfen sie. |
| AUT-2 | ✅ | Regeln mit Auslöser (Zeitplan, Frist, Eingang, Statuswechsel, auf Zuruf) und Aktion (Aufgabe anlegen, Entwurf erzeugen, erinnern, Übersicht, Kalendereintrag). |
| AUT-3 | ✅ | „Jetzt ausführen“ und „Ausgewählte hintereinander ausführen“. |
| AUT-4 | ✅ | Postfach-Abruf aus Microsoft 365 (Funktionspostfächer, mit Anhängen), dazu `.eml`-Upload und manuelle Erfassung. Vorschlag für Bereich, Vorgang und Frist; eindeutige Eingänge optional direkt als Aufgabe; Antworten werden der Aufgabe zugeordnet. |
| AUT-5 | ✅ | Entwürfe aus Vorlagen mit Variablen; fehlende Werte bleiben sichtbar als [[name]]. |
| AUT-6 | ✅ | Ausführungen (Stufe 3) nur nach Freigabe; Person und Zeitpunkt im Protokoll. |
| AUT-7 | ✅ | Ab 5 Empfängern eigene Bestätigung mit sichtbarer Liste (bei Freigabe und beim Übernehmen eines Entwurfs). |
| AUT-8 | ✅ | Sperrliste in `guards.js`; nur bekannte Aktionsarten zulässig. |
| AUT-9 | ✅ | Bereinigung automatischer Texte; verbotene Variablen; Empfänger nur als Namen. |
| AUT-10 | ✅ | Eingänge werden nie ausgeführt; Auffälligkeiten markiert. |
| AUT-11 | ✅ | Jede Auskunft mit Fundstelle oder als „ungeprüft“ markiert. |
| AUT-12 | ✅ | Sechs Rechner; Rechenweg wird an der Aufgabe und im Protokoll gespeichert. |
| AUT-13 | ✅ | Regel „Wöchentliche Übersicht“ (Stufe 4) und „Übersicht als Bericht“ auf Zuruf. |
| AUT-14 | ✅ | Kein Mailversand in der App; „Übernehmen“ protokolliert, „Im Mailprogramm öffnen“ übergibt an den Menschen. |
| AUT-15 | ✅ | Lernprotokoll (Datum, Thema, Regel, Herkunft); erscheint beim nächsten Durchlauf und im Handbuch. |

## Kapitel 7: Daten und Schnittstellen

| ID | Status | Umsetzung |
| --- | --- | --- |
| DAT-1 | ✅ | Datenklasse je Aufgabe und Datei; rote Daten werden abgewiesen. |
| DAT-2 | ✅ | Wissensbasis weist personenbezogene Angaben ab; Gelb nie in der Wissensbasis. Gilt, solange der Widerspruch Wissensbasis/Datenampel offen ist. |
| DAT-3 | ✅ | Die App schreibt in keine Vereins- oder Verbandssoftware; solche Schritte sind „von Hand“. |
| DAT-4 | 🟡 | Microsoft 365: eigene App-Registrierung, per Zugriffsrichtlinie auf Funktionspostfächer begrenzt, ohne `Mail.Send` (docs/MICROSOFT-365.md). meinVerein: weiterhin Export durch einen Menschen (keine Schnittstelle). |
| DAT-5 | ✅ | Postfach (lesen, Entwürfe nach Freigabe), Kalender (ICS-Abo + Outlook-Termine nach Freigabe), Ablage (Kopie nach SharePoint/OneDrive nach Freigabe) – jeweils mit den engsten Rechten. |
| DAT-6 | ✅ | Nur Funktionspostfächer als Quelle; gemeinsame Ablage in der App, optional gespiegelt in die Vereins-SharePoint-Ablage. |
| DAT-7 | ✅ | Systemlandkarte (Auskunft → Systemlandkarte), vorbelegt aus Kapitel 7. |
| DAT-8 | ✅ | Mitgliederdaten, Finanzen, Protokolle je Bereich getrennt; Vorlagen und Regelwissen teilbar. |

## Kapitel 8: Nicht-funktionale Anforderungen

| ID | Status | Umsetzung |
| --- | --- | --- |
| NFA-1 | ✅ | Reine Web App, auch auf dem Handy nutzbar; als App-Symbol speicherbar (Manifest). |
| NFA-2 | ✅ | Unveränderliches Protokoll, Filter, CSV-Export für Kassenprüfung. |
| NFA-3 | ✅ | Eigenes Konto je Person, Passwortregeln, kein geteiltes Passwort. |
| NFA-4 | — | Entfällt (Entscheidung 12.11.2026). |
| NFA-5 | ✅ | Sitzungen sofort entziehbar, auch die eigenen anderen Geräte. |
| NFA-6 | ✅ | README, ARCHITEKTUR, BETRIEB, BEDIENUNG, dieses Dokument; Quelltext kommentiert. |
| NFA-7 | ✅ | Hilfe und FAQ in der App, von Admins pflegbar. |
| NFA-8 | ✅ | Getrennte Datenhaltung je Bereich (logisch in einer Datenbank, durch `access.js` erzwungen). |
| NFA-9 | ✅ | Weitere Nutzer, Bereiche, Ämter, Vorgangstypen ohne Umbau. |
| NFA-10 | ✅ | Einheitliche Dateinamen; Vorgangsschlüssel VOR-n. |
| NFA-11 | ✅ | Fundstelle je Abschnitt, Annahmen markierbar, Rangfolge der Quellen in der Auskunft. |
| NFA-12 | 🟡 | Auskunft nach Art. 15 DSGVO (Adminpanel → Datenschutz: alle Fundstellen eines Namens, CSV-Export), Löschfrist für gelbe Anhänge (Katalog), Datenampel. Konkrete Vorgaben (Auftragsverarbeitung, Fristen) stehen aus. |

## Kapitel 10: Abnahmekriterien

| ID | Wie prüfbar |
| --- | --- |
| ABN-1 | Handbuch je Amt + Anleitungen in den Vorlagen; Übergabetest mit einer zweiten Person. |
| ABN-2 | — entfällt (Entscheidung 12.11.2026). |
| ABN-3 | Kennzahlen → „Mittlere Liegezeit, letzte 6 Wochen“ mit Ziel (einstellbar, Standard 6 Tage). |
| ABN-4 | Vorher-Minuten je Vorgangstyp eintragen; Kennzahlen → „Zeitersparnis je Vorgangstyp“. |
| ABN-5 | `npm test` (guards.test, api.test „Gesperrte Regeln“). |
| ABN-6 | Protokoll → Filter „Nur Freigaben“; api.test „Regel braucht Freigabe“. |
| ABN-7 | Auskunft kennzeichnet Fundstelle bzw. „ungeprüft“; api.test „Auskunft nennt Fundstelle“. |
| ABN-8 | Startseite und Aufgaben zeigen alle Aufgaben beider Power User aus Verein und Bezirk. |


## Ergänzungen über das Lastenheft hinaus (November 2026)

| Funktion | Bezug | Wo |
| --- | --- | --- |
| Automatisierungskatalog: jede Automatik einzeln an/aus mit Parametern und Stufe | Kap. 6, ROL-3 | Adminpanel → Automatisierungen |
| Microsoft 365: Postfach-Abruf, Entwürfe ins Postfach, Outlook-Termine, SharePoint-Ablage | AUT-4, DAT-5, DAT-6 | Adminpanel → Verbindungen |
| Antworten automatisch der Aufgabe zuordnen (Vorgangsnummer im Betreff) | 1.1, AUF-6 | Katalog „Antworten zuordnen“ |
| Mailanhänge automatisch ablegen | 1.1 („Mailanhänge fehlen ein halbes Jahr später“) | Katalog „Anhänge ablegen“ |
| Spielplan-Abos (ICS aus click-TT/nuLiga), Heimspiel-Aufgaben, Verlegungen ziehen Fristen nach | 5.1, 5.7, VOR-9 | Verbindungen → Spielpläne; Vorgang VOR-16 |
| Sponsorenregister mit Paten, Laufzeiten, Kontaktpflege und Verlängerungsaufgabe | VOR-6 | Seite „Sponsoren“ |
| Eskalation an Vertretung und Admins bei deutlicher Überfälligkeit | 2.4 | Katalog „Eskalation“ |
| Abschluss, wenn alle Teilschritte erledigt sind | AUF-3 | Katalog „Abschluss …“ |
| Monatsbericht Kennzahlen | AUF-10, 9.3 | Automatisierungen → Übersichten |
| meinVerein-Export prüfen → Aufgabe mit Stufenwechseln (Export wird nicht gespeichert) | VOR-2, 5.2 | Verbindungen (gesperrt bis Datenschutzfrage geklärt) |
| Sammelfreigabe mehrerer Ausführungen | AUT-6 | Automatisierungen → Freigaben |
| Datenschutz-Auskunft je Person | NFA-12 | Adminpanel → Datenschutz |
| Tests gegen simulierten Microsoft-Server, inkl. Nachweis „nie versendet“ | ABN-5, AUT-14 | `test/integrations.test.js` |
| KI-Assistent: Claude entwirft Regeln und Katalog-Einstellungen aus einer Beschreibung oder aus Zählwerten; App prüft, Admin übernimmt, Regel braucht Freigabe | Kap. 6, ROL-2, ROL-3, DAT-2 | Automatisierungen → Mit KI erstellen; `test/ki.test.js` |
