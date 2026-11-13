// Vorstandsarbeit-Simulator: der Demo-Verein. Alle Namen, Adressen und Firmen sind erfunden
// (Domains auf .example sind dafür reserviert). Weil nur Fantasiedaten im Spiel sind, sind im
// Simulator beide Datenschutz-Schalter an und der Automatisierungskatalog voll eingeschaltet.

import crypto from 'node:crypto';
import { q, setSetting, getSetting } from '../db.js';
import { hashPassword, randomToken } from '../auth.js';
import { createTask } from '../services/tasks.js';
import { CATALOG, updateCatalog } from '../services/catalog.js';
import { addDays, nowIso, today } from '../util.js';
import { clockNow } from '../clock.js';

export const SIM_AREAS = [
  { key: 'ttv-musterhausen', name: 'TTV Musterhausen', type: 'verein', color: '#2563eb' },
  { key: 'sv-beispieldorf', name: 'SV Beispieldorf (Abt. Tischtennis)', type: 'verein', color: '#0d9488' },
  { key: 'bezirk-musterkreis', name: 'Bezirk Musterkreis', type: 'bezirk', color: '#9333ea' },
];

export const MAILBOX = {
  ttv: 'vorstand@ttv-musterhausen.example',
  sv: 'tischtennis@sv-beispieldorf.example',
  bezirk: 'bezirk@tt-musterkreis.example',
};

export const PEOPLE = [
  { login: 'mia', name: 'Mia Muster', role: 'admin', text: 'Vorsitzende TTV Musterhausen' },
  { login: 'ben', name: 'Ben Beispiel', role: 'admin', text: 'Kassenwart TTV, Abteilungsleiter SV Beispieldorf' },
  { login: 'tom', name: 'Tom Turnier', role: 'admin', text: 'Bezirkssportwart und Schiedsrichterwart' },
  { login: 'jana', name: 'Jana Jugend', role: 'zuarbeit', text: 'Jugendwartin TTV (Zuarbeit)' },
  { login: 'paul', name: 'Paul Presse', role: 'zuarbeit', text: 'Öffentlichkeitsarbeit TTV (Zuarbeit)' },
];

export const OPPONENTS = ['SV Nachbarort', 'TTC Hügelhausen', 'DJK Talstadt', 'TSV Flussdorf', 'TTF Bergheim', 'SpVgg Weiler', 'TV Ackerland', 'TTG Seeblick'];
export const HALL = 'Sporthalle Musterhausen, Schulstraße 1';

export const area = (key) => q.get('SELECT id FROM areas WHERE key = ?', key)?.id;
export const user = (login) => q.get('SELECT * FROM users WHERE login = ?', login);
export const tpl = (key) => q.get('SELECT id FROM process_templates WHERE key = ?', key)?.id ?? null;
export const office = (areaKey, name) => q.get('SELECT * FROM offices WHERE area_id = ? AND name = ?', area(areaKey), name);

/** Nächster Wochentag (0 = So … 6 = Sa) ab einem Datum, mindestens `min` Tage später. */
export function nextWeekday(from, weekday, min = 0) {
  let d = addDays(from, min);
  for (let i = 0; i < 7; i++) {
    if (new Date(d + 'T12:00:00Z').getUTCDay() === weekday) return d;
    d = addDays(d, 1);
  }
  return d;
}

/** Spielpläne für eine Saison ab dem Startdatum (abwechselnd Heim und Auswärts). */
export function makeSeason(start) {
  const games = [];
  let sat = nextWeekday(start, 6, 3);
  for (let i = 0; i < 14; i++) {
    const opp = OPPONENTS[i % OPPONENTS.length];
    const home = i % 2 === 0;
    games.push({ uid: `sim-h1-${i}`, team: 'herren1', date: sat, time: '18:00',
      summary: home ? `TTV Musterhausen – ${opp}` : `${opp} – TTV Musterhausen`, location: home ? HALL : `Halle ${opp}` });
    const sun = addDays(sat, 1);
    const opp2 = OPPONENTS[(i + 3) % OPPONENTS.length];
    games.push({ uid: `sim-j15-${i}`, team: 'jugend', date: sun, time: '10:00',
      summary: !home ? `TTV Musterhausen U15 – ${opp2} U15` : `${opp2} U15 – TTV Musterhausen U15`, location: !home ? HALL : `Halle ${opp2}` });
    sat = addDays(sat, 7);
  }
  return games;
}

const SATZUNG = `§ 1 Name und Sitz
Der Verein führt den Namen „Tischtennisverein Musterhausen e. V.“ (TTV Musterhausen) und hat seinen Sitz in Musterhausen.

§ 2 Zweck
Zweck des Vereins ist die Förderung des Sports, insbesondere des Tischtennissports, und der Jugendarbeit. Der Verein ist selbstlos tätig.

§ 3 Mitgliedschaft
Mitglied kann jede natürliche Person werden. Über den schriftlichen Aufnahmeantrag entscheidet der Vorstand. Bei Minderjährigen ist die Unterschrift der Erziehungsberechtigten erforderlich. Mit dem Antrag ist ein SEPA-Lastschriftmandat zu erteilen.

§ 4 Austritt
Der Austritt erfolgt durch schriftliche Erklärung gegenüber dem Vorstand. Er ist nur zum Ende eines Kalenderjahres unter Einhaltung einer Frist von drei Monaten zulässig.

§ 5 Beiträge
Die Höhe der Beiträge regelt die Beitragsordnung, die die Mitgliederversammlung beschließt. Der Beitrag wird jährlich im Februar per Lastschrift eingezogen.

§ 6 Organe
Organe des Vereins sind die Mitgliederversammlung und der Vorstand.

§ 7 Mitgliederversammlung
Die ordentliche Mitgliederversammlung findet einmal jährlich im ersten Quartal statt. Sie wird vom Vorstand mindestens drei Wochen vorher in Textform unter Angabe der Tagesordnung einberufen. Anträge zur Tagesordnung sind spätestens eine Woche vor der Versammlung beim Vorstand einzureichen.

§ 8 Vorstand
Der Vorstand besteht aus der oder dem Vorsitzenden, der Stellvertretung, dem Kassenwart, dem Sportwart und dem Jugendwart. Je zwei Vorstandsmitglieder vertreten den Verein gemeinsam. Scheidet ein Vorstandsmitglied vorzeitig aus, kann der Vorstand bis zur nächsten Mitgliederversammlung einen Nachfolger kommissarisch bestimmen.

§ 9 Kassenprüfung
Die Mitgliederversammlung wählt zwei Kassenprüfer für zwei Jahre. Sie prüfen die Kasse einschließlich aller Belege mindestens einmal jährlich und berichten der Mitgliederversammlung.

§ 10 Datenschutz
Der Verein verarbeitet personenbezogene Daten seiner Mitglieder nur zur Erfüllung des Vereinszwecks. Jedes Mitglied hat das Recht auf Auskunft über die zu seiner Person gespeicherten Daten; die Auskunft ist innerhalb eines Monats zu erteilen.

§ 11 Auflösung
Bei Auflösung des Vereins fällt das Vermögen an die Gemeinde Musterhausen, die es für die Förderung des Sports zu verwenden hat.`;

const BEITRAGSORDNUNG = `§ 1 Beiträge
Kinder und Jugendliche bis 17 Jahre zahlen 60 € im Jahr, Erwachsene 120 € im Jahr, Familien 200 € im Jahr.

§ 2 Wechsel der Beitragsstufe
Der Wechsel in die Erwachsenen-Stufe erfolgt zum 1. Januar des Jahres, in dem das Mitglied 18 Jahre alt wird. Das Mitglied wird vorher schriftlich informiert.

§ 3 Ermäßigung
Auf Antrag kann der Vorstand Beiträge für Schüler, Studierende und Auszubildende ermäßigen.`;

/** Legt den Demo-Verein an (nur beim ersten Start). Gibt das Passwort zurück, falls neu angelegt. */
export function seedWorld({ fakeBase, client }) {
  if (getSetting('sim_welt', null)) return null;
  const pw = `Sim-${crypto.randomBytes(4).toString('hex')}-Netzball!`;
  const ids = {};
  for (const p of PEOPLE) {
    ids[p.login] = Number(q.run(`INSERT INTO users (name, login, pw_hash, role, created_at, calendar_token, must_change_pw) VALUES (?, ?, ?, ?, ?, ?, 0)`,
      p.name, p.login, hashPassword(pw), p.role, nowIso(), randomToken()).lastInsertRowid);
  }
  const A = { ttv: area('ttv-musterhausen'), sv: area('sv-beispieldorf'), bezirk: area('bezirk-musterkreis') };
  for (const z of ['jana', 'paul']) q.run('INSERT INTO user_areas (user_id, area_id) VALUES (?, ?)', ids[z], A.ttv);
  // Ämter: Grundbesetzung, dann die Fachämter
  q.run('UPDATE offices SET holder_id = ?, deputy_id = ? WHERE area_id = ?', ids.mia, ids.ben, A.ttv);
  q.run('UPDATE offices SET holder_id = ?, deputy_id = ? WHERE area_id = ?', ids.ben, ids.mia, A.sv);
  q.run('UPDATE offices SET holder_id = ?, deputy_id = ? WHERE area_id = ?', ids.tom, ids.mia, A.bezirk);
  const setOffice = (areaId, name, holder, deputy) => q.run('UPDATE offices SET holder_id = ?, deputy_id = ? WHERE area_id = ? AND name = ?', holder, deputy, areaId, name);
  setOffice(A.ttv, 'Kasse', ids.ben, null);           // bewusst ohne Vertretung (Szenario Amtsübergabe)
  setOffice(A.ttv, 'Jugendwart', ids.jana, ids.mia);
  setOffice(A.ttv, 'Öffentlichkeitsarbeit', ids.paul, ids.mia);

  // Einstellungen: Satzungswerte, beide Datenschutz-Schalter an (nur Fantasiedaten), Einrichtung erledigt
  setSetting('einladung_frist_tage', 21);
  setSetting('antrag_frist_tage', 7);
  setSetting('kuendigung_frist_monate', 3);
  setSetting('gelb_lokal', true);
  setSetting('gelb_extern', true);
  setSetting('m365', { mailboxes: [{ address: MAILBOX.ttv, area_id: A.ttv }, { address: MAILBOX.sv, area_id: A.sv }, { address: MAILBOX.bezirk, area_id: A.bezirk }],
    kalender_postfach: MAILBOX.ttv, ablage_ziel: `users/${MAILBOX.ttv}/drive`, ablage_ordner: 'Ehrenamt-App' });
  updateCatalog(Object.fromEntries(CATALOG.map(c => [c.key, { enabled: true }])));
  setSetting('einrichtung', { done: true, steps: {} });
  setSetting('einrichtung_preset', 'umfassend');
  for (const r of q.all('SELECT id FROM rules WHERE approved = 0')) q.run('UPDATE rules SET approved = 1, approved_by = ?, approved_at = ?, active = 1 WHERE id = ?', ids.mia, nowIso(), r.id);
  q.run('UPDATE recurring SET assumption = 0');

  // Spielpläne (click-TT-Nachbau)
  const start = today();
  setSetting('sim_spiele', makeSeason(start));
  const feed = (areaId, name, team, owner, lead) => q.run(`INSERT INTO feeds (area_id, name, url, home_pattern, create_tasks, template_id, lead_days, owner_id, active, created_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 1, ?)`,
    areaId, name, `${fakeBase}/ics/${team}.ics`, 'TTV Musterhausen', tpl('VOR-16'), lead, owner, nowIso());
  feed(A.ttv, 'Herren I (Bezirksliga)', 'herren1', ids.mia, 10);
  feed(A.ttv, 'Jugend U15', 'jugend', ids.jana, 7);

  // Sponsoren
  const sponsor = (a, company, contact, cat, end, status, last, god) => q.run(
    `INSERT INTO sponsors (area_id, company, contact_name, godparent_id, category, start_date, end_date, status, last_contact, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    a, company, contact, god, cat, addDays(start, -700), end, status, last, nowIso(), nowIso());
  sponsor(A.ttv, 'Autohaus Blechle', 'Herr Blechle', 'Trikot', addDays(start, 420), 'aktiv', addDays(start, -40), ids.mia);
  sponsor(A.ttv, 'Malerbetrieb Pinsel & Söhne', 'Frau Pinsel', 'Bande', addDays(start, 200), 'aktiv', addDays(start, -90), ids.ben);
  sponsor(A.sv, 'Getränke Spritzig', 'Herr Sprudel', 'Förderer', null, 'verhandlung', null, ids.ben);

  // Ablageregeln
  const fr = (r) => q.run(`INSERT INTO filing_rules (name, pos, sender_contains, subject_contains, filename_contains, file_types, target_area_id, folder, data_class, occasion, mode, template_id, dismiss_mail, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, r.name, r.pos, r.sender || '', r.subject || '', r.filename || '', r.types || '', r.area ?? null, r.folder, r.cls, r.occasion || '', r.mode, r.tpl ?? null, r.dismiss ? 1 : 0, nowIso(), nowIso());
  fr({ name: 'Hallenpläne der Gemeinde', pos: 10, sender: 'gemeinde-musterhausen.example', types: 'pdf', area: A.ttv, folder: 'Hallenbelegung', cls: 'gruen', occasion: 'Hallenplan {{datei}}', mode: 'ablegen' });
  fr({ name: 'Ausschreibungen des Bezirks', pos: 20, filename: 'ausschreibung', area: A.bezirk, folder: 'Turniere/Ausschreibungen', cls: 'gruen', mode: 'vormerken' });

  // Alltag: ein paar laufende Aufgaben und Ideen
  const mia = { id: ids.mia, name: 'Mia Muster' };
  const t = (o) => createTask(mia, { channel: 'manuell', ...o });
  t({ area_id: A.ttv, title: 'Trainingszeiten Rückrunde mit Gemeinde abstimmen', owner_id: ids.mia, due_date: addDays(start, 12) });
  t({ area_id: A.ttv, title: 'Spielbericht Herren I für die Homepage', template_id: tpl('VOR-7'), owner_id: ids.paul, due_date: addDays(start, 3) });
  t({ area_id: A.ttv, title: 'Budgetplan nächstes Jahr entwerfen', template_id: tpl('VOR-10'), owner_id: ids.ben, due_date: addDays(start, 30) });
  t({ area_id: A.sv, title: 'Tischreparatur beauftragen', owner_id: ids.ben, due_date: addDays(start, 9) });
  t({ area_id: A.bezirk, title: 'Schiedsrichtereinteilung nächster Monat', template_id: tpl('VOR-12'), owner_id: ids.tom, due_date: addDays(start, 15) });
  t({ area_id: A.ttv, kind: 'idee', title: 'Mini-Meisterschaften an der Grundschule anbieten' });

  setSetting('sim_welt', { created_at: nowIso(), start, sim_start: clockNow().toISOString() });
  return { pw, client };
}

/** Kurzbeschreibung des Demo-Vereins für die Oberfläche */
export function worldInfo() {
  return {
    areas: SIM_AREAS.map(a => a.name),
    people: PEOPLE.map(p => ({ login: p.login, name: p.name, role: p.role, text: p.text })),
    mailboxes: Object.values(MAILBOX),
    start: getSetting('sim_welt', {})?.start,
  };
}

export { SATZUNG, BEITRAGSORDNUNG };
