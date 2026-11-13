// Datenbank: SQLite über das in Node eingebaute Modul node:sqlite.
// Das Schema wird über nummerierte Migrationen aufgebaut (PRAGMA user_version).
// Neue Änderungen am Schema immer als NEUE Migration unten anhängen, nie alte ändern.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const MIGRATIONS = [
  // 1: Grundschema
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    login         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pw_hash       TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin','zuarbeit')),
    active        INTEGER NOT NULL DEFAULT 1,
    must_change_pw INTEGER NOT NULL DEFAULT 0,
    seen_changelog_id INTEGER NOT NULL DEFAULT 0,
    calendar_token TEXT,
    created_at    TEXT NOT NULL,
    deactivated_at TEXT
  );

  CREATE TABLE sessions (
    id          INTEGER PRIMARY KEY,
    token_hash  TEXT NOT NULL UNIQUE,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL,
    last_seen   TEXT NOT NULL,
    user_agent  TEXT,
    ip          TEXT
  );

  -- Bereiche: je Verein einer, dazu der Bezirk (ROL-1, NFA-8)
  CREATE TABLE areas (
    id     INTEGER PRIMARY KEY,
    key    TEXT NOT NULL UNIQUE,
    name   TEXT NOT NULL,
    type   TEXT NOT NULL CHECK (type IN ('verein','bezirk')),
    color  TEXT NOT NULL DEFAULT '#2563eb',
    active INTEGER NOT NULL DEFAULT 1
  );

  -- Zugriff von Nutzern auf Bereiche (Admins sehen immer alles)
  CREATE TABLE user_areas (
    user_id INTEGER NOT NULL REFERENCES users(id),
    area_id INTEGER NOT NULL REFERENCES areas(id),
    PRIMARY KEY (user_id, area_id)
  );

  -- Ämter je Bereich
  CREATE TABLE offices (
    id      INTEGER PRIMARY KEY,
    area_id INTEGER NOT NULL REFERENCES areas(id),
    name    TEXT NOT NULL,
    holder_id INTEGER REFERENCES users(id),
    deputy_id INTEGER REFERENCES users(id),
    UNIQUE (area_id, name)
  );

  -- Vorgangstypen / Vorgangsvorlagen (AUF-3, AUF-14, AUT-1, VOR-1..15)
  CREATE TABLE process_templates (
    id          INTEGER PRIMARY KEY,
    key         TEXT UNIQUE,
    name        TEXT NOT NULL,
    scope       TEXT NOT NULL DEFAULT 'verein' CHECK (scope IN ('verein','bezirk','beide')),
    office_name TEXT,
    summary     TEXT NOT NULL DEFAULT '',
    guide       TEXT NOT NULL DEFAULT '',
    max_level   INTEGER NOT NULL DEFAULT 1 CHECK (max_level BETWEEN 0 AND 4),
    never_execute INTEGER NOT NULL DEFAULT 0,
    data_class  TEXT NOT NULL DEFAULT 'gruen' CHECK (data_class IN ('gruen','gelb')),
    minors      INTEGER NOT NULL DEFAULT 0,
    baseline_minutes INTEGER,
    source_ref  TEXT,
    version     INTEGER NOT NULL DEFAULT 1,
    active      INTEGER NOT NULL DEFAULT 1,
    updated_at  TEXT NOT NULL,
    updated_by  INTEGER REFERENCES users(id)
  );

  CREATE TABLE process_steps (
    id          INTEGER PRIMARY KEY,
    template_id INTEGER NOT NULL REFERENCES process_templates(id) ON DELETE CASCADE,
    pos         INTEGER NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    manual      INTEGER NOT NULL DEFAULT 0,      -- 1 = muss außerhalb der App von Hand erledigt werden
    text_template_id INTEGER REFERENCES text_templates(id),
    calc        TEXT                              -- optionaler Rechner (siehe server/calc.js)
  );

  -- Textvorlagen mit Variablen (ABL-3, AUT-5)
  CREATE TABLE text_templates (
    id         INTEGER PRIMARY KEY,
    key        TEXT UNIQUE,
    area_id    INTEGER REFERENCES areas(id),   -- NULL = für alle Bereiche teilbar (DAT-8)
    name       TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT 'Allgemein',
    kind       TEXT NOT NULL DEFAULT 'mail' CHECK (kind IN ('mail','dokument','text')),
    subject    TEXT NOT NULL DEFAULT '',
    body       TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    version    INTEGER NOT NULL DEFAULT 1,
    active     INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id)
  );

  -- Versionsstände von Regeln und Vorlagen (ABL-4): die Tabelle oben enthält
  -- immer die eine gültige Version, hier liegen die abgelösten Stände.
  CREATE TABLE versions (
    id         INTEGER PRIMARY KEY,
    entity     TEXT NOT NULL,
    entity_id  INTEGER NOT NULL,
    version    INTEGER NOT NULL,
    snapshot   TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id)
  );

  -- Update-Fenster (ABL-5)
  CREATE TABLE changelog (
    id         INTEGER PRIMARY KEY,
    entity     TEXT NOT NULL,
    entity_id  INTEGER,
    title      TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    version    INTEGER,
    created_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id)
  );

  -- Jahreskalender / wiederkehrende Aufgaben (AUF-4, AUF-5)
  CREATE TABLE recurring (
    id          INTEGER PRIMARY KEY,
    area_id     INTEGER NOT NULL REFERENCES areas(id),
    office_id   INTEGER REFERENCES offices(id),
    template_id INTEGER REFERENCES process_templates(id),
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    freq        TEXT NOT NULL CHECK (freq IN ('jaehrlich','halbjaehrlich','quartalsweise','monatlich','woechentlich')),
    month       INTEGER,     -- 1..12 (jährlich / halbjährlich: erster Monat)
    day         INTEGER,     -- Tag im Monat bzw. Wochentag 1..7 bei wöchentlich
    lead_days   INTEGER NOT NULL DEFAULT 14,  -- so viele Tage vor Fälligkeit wird die Aufgabe angelegt
    owner_id    INTEGER REFERENCES users(id),
    assumption  INTEGER NOT NULL DEFAULT 0,   -- 1 = Datum ist Annahme, bitte prüfen
    active      INTEGER NOT NULL DEFAULT 1,
    last_due    TEXT          -- letzte Fälligkeit, für die eine Aufgabe angelegt wurde
  );

  -- Aufgaben (AUF-1, AUF-2); kind = 'idee' für den Ideenspeicher (AUF-8)
  CREATE TABLE tasks (
    id           INTEGER PRIMARY KEY,
    kind         TEXT NOT NULL DEFAULT 'aufgabe' CHECK (kind IN ('aufgabe','idee')),
    area_id      INTEGER NOT NULL REFERENCES areas(id),
    office_id    INTEGER REFERENCES offices(id),
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    owner_id     INTEGER REFERENCES users(id),
    deputy_id    INTEGER REFERENCES users(id),
    due_date     TEXT,
    status       TEXT NOT NULL DEFAULT 'offen'
                 CHECK (status IN ('offen','in_arbeit','wartet','erledigt','verworfen')),
    waiting_who  TEXT,
    waiting_what TEXT,
    channel      TEXT NOT NULL DEFAULT 'manuell',
    data_class   TEXT NOT NULL DEFAULT 'gruen' CHECK (data_class IN ('gruen','gelb')),
    level        INTEGER NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 4),
    template_id  INTEGER REFERENCES process_templates(id),
    template_version INTEGER,
    recurring_id INTEGER REFERENCES recurring(id),
    parent_source TEXT,          -- Herkunft, z. B. 'asana:123' oder 'eingang:5'
    lessons      TEXT NOT NULL DEFAULT '',  -- Notizen und Stolpersteine für den nächsten Durchlauf
    priority     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    created_by   INTEGER REFERENCES users(id),
    started_at   TEXT,           -- erste Bearbeitung -> Liegezeit (AUF-10)
    completed_at TEXT,           -- Abschluss -> Durchlaufzeit (AUF-10)
    last_activity_at TEXT NOT NULL,
    last_reminded_at TEXT
  );
  CREATE INDEX idx_tasks_area ON tasks(area_id, status);
  CREATE INDEX idx_tasks_owner ON tasks(owner_id, status);
  CREATE INDEX idx_tasks_due ON tasks(due_date);

  CREATE TABLE task_steps (
    id          INTEGER PRIMARY KEY,
    task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    pos         INTEGER NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    manual      INTEGER NOT NULL DEFAULT 0,
    text_template_id INTEGER REFERENCES text_templates(id),
    calc        TEXT,
    done        INTEGER NOT NULL DEFAULT 0,
    done_by     INTEGER REFERENCES users(id),
    done_at     TEXT,
    note        TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE comments (
    id         INTEGER PRIMARY KEY,
    task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id),
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Erfasste Minuten (AUF-10, ABN-4)
  CREATE TABLE time_entries (
    id         INTEGER PRIMARY KEY,
    task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id),
    minutes    INTEGER NOT NULL CHECK (minutes > 0),
    note       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  -- Ablage (ABL-1, ABL-2, DAT-1)
  CREATE TABLE files (
    id          INTEGER PRIMARY KEY,
    area_id     INTEGER NOT NULL REFERENCES areas(id),
    task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    filename    TEXT NOT NULL,     -- einheitlicher Name "JJJJ-MM-TT - Aussteller - Anlass.ext"
    original_name TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    sha256      TEXT NOT NULL,
    doc_date    TEXT,
    issuer      TEXT NOT NULL DEFAULT '',
    occasion    TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT '',
    data_class  TEXT NOT NULL CHECK (data_class IN ('gruen','gelb')),
    text_content TEXT NOT NULL DEFAULT '',
    uploaded_by INTEGER REFERENCES users(id),
    created_at  TEXT NOT NULL,
    deleted_at  TEXT
  );

  -- Entwürfe (AUT-5, AUT-7, AUT-14): Mails entstehen nur als Entwurf
  CREATE TABLE drafts (
    id          INTEGER PRIMARY KEY,
    task_id     INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    area_id     INTEGER NOT NULL REFERENCES areas(id),
    template_id INTEGER REFERENCES text_templates(id),
    template_version INTEGER,
    kind        TEXT NOT NULL DEFAULT 'mail',
    subject     TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL DEFAULT '',
    recipients  TEXT NOT NULL DEFAULT '[]',  -- nur Namen (AUT-9)
    status      TEXT NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf','uebernommen','verworfen')),
    warnings    TEXT NOT NULL DEFAULT '[]',
    created_by  INTEGER REFERENCES users(id),
    created_by_rule INTEGER REFERENCES rules(id),
    created_at  TEXT NOT NULL,
    taken_at    TEXT,
    taken_by    INTEGER REFERENCES users(id)
  );

  -- Automatisierungsregeln (AUT-1..3, AUT-13)
  CREATE TABLE rules (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    area_id       INTEGER REFERENCES areas(id),
    template_id   INTEGER REFERENCES process_templates(id),
    trigger_type  TEXT NOT NULL CHECK (trigger_type IN ('zeitplan','frist','eingang','statuswechsel','manuell')),
    trigger_config TEXT NOT NULL DEFAULT '{}',
    action_type   TEXT NOT NULL,
    action_config TEXT NOT NULL DEFAULT '{}',
    level         INTEGER NOT NULL CHECK (level BETWEEN 0 AND 4),
    approved      INTEGER NOT NULL DEFAULT 0,     -- Freigabe der Regel durch einen Admin (ROL-3)
    approved_by   INTEGER REFERENCES users(id),
    approved_at   TEXT,
    active        INTEGER NOT NULL DEFAULT 0,
    version       INTEGER NOT NULL DEFAULT 1,
    last_run_at   TEXT,
    created_by    INTEGER REFERENCES users(id),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  -- Läufe von Regeln
  CREATE TABLE rule_runs (
    id         INTEGER PRIMARY KEY,
    rule_id    INTEGER REFERENCES rules(id) ON DELETE SET NULL,
    started_at TEXT NOT NULL,
    trigger    TEXT NOT NULL,
    outcome    TEXT NOT NULL,   -- ok | freigabe_angefragt | gesperrt | fehler | nichts_zu_tun
    detail     TEXT NOT NULL DEFAULT '',
    started_by INTEGER REFERENCES users(id)
  );

  -- Freigaben für Ausführungen ab Stufe 3 (AUT-6, AUT-7, ABN-6)
  CREATE TABLE approvals (
    id          INTEGER PRIMARY KEY,
    rule_id     INTEGER REFERENCES rules(id) ON DELETE SET NULL,
    task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    area_id     INTEGER REFERENCES areas(id),
    action_type TEXT NOT NULL,
    payload     TEXT NOT NULL,
    summary     TEXT NOT NULL,
    recipients  TEXT NOT NULL DEFAULT '[]',
    status      TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','freigegeben','abgelehnt','ausgefuehrt','fehler')),
    requested_at TEXT NOT NULL,
    requested_by INTEGER REFERENCES users(id),
    decided_at  TEXT,
    decided_by  INTEGER REFERENCES users(id),
    decision_note TEXT NOT NULL DEFAULT '',
    result      TEXT NOT NULL DEFAULT ''
  );

  -- Termine (AUF-11; Kalendereinträge nach Freigabe = Stufe 3)
  CREATE TABLE events (
    id         INTEGER PRIMARY KEY,
    area_id    INTEGER NOT NULL REFERENCES areas(id),
    task_id    INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    title      TEXT NOT NULL,
    date       TEXT NOT NULL,
    time       TEXT,
    end_time   TEXT,
    location   TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    in_feed    INTEGER NOT NULL DEFAULT 1,
    approval_id INTEGER REFERENCES approvals(id),
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );

  -- Eingang: Mails, WhatsApp, Post als Aufgabenvorschläge (AUT-4, AUT-10)
  CREATE TABLE inbox (
    id          INTEGER PRIMARY KEY,
    area_id     INTEGER REFERENCES areas(id),
    channel     TEXT NOT NULL,
    sender      TEXT NOT NULL DEFAULT '',
    subject     TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL DEFAULT '',
    received_at TEXT NOT NULL,
    suggestion  TEXT NOT NULL DEFAULT '{}',
    flags       TEXT NOT NULL DEFAULT '[]',
    status      TEXT NOT NULL DEFAULT 'neu' CHECK (status IN ('neu','uebernommen','abgelegt')),
    task_id     INTEGER REFERENCES tasks(id),
    created_by  INTEGER REFERENCES users(id),
    created_at  TEXT NOT NULL
  );

  -- Wissensbasis (VOR-11, AUT-11, NFA-11): nur grüne Daten (DAT-2)
  CREATE TABLE kb_documents (
    id          INTEGER PRIMARY KEY,
    area_id     INTEGER REFERENCES areas(id),   -- NULL = Regelwissen für alle (DAT-8)
    title       TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('satzung','ordnung','beschluss','formular','website','sonstiges')),
    valid_from  TEXT,
    notes       TEXT NOT NULL DEFAULT '',
    version     INTEGER NOT NULL DEFAULT 1,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    created_by  INTEGER REFERENCES users(id),
    updated_at  TEXT NOT NULL
  );
  CREATE TABLE kb_sections (
    id          INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
    pos         INTEGER NOT NULL,
    reference   TEXT NOT NULL DEFAULT '',  -- Fundstelle: Paragraph, Seite, Beschluss
    heading     TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL,
    assumption  INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE kb_questions (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id),
    area_id    INTEGER REFERENCES areas(id),
    question   TEXT NOT NULL,
    answer_refs TEXT NOT NULL DEFAULT '[]',
    verified   INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Lernprotokoll (AUT-15)
  CREATE TABLE learnings (
    id          INTEGER PRIMARY KEY,
    date        TEXT NOT NULL,
    topic       TEXT NOT NULL,
    rule        TEXT NOT NULL,
    origin      TEXT NOT NULL DEFAULT '',
    template_id INTEGER REFERENCES process_templates(id),
    area_id     INTEGER REFERENCES areas(id),
    active      INTEGER NOT NULL DEFAULT 1,
    created_by  INTEGER REFERENCES users(id),
    created_at  TEXT NOT NULL
  );

  -- Hilfe und FAQ (NFA-7)
  CREATE TABLE faq (
    id         INTEGER PRIMARY KEY,
    category   TEXT NOT NULL DEFAULT 'Allgemein',
    question   TEXT NOT NULL,
    answer     TEXT NOT NULL,
    pos        INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  -- Systemlandkarte (DAT-7)
  CREATE TABLE systems (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    purpose    TEXT NOT NULL DEFAULT '',
    leading_data TEXT NOT NULL DEFAULT '',
    access     TEXT NOT NULL DEFAULT '',
    export_path TEXT NOT NULL DEFAULT '',
    account    TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    pos        INTEGER NOT NULL DEFAULT 0
  );

  -- Benachrichtigungen / Erinnerungen (AUF-7, AUF-8)
  CREATE TABLE notifications (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    task_id    INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    read_at    TEXT
  );
  CREATE INDEX idx_notif_user ON notifications(user_id, read_at);

  -- Berichte, z. B. wöchentliche Übersicht (AUT-13)
  CREATE TABLE reports (
    id         INTEGER PRIMARY KEY,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL,
    rule_id    INTEGER REFERENCES rules(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  -- Ergebnisse von Berechnungen mit Rechenweg (AUT-12)
  CREATE TABLE calculations (
    id         INTEGER PRIMARY KEY,
    task_id    INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    calc       TEXT NOT NULL,
    input      TEXT NOT NULL,
    result     TEXT NOT NULL,
    steps      TEXT NOT NULL,
    user_id    INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );

  -- Protokoll aller Vorgänge und Freigaben (AUF-13, NFA-2). Nur anhängen, nie ändern.
  CREATE TABLE audit_log (
    id        INTEGER PRIMARY KEY,
    at        TEXT NOT NULL,
    user_id   INTEGER REFERENCES users(id),
    user_name TEXT,
    area_id   INTEGER,
    entity    TEXT NOT NULL,
    entity_id INTEGER,
    action    TEXT NOT NULL,
    summary   TEXT NOT NULL,
    detail    TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
  CREATE INDEX idx_audit_at ON audit_log(at);
  CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'Das Protokoll ist unveränderlich.'); END;
  CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'Das Protokoll ist unveränderlich.'); END;

  -- Einstellungen (Schlüssel/Wert)
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,

  // 2: Verbindungen (Microsoft 365, Spielpläne), Sponsoren, Eskalation
  `
  ALTER TABLE inbox ADD COLUMN external_id TEXT;
  ALTER TABLE inbox ADD COLUMN mailbox TEXT;
  ALTER TABLE inbox ADD COLUMN conversation_id TEXT;
  ALTER TABLE inbox ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';   -- [{name, size, mime, stored}]
  CREATE UNIQUE INDEX idx_inbox_ext ON inbox(external_id) WHERE external_id IS NOT NULL;

  ALTER TABLE drafts ADD COLUMN remote_id TEXT;          -- Entwurf im Postfach (Microsoft 365)
  ALTER TABLE drafts ADD COLUMN conversation_id TEXT;    -- für die Zuordnung von Antworten
  ALTER TABLE drafts ADD COLUMN mailbox TEXT;

  ALTER TABLE files ADD COLUMN remote_url TEXT;          -- Kopie in SharePoint/OneDrive
  ALTER TABLE files ADD COLUMN remote_synced_at TEXT;

  ALTER TABLE events ADD COLUMN source TEXT NOT NULL DEFAULT 'app';   -- app | spielplan
  ALTER TABLE events ADD COLUMN feed_id INTEGER;
  ALTER TABLE events ADD COLUMN external_uid TEXT;
  ALTER TABLE events ADD COLUMN remote_id TEXT;          -- Termin im Outlook-Kalender
  CREATE UNIQUE INDEX idx_events_feed ON events(feed_id, external_uid) WHERE feed_id IS NOT NULL;

  ALTER TABLE tasks ADD COLUMN escalated_at TEXT;

  -- Spielplan-Abos (ICS aus click-TT/nuLiga oder anderen Kalendern), nur lesend
  CREATE TABLE feeds (
    id            INTEGER PRIMARY KEY,
    area_id       INTEGER NOT NULL REFERENCES areas(id),
    name          TEXT NOT NULL,
    url           TEXT NOT NULL,
    home_pattern  TEXT NOT NULL DEFAULT '',   -- woran ein Heimspiel erkennbar ist (Vereinsname vorne oder im Ort)
    create_tasks  INTEGER NOT NULL DEFAULT 0, -- Aufgaben für Heimspiele anlegen
    template_id   INTEGER REFERENCES process_templates(id),
    lead_days     INTEGER NOT NULL DEFAULT 10,
    owner_id      INTEGER REFERENCES users(id),
    active        INTEGER NOT NULL DEFAULT 1,
    last_fetch_at TEXT,
    last_status   TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL
  );

  -- Sponsorenregister (VOR-6): nur Firmen, Ansprechpartner nur mit Namen
  CREATE TABLE sponsors (
    id            INTEGER PRIMARY KEY,
    area_id       INTEGER NOT NULL REFERENCES areas(id),
    company       TEXT NOT NULL,
    contact_name  TEXT NOT NULL DEFAULT '',
    godparent_id  INTEGER REFERENCES users(id),   -- Pate / Patin im Verein
    category      TEXT NOT NULL DEFAULT '',       -- z. B. Bande, Trikot, Jugend, Förderer
    start_date    TEXT,
    end_date      TEXT,
    status        TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv','verhandlung','beendet')),
    notes         TEXT NOT NULL DEFAULT '',
    last_contact  TEXT,
    reminded_for  TEXT,                           -- Laufzeitende, für das schon eine Aufgabe angelegt wurde
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
  `,

  // 3: KI-Assistent für Automatisierungen (Claude)
  `
  CREATE TABLE ki_requests (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER REFERENCES users(id),
    mode          TEXT NOT NULL CHECK (mode IN ('beschreibung','ideen')),
    prompt        TEXT NOT NULL,              -- bereinigte Eingabe, so wie sie an Claude ging
    sent_context  TEXT NOT NULL DEFAULT '',   -- welche Daten zusätzlich übertragen wurden (Zusammenfassung)
    response      TEXT NOT NULL DEFAULT '{}', -- strukturierte Antwort von Claude
    checks        TEXT NOT NULL DEFAULT '[]', -- Prüfergebnis je Vorschlag
    applied       TEXT NOT NULL DEFAULT '{}', -- { index: "regel:12" | "katalog" }
    model         TEXT NOT NULL,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL CHECK (status IN ('ok','abgelehnt','fehler')),
    error         TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL
  );
  `,

  // 4: Themen-Ordner in der Ablage, Eingangs- und Ablageregeln
  `
  ALTER TABLE files ADD COLUMN folder TEXT NOT NULL DEFAULT '';        -- z. B. "Rechnungen" oder "Sponsoring/Verträge"
  CREATE INDEX idx_files_folder ON files(area_id, folder);
  ALTER TABLE inbox ADD COLUMN sender_domain TEXT NOT NULL DEFAULT '';  -- nur die Domain (z. B. gemeinde.de), für Regeln

  CREATE TABLE filing_rules (
    id                INTEGER PRIMARY KEY,
    name              TEXT NOT NULL,
    pos               INTEGER NOT NULL DEFAULT 100,   -- Reihenfolge: die erste passende Regel gewinnt
    active            INTEGER NOT NULL DEFAULT 1,
    -- Bedingungen (leer = egal; mehrere Begriffe mit Komma = einer davon genügt)
    area_id           INTEGER REFERENCES areas(id),   -- nur Eingänge dieses Bereichs
    sender_contains   TEXT NOT NULL DEFAULT '',
    subject_contains  TEXT NOT NULL DEFAULT '',
    filename_contains TEXT NOT NULL DEFAULT '',
    file_types        TEXT NOT NULL DEFAULT '',       -- z. B. "pdf, docx"
    -- Ergebnis
    target_area_id    INTEGER REFERENCES areas(id),   -- leer = Bereich des Eingangs
    folder            TEXT NOT NULL DEFAULT '',
    data_class        TEXT NOT NULL DEFAULT 'gelb' CHECK (data_class IN ('gruen','gelb')),
    occasion          TEXT NOT NULL DEFAULT '',       -- Anlass im Dateinamen; {{betreff}} {{datei}} {{absender}} erlaubt
    tags              TEXT NOT NULL DEFAULT '',
    mode              TEXT NOT NULL DEFAULT 'vormerken' CHECK (mode IN ('ablegen','aufgabe','vormerken')),
    template_id       INTEGER REFERENCES process_templates(id),
    office_id         INTEGER REFERENCES offices(id),
    mirror            INTEGER NOT NULL DEFAULT 0,     -- Kopie nach SharePoint vorschlagen (Freigabe nötig)
    dismiss_mail      INTEGER NOT NULL DEFAULT 0,     -- bei „ablegen“: Mail danach aus dem Eingang nehmen
    hits              INTEGER NOT NULL DEFAULT 0,
    last_hit_at       TEXT,
    origin            TEXT NOT NULL DEFAULT '',       -- z. B. "KI-Vorschlag #3"
    created_by        INTEGER REFERENCES users(id),
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );
  `,
];

let db;

export function openDb(file = config.dbFile) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(d) {
  const current = d.prepare('PRAGMA user_version').get().user_version;
  for (let i = current; i < MIGRATIONS.length; i++) {
    d.exec('BEGIN');
    try {
      d.exec(MIGRATIONS[i]);
      d.exec(`PRAGMA user_version = ${i + 1}`);
      d.exec('COMMIT');
    } catch (err) {
      d.exec('ROLLBACK');
      throw new Error(`Migration ${i + 1} fehlgeschlagen: ${err.message}`);
    }
  }
}

export function getDb() {
  if (!db) throw new Error('Datenbank ist nicht geöffnet.');
  return db;
}

// Kurzformen für häufige Abfragen
export const q = {
  get: (sql, ...p) => getDb().prepare(sql).get(...p),
  all: (sql, ...p) => getDb().prepare(sql).all(...p),
  run: (sql, ...p) => getDb().prepare(sql).run(...p),
};

// Führt fn in einer Transaktion aus. Verschachtelte Aufrufe laufen in der äußeren mit.
let depth = 0;
export function tx(fn) {
  const d = getDb();
  if (depth > 0) return fn();
  depth++;
  d.exec('BEGIN');
  try {
    const r = fn();
    d.exec('COMMIT');
    return r;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}

export function getSetting(key, fallback = null) {
  const row = q.get('SELECT value FROM settings WHERE key = ?', key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export function setSetting(key, value) {
  q.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key, JSON.stringify(value));
}
