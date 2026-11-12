# Betrieb

## Varianten

Die Technik-Details (Hosting) sind laut Lastenheft noch offen. Die App läuft überall, wo Node.js 22 läuft.

| Variante | Geeignet für | Hinweise |
| --- | --- | --- |
| **Eigener Rechner** (`npm start`) | Pilot mit zwei Power Usern im selben Netz, Ausprobieren | Nur erreichbar, solange der Rechner läuft. Standardmäßig nur lokal (`HOST=127.0.0.1`). |
| **Kleiner Server / VPS** (z. B. bei einem deutschen Anbieter) | Dauerbetrieb, Zugriff von unterwegs | Vor die App einen HTTPS-Proxy (Caddy oder nginx) setzen, siehe unten. Serverstandort in der EU wählen (DSGVO, Kap. 4). |
| **Raspberry Pi im Vereinsheim** | Günstiger Dauerbetrieb | Zugriff von außen nur über HTTPS-Proxy oder VPN. |

**Wichtig:** Ohne HTTPS nie über das Internet betreiben. Passwörter und Sitzungen würden sonst unverschlüsselt übertragen.

## Umgebungsvariablen

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `PORT` | `3000` | Port des Servers |
| `HOST` | `127.0.0.1` | `0.0.0.0`, wenn ein Proxy auf einem anderen Rechner davor sitzt |
| `DATA_DIR` | `data` | Ordner für Datenbank und Ablage |
| `SECURE_COOKIES` | aus | Auf `1` setzen, sobald die App hinter HTTPS läuft |
| `SESSION_DAYS` | `30` | Wie lange eine Anmeldung gilt |
| `MAX_UPLOAD_MB` | `25` | Größte Datei in der Ablage |
| `DISABLE_SCHEDULER` | aus | `1` schaltet Erinnerungen und Regeln ab (nur für Tests) |

## Beispiel: Server mit Caddy (HTTPS automatisch)

```
# /etc/caddy/Caddyfile
ehrenamt.example.de {
  reverse_proxy 127.0.0.1:3000
}
```

Dienst für die App (systemd, `/etc/systemd/system/ehrenamt.service`):

```
[Unit]
Description=Ehrenamt Tischtennis
After=network.target

[Service]
WorkingDirectory=/opt/ehrenamt
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/index.js
Environment=SECURE_COOKIES=1
Restart=always
User=ehrenamt

[Install]
WantedBy=multi-user.target
```

## Sicherung

```bash
npm run backup
```

Das erzeugt `backups/<Zeitstempel>/` mit einer konsistenten Kopie der Datenbank und der Ablage.
Es funktioniert auch bei laufendem Server. Empfehlung: täglich per Zeitplan (Aufgabenplanung bzw. cron)
und die Sicherungen zusätzlich an einen zweiten Ort kopieren (z. B. Vereins-OneDrive).

Die Datei `.env` (Zugangsdaten für Microsoft 365) ist bewusst **nicht** Teil der Sicherung. Sie liegt nur auf dem Server; bei einem Umzug den geheimen Schlüssel lieber neu erzeugen als kopieren.

**Wiederherstellen:** Server stoppen, `data/ehrenamt.sqlite` und `data/ablage/` durch die Sicherung
ersetzen, Server starten.

## Updates

1. Sicherung erstellen (`npm run backup`).
2. Neue Programmdateien einspielen (alles außer `data/`).
3. Server neu starten. Neue Datenbank-Migrationen laufen beim Start automatisch.

## Notfälle

| Lage | Vorgehen |
| --- | --- |
| Gerät verloren | Adminpanel → Konten → „Sitzungen beenden“ für die Person. Danach Passwort zurücksetzen. |
| Kein Admin kann sich anmelden | Auf dem Server `npm run passwort-zuruecksetzen -- <anmeldename>` ausführen. |
| Kalender-Abo-Link weitergegeben | Kalender → Kalender-Abo → „Link erneuern“. Der alte Link ist sofort ungültig. |
| Person scheidet aus dem Amt aus | Adminpanel → Konten → „Sperren“. Sitzungen enden sofort; Ämter werden frei; Aufgaben bleiben sichtbar. |

## Löschfristen

Für Anhänge mit gelben Daten lässt sich unter Einstellungen eine Löschfrist (Tage nach Abschluss des
Vorgangs) setzen. Sie ist standardmäßig aus, bis die Datenschutzfrage geklärt ist (siehe OFFENE-PUNKTE.md).
Das Protokoll selbst wird nie gelöscht; es enthält nur Kurzbeschreibungen, keine Dateiinhalte.
