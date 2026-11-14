# Microsoft 365 anbinden

Die App spricht über **Microsoft Graph** mit dem Vereins-Microsoft-365 (Programm „Microsoft 365 für gemeinnützige
Organisationen“). Sie meldet sich als eigene Anwendung an, nicht mit dem Konto einer Person (DAT-4).

## Was die App darf

| Fähigkeit | Graph-Berechtigung (Anwendung) | Stufe | Wann |
| --- | --- | --- | --- |
| Mails aus Funktionspostfächern lesen (inkl. Anhängen) | `Mail.Read` | 2 | Automatisierung „Postfächer abrufen“ |
| Entwurf im Postfach ablegen | `Mail.ReadWrite` | 3 | nur nach Freigabe |
| Termin im Kalender des Funktionspostfachs | `Calendars.ReadWrite` | 3 | nur nach Freigabe |
| Datei in SharePoint/OneDrive kopieren | `Sites.Selected` (empfohlen) oder `Files.ReadWrite.All` | 3 | nur nach Freigabe |

**Bewusst nicht vergeben: `Mail.Send`.** Ohne diese Berechtigung kann die App technisch keine Mail verschicken –
auch nicht durch einen Fehler. Das sichert AUT-14 („Mails nur als Entwurf, Versand durch einen Menschen“) doppelt ab.

Wird nur ein Teil gebraucht (z. B. nur Postfach lesen), nur diese Berechtigung vergeben. Die übrigen Automatisierungen
bleiben dann im Katalog ausgeschaltet.

## Einrichtung (einmalig, ca. 20 Minuten, Rolle „Globaler Administrator“ nötig)

1. **Funktionspostfächer** anlegen, falls noch nicht vorhanden (z. B. `info@`, `sport@`, `termine@`). Private Postfächer
   sollen keine Quelle sein (DAT-6).
2. **App registrieren:** https://entra.microsoft.com → Anwendungen → App-Registrierungen → *Neue Registrierung*.
   Name z. B. „Ehrenamt-App“, Kontotyp „Nur Konten in diesem Organisationsverzeichnis“. Keine Umleitungs-URI nötig.
3. **Berechtigungen:** API-Berechtigungen → *Berechtigung hinzufügen* → Microsoft Graph → **Anwendungsberechtigungen** →
   die oben genannten auswählen → *Administratorzustimmung erteilen*.
4. **Geheimer Schlüssel:** Zertifikate & Geheimnisse → *Neuer geheimer Clientschlüssel* (Laufzeit z. B. 12 Monate,
   Ablaufdatum in den Jahreskalender eintragen!). Den **Wert** sofort kopieren.
5. **Zugriff auf die Funktionspostfächer begrenzen** (wichtig, sonst darf die App alle Postfächer lesen).
   In der Exchange-Online-PowerShell:
   ```powershell
   Connect-ExchangeOnline
   New-DistributionGroup -Name "Ehrenamt-App-Postfaecher" -Type Security
   Add-DistributionGroupMember -Identity "Ehrenamt-App-Postfaecher" -Member info@verein.de
   New-ApplicationAccessPolicy -AppId <Anwendungs-ID> -PolicyScopeGroupId "Ehrenamt-App-Postfaecher" `
     -AccessRight RestrictAccess -Description "Ehrenamt-App nur Funktionspostfächer"
   Test-ApplicationAccessPolicy -AppId <Anwendungs-ID> -Identity info@verein.de      # → Granted
   Test-ApplicationAccessPolicy -AppId <Anwendungs-ID> -Identity vorstand@verein.de  # → Denied
   ```
   (Alternativ die neueren „RBAC for Applications“ in Exchange Online.)
6. **Ablage begrenzen** (bei `Sites.Selected`): der App per Graph nur die eine SharePoint-Website freigeben
   (`POST /sites/<site-id>/permissions` mit Rolle `write`). Die Site-ID findet man unter
   `https://graph.microsoft.com/v1.0/sites/<firma>.sharepoint.com:/sites/<name>`.
7. **Zugangsdaten auf dem Server** in die Datei `.env` (neben `package.json`) eintragen – Vorlage: `.env.beispiel`:
   ```
   M365_TENANT_ID=<Verzeichnis-ID (Mandant)>
   M365_CLIENT_ID=<Anwendungs-ID (Client)>
   M365_CLIENT_SECRET=<Wert des geheimen Schlüssels>
   ```
   Server neu starten. Die Zugangsdaten stehen nie in der Datenbank und nie in der Oberfläche (Datenampel: Zugangsdaten = rot).
8. **In der App:** Adminpanel → Verbindungen → Postfächer mit Bereich eintragen, Kalender-Postfach und Ablageort
   (z. B. `sites/<site-id>/drive`) angeben → *Verbindung testen*.
9. **Einschalten:** Adminpanel → Automatisierungen → gewünschte Einträge der Gruppen „Postfach“ und
   „Kalender und Ablage“ einschalten.

## Wie es im Alltag wirkt

- **Abruf:** Alle 15 Minuten (einstellbar) holt die App neue Mails in den **Eingang**. Beim ersten Abruf nur die letzten
  7 Tage. Im Postfach wird nichts verändert (nicht gelesen markiert, nicht verschoben).
- **Anhänge** landen beim Übernehmen als gelbe Dateien mit einheitlichem Namen an der Aufgabe.
- **Antworten:** Entwürfe, die über das Postfach gehen, tragen die Vorgangsnummer im Betreff (z. B. `[#42]`).
  Antworten darauf ordnet die App automatisch der Aufgabe zu und beendet „Wartet auf Zulieferung“.
- **Freigaben:** Entwürfe ins Postfach, Outlook-Termine und Kopien in die Ablage erscheinen unter
  Automatisierungen → Freigaben. Mehrere lassen sich auf einmal freigeben; jede wird einzeln protokolliert.

## Fehlersuche

| Meldung | Ursache |
| --- | --- |
| „Anmeldung bei Microsoft fehlgeschlagen: invalid_client“ | Geheimer Schlüssel falsch oder abgelaufen |
| „Access is denied. Check credentials and try again.“ | Postfach nicht in der Zugriffsrichtlinie (Schritt 5) oder Berechtigung ohne Administratorzustimmung |
| „Kein Ablageort eingestellt“ | Adminpanel → Verbindungen → Ablageort fehlt |
| Abruf läuft nicht | Automatisierung „Postfächer abrufen“ aus, oder kein Postfach eingetragen |

## Andere Anbieter

Ohne Microsoft 365 funktioniert der Eingang weiter über eingefügten Text und `.eml`-Dateien (aus Outlook, Thunderbird
oder Webmail gespeichert, inkl. Anhängen). Eine IMAP-Anbindung für andere Anbieter wäre eine Erweiterung nach demselben
Muster (`server/connectors/`).


## Optional: Mails direkt aus der App senden

Wer Entwürfe nach Prüfung direkt aus der App verschicken will (Adminpanel → Automatisierungen → „Mails nach Prüfung
direkt aus der App senden“), gibt der App-Registrierung zusätzlich das Anwendungsrecht **Mail.Send** und begrenzt es
wie die anderen Rechte per Exchange-Richtlinie auf die Funktionspostfächer. Gesendet wird nur, wenn ein Mensch den
Entwurf prüft, die Adressen einträgt und auf „Jetzt senden“ klickt – Regeln und Automatiken können nie senden.
Die Adressen werden nicht gespeichert, im Protokoll stehen nur Anzahl und Domains.
