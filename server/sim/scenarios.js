// Vorstandsarbeit-Simulator: Szenarien aus typischen Problemen von Sportvereinen.
//
// Grundlage (Recherche, siehe docs/SIMULATOR.md): Ehrenamt-Mangel und Überlastung weniger Personen
// (Sportentwicklungsbericht, Bundestag Unterausschuss Bürgerschaftliches Engagement 2024),
// Schiedsrichtermangel und kurzfristige Absagen, Hallenzeiten und Spielverlegungen, Kassenprüfung
// und fehlende Belege, Fristen der Satzung (Einladung, Kündigung), Datenschutz (Fotos Minderjähriger,
// Auskunftsersuchen), Betrugsmails mit „neuer Bankverbindung“, Wissensverlust bei Amtsübergaben.
//
// Jedes Szenario: start() spielt die Ausgangslage ein (Mails, Eingänge, Aufgaben, Spielplan),
// onDay() lässt die Welt auf das eigene Handeln reagieren, checks prüfen am Datenbestand,
// ob das Problem gelöst ist. Einmal erfüllte Prüfungen bleiben erfüllt.

import { q, getSetting, setSetting } from '../db.js';
import { createTask } from '../services/tasks.js';
import { addInbound } from '../services/inbox.js';
import { addDays, nowIso, today, formatDateDe } from '../util.js';
import { queueMail as rawQueue } from './fakes.js';

// Liefert die Kennung, unter der die App die Mail nach dem Abruf im Eingang führt
const queueMail = (...a) => `m365:${rawQueue(...a)}`;
import { area, user, tpl, office, MAILBOX, HALL, nextWeekday } from './world.js';

const pdf = (text) => Buffer.from(`%PDF-1.4\n% Simulator-Dokument (Fantasie)\n${text}\n%%EOF`);
const jpg = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from('Simulator-Bild (Fantasie)'), 0xff, 0xd9]);
const asUser = (login) => { const u = user(login); return { id: u.id, name: u.name }; };
const tplKey = (id) => (id == null ? null : q.get('SELECT key FROM process_templates WHERE id = ?', id)?.key);
const textId = (key) => q.get('SELECT id FROM text_templates WHERE key = ?', key)?.id ?? -1;
const inboxByExternal = (ext) => q.get('SELECT * FROM inbox WHERE external_id = ?', ext);
const tasksSince = (since, where = '1=1', ...p) => q.all(`SELECT * FROM tasks WHERE kind = 'aufgabe' AND created_at >= ? AND ${where}`, since, ...p);
const draftsSince = (since, textKey, where = '1=1', ...p) => q.all(`SELECT * FROM drafts WHERE created_at >= ? AND template_id = ? AND ${where}`, since, textId(textKey), ...p);
const done = (t) => t?.status === 'erledigt';
const doneBy = (t, date) => done(t) && t.completed_at && t.completed_at.slice(0, 10) <= date;
const taskFromInbox = (ext) => { const i = inboxByExternal(ext); return i?.task_id ? q.get('SELECT * FROM tasks WHERE id = ?', i.task_id) : null; };
const handled = (ext) => { const i = inboxByExternal(ext); return !!i && i.status !== 'neu'; };
const moveGame = (uid, days, time = null) => {
  const games = getSetting('sim_spiele', []);
  const g = games.find(x => x.uid === uid);
  if (g) { g.date = addDays(g.date, days); if (time) g.time = time; setSetting('sim_spiele', games); }
  return g;
};
/** Nächstes Heimspiel einer Mannschaft im Fenster [min, max] Tage; legt notfalls eines an. */
function homeGame(team, min, max) {
  const d = today();
  const games = getSetting('sim_spiele', []);
  let g = games.find(x => x.team === team && x.location === HALL && x.date >= addDays(d, min) && x.date <= addDays(d, max));
  if (!g) {
    g = { uid: `sim-extra-${Date.now()}`, team, date: nextWeekday(d, 6, min), time: '18:00', summary: 'TTV Musterhausen – TSV Nachholdorf', location: HALL };
    games.push(g);
    setSetting('sim_spiele', games);
  }
  return g;
}

export const SCENARIOS = [
  {
    key: 'sr_absage', title: 'Schiedsrichter sagt kurzfristig ab', area: 'Bezirk', difficulty: 1, days: 3,
    problem: 'Schiedsrichter sind knapp; Absagen kommen oft erst wenige Tage vor dem Spiel. Ohne festen Ablauf wird hektisch herumtelefoniert.',
    start(c) {
      const game = homeGame('herren1', 3, 7);
      const ext = queueMail(MAILBOX.bezirk, { from: 'k.kurzfrist@mail.example', fromName: 'Klaus Kurzfrist', subject: `Absage Schiedsrichtereinsatz ${formatDateDe(game.date)}`,
        body: `Hallo Tom,\nleider kann ich am ${formatDateDe(game.date)} beim Spiel ${game.summary} nicht pfeifen – Familienfeier.\nTut mir leid!\nKlaus` });
      return { ext, game_date: game.date, game: game.summary };
    },
    checks: [
      { label: 'Absage aus dem Postfach übernommen', ok: (c, d) => !!taskFromInbox(d.ext) },
      { label: 'Vorgang „Schiedsrichter-Ersatz“ (VOR-3) zugeordnet', ok: (c, d) => tplKey(taskFromInbox(d.ext)?.template_id) === 'VOR-3' },
      { label: 'Rundfrage-Entwurf an den Schiedsrichter-Pool erzeugt', ok: (c, d) => draftsSince(c.since, 'T-SR-RUNDFRAGE').length > 0 },
      { label: 'Vor dem Spieltag erledigt', ok: (c, d) => doneBy(taskFromInbox(d.ext), d.game_date) },
    ],
    tips: ['Eingang → „Postfach abrufen“, dann übernehmen; die App schlägt VOR-3 vor.', 'In der Aufgabe: Entwurf aus Textvorlage „Rundfrage Schiedsrichter-Ersatz“.', 'Im Simulator gilt der Ersatz als gefunden, sobald ihr die Aufgabe abschließt.'],
  },
  {
    key: 'hallensperrung', title: 'Halle gesperrt – Heimspiel verlegen', area: 'TTV Musterhausen', difficulty: 2, days: 5,
    problem: 'Hallenzeiten sind knapp und werden kurzfristig gestrichen (Schulveranstaltung, Schaden). Dann muss ein Spiel fristgerecht verlegt werden.',
    start(c) {
      const game = homeGame('herren1', 6, 13);
      const ext = queueMail(MAILBOX.ttv, { from: 'halle@gemeinde-musterhausen.example', fromName: 'Gemeinde Musterhausen – Hallenverwaltung', subject: 'Sperrung Sporthalle wegen Wasserschaden',
        body: `Sehr geehrte Damen und Herren,\nwegen eines Wasserschadens bleibt die Sporthalle am ${formatDateDe(game.date)} gesperrt. Den geänderten Hallenplan finden Sie im Anhang.\nMit freundlichen Grüßen\nIhre Gemeindeverwaltung`,
        attachments: [{ name: 'Hallenplan_Sperrung.pdf', mime: 'application/pdf', data: pdf(`Hallensperrung ${game.date}`) }] });
      return { ext, uid: game.uid, old_date: game.date, game: game.summary };
    },
    onDay(c, d) {
      if (d.moved || !draftsSince(c.since, 'T-VERLEGUNG').length) return;
      // Freitagabend vor dem nächsten Spielwochenende – kollidiert nicht mit dem nächsten Samstagsspiel
      const g = moveGame(d.uid, 6, '19:30');
      d.moved = g?.date;
      queueMail(MAILBOX.ttv, { from: 'staffel@tt-musterkreis.example', fromName: 'Staffelleitung Bezirksliga', subject: `Verlegung genehmigt: ${d.game}`,
        body: `Hallo,\ndie Verlegung ist genehmigt. Neuer Termin: ${formatDateDe(g.date)}, 19:30 Uhr. click-TT ist aktualisiert.\nGruß, Staffelleitung` });
      return `Staffelleitung hat die Verlegung genehmigt (neu: ${formatDateDe(g.date)}).`;
    },
    checks: [
      { label: 'Hallenplan automatisch im Ordner „Hallenbelegung“ abgelegt', ok: () => !!q.get(`SELECT 1 FROM files WHERE original_name = 'Hallenplan_Sperrung.pdf' AND folder = 'Hallenbelegung' AND deleted_at IS NULL`) },
      { label: 'Verlegungsantrag aus der Textvorlage erstellt', ok: (c) => draftsSince(c.since, 'T-VERLEGUNG').length > 0 },
      { label: 'Neuer Termin im Spielplan der App angekommen', ok: (c, d) => !!d.moved && !!q.get('SELECT 1 FROM events WHERE external_uid = ? AND date = ?', d.uid, d.moved) },
    ],
    tips: ['Die Ablageregel „Hallenpläne der Gemeinde“ legt den Anhang ab – schaut unter Ablage → Hallenbelegung.', 'Mail als Aufgabe mit VOR-3 übernehmen, Entwurf „Anfrage Spielverlegung“ erzeugen.', 'Die Staffelleitung antwortet am nächsten simulierten Tag; danach Spielplan-Abruf abwarten.'],
  },
  {
    key: 'helfer', title: 'Helfermangel am Heimspieltag', area: 'TTV Musterhausen', difficulty: 2, days: 6,
    problem: 'Die meisten Vereine berichten, dass sich immer weniger Menschen für Dienste melden. Am Heimspieltag fehlen Kuchen, Kasse und Aufbau.',
    start(c) {
      const game = homeGame('herren1', 4, 8);
      const ext = `wa-${Date.now()}`;
      addInbound(null, { channel: 'whatsapp', sender: 'Karin Kuchen', subject: 'Samstag Küche', area_id: area('ttv-musterhausen'), external_id: ext,
        body: `Hi Mia, ich bin am ${formatDateDe(game.date)} leider nicht da. Küche und Kuchen sind damit offen, sorry!` });
      return { ext, uid: game.uid, game_date: game.date };
    },
    checks: [
      { label: 'Heimspieltag-Aufgabe aus dem Spielplan vorhanden', ok: (c, d) => !!q.get('SELECT 1 FROM tasks WHERE parent_source LIKE ?', `spielplan:%:${d.uid}`) },
      { label: 'Aufruf Hallen- und Küchendienst als Entwurf', ok: (c) => draftsSince(c.since, 'T-HEIMSPIEL').length + draftsSince(c.since, 'T-HELFER').length > 0 },
      { label: 'Absage von Karin bearbeitet', ok: (c, d) => handled(d.ext) },
      { label: 'Heimspieltag vor Anpfiff vorbereitet (Aufgabe erledigt)', ok: (c, d) => doneBy(q.get('SELECT * FROM tasks WHERE parent_source LIKE ?', `spielplan:%:${d.uid}`), d.game_date) },
    ],
    tips: ['Die Aufgabe entsteht 10 Tage vorher aus dem Spielplan (Vorgang VOR-16) – ggf. einen Tag vorspulen.', 'Im Vorgang: Entwurf „Heimspieltag: Aufruf Hallen- und Küchendienst“.', 'Die WhatsApp-Nachricht als Kommentar an die Heimspiel-Aufgabe hängen oder ablegen.'],
  },
  {
    key: 'neuaufnahme', title: 'Aufnahmeantrag ohne SEPA-Mandat', area: 'TTV Musterhausen', difficulty: 2, days: 6,
    problem: 'Unvollständige Anträge bleiben liegen; ohne Lastschriftmandat fehlt später der Beitrag. Bei Minderjährigen braucht es die Unterschrift der Eltern (gelbe Daten).',
    start(c) {
      const ext = `post-${Date.now()}`;
      addInbound(null, { channel: 'post', sender: 'Familie Lustig', subject: 'Aufnahmeantrag Lea Lustig', area_id: area('ttv-musterhausen'), external_id: ext,
        body: 'Aufnahmeantrag für Lea Lustig, geb. 03.05.2014, Ahornweg 7, Musterhausen. Unterschrift beider Eltern liegt vor. Das SEPA-Mandat reichen wir nach.' });
      return { ext };
    },
    onDay(c, d) {
      const t = taskFromInbox(d.ext);
      if (d.sepa || !t || c.day < 2) return;
      d.sepa = true;
      queueMail(MAILBOX.ttv, { from: 'familie.lustig@mail.example', fromName: 'Familie Lustig', subject: `[#${t.id}] SEPA-Mandat Lea Lustig`,
        body: 'Hallo, anbei wie versprochen das unterschriebene SEPA-Mandat. Viele Grüße', attachments: [{ name: 'SEPA-Mandat_Lustig.pdf', mime: 'application/pdf', data: pdf('SEPA-Mandat (Fantasie)') }] });
      return 'Familie Lustig hat das SEPA-Mandat per Mail geschickt (mit Vorgangsnummer im Betreff).';
    },
    checks: [
      { label: 'Als Neuaufnahme (VOR-1) übernommen', ok: (c, d) => tplKey(taskFromInbox(d.ext)?.template_id) === 'VOR-1' },
      { label: 'Als gelber Vorgang gekennzeichnet', ok: (c, d) => taskFromInbox(d.ext)?.data_class === 'gelb' },
      { label: '„Wartet auf“ SEPA-Mandat gesetzt', ok: (c, d) => { const t = taskFromInbox(d.ext); return t?.status === 'wartet' && /sepa|mandat|lastschrift/i.test(`${t.waiting_what} ${t.waiting_who}`); } },
      { label: 'Willkommensmail-Entwurf liegt bereit', ok: (c, d) => { const t = taskFromInbox(d.ext); return !!t && draftsSince(c.since, 'T-WILLKOMMEN', 'task_id = ?', t.id).length > 0; } },
      { label: 'Nach Eingang des Mandats abgeschlossen', ok: (c, d) => d.sepa && done(taskFromInbox(d.ext)) },
    ],
    tips: ['Eingang übernehmen mit VOR-1, Datenklasse gelb.', 'Status „Wartet“ mit „SEPA-Mandat“ – die Antwort mit [#Nummer] im Betreff wird automatisch zugeordnet.', 'Sobald die Aufgabe „in Arbeit“ geht, legt eine Regel den Willkommensmail-Entwurf an (nur mit Schalter „Gelb lokal“).'],
  },
  {
    key: 'mv_einladung', title: 'Mitgliederversammlung fristgerecht einladen', area: 'TTV Musterhausen', difficulty: 2, days: 10,
    problem: 'Formfehler bei der Einladung (Frist, Tagesordnung) machen Beschlüsse anfechtbar. Die Satzung des TTV verlangt drei Wochen Vorlauf.',
    start(c) {
      const date = addDays(today(), 26);
      q.run('INSERT INTO events (area_id, title, date, time, location, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', area('ttv-musterhausen'), 'Mitgliederversammlung TTV', date, '19:30', 'Vereinsheim', user('mia').id, nowIso());
      const t = createTask(asUser('mia'), { area_id: area('ttv-musterhausen'), title: `Einladung Mitgliederversammlung ${formatDateDe(date)}`, template_id: tpl('VOR-8'), owner_id: user('mia').id, due_date: addDays(date, -21), channel: 'jahreskalender' });
      return { mv: date, task: t.id ?? t };
    },
    checks: [
      { label: 'Einladungsfrist mit dem Rechner geprüft', ok: (c) => !!q.get(`SELECT 1 FROM calculations WHERE calc = 'einladungsfrist' AND created_at >= ?`, c.since) },
      { label: 'Einladung aus der Textvorlage erstellt', ok: (c) => draftsSince(c.since, 'T-EINLADUNG-MV').length > 0 },
      { label: 'Einladung spätestens 21 Tage vor der Versammlung fertig', ok: (c, d) => doneBy(q.get('SELECT * FROM tasks WHERE id = ?', d.task), addDays(d.mv, -21)) },
    ],
    tips: ['In der Aufgabe: Rechner „Einladungsfrist“ – er nutzt die 21 Tage aus den Einstellungen.', 'Auskunft: „Wie lange vorher muss eingeladen werden?“ findet § 7 der Satzung.', 'Entwurf „Einladung Mitgliederversammlung“, dann abschließen.'],
  },
  {
    key: 'sponsor', title: 'Sponsorvertrag läuft aus', area: 'TTV Musterhausen', difficulty: 1, days: 5,
    problem: 'Sponsoren springen ab, wenn sich niemand meldet. Häufig merkt der Verein das Vertragsende erst, wenn die Zahlung fehlt.',
    start(c) {
      const end = addDays(today(), 35);
      const id = Number(q.run(`INSERT INTO sponsors (area_id, company, contact_name, godparent_id, category, start_date, end_date, status, last_contact, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'aktiv', ?, ?, ?)`,
        area('ttv-musterhausen'), 'Bäckerei Krümel', 'Frau Krümel', user('mia').id, 'Bande', addDays(today(), -700), end, addDays(today(), -300), nowIso(), nowIso()).lastInsertRowid);
      return { sponsor: id, end };
    },
    checks: [
      { label: 'Verlängerungs-Aufgabe automatisch entstanden', ok: (c, d) => !!q.get('SELECT 1 FROM tasks WHERE parent_source LIKE ?', `sponsor:${d.sponsor}:%`) },
      { label: 'Kontakt aufgenommen und erfasst', ok: (c, d) => (q.get('SELECT last_contact FROM sponsors WHERE id = ?', d.sponsor)?.last_contact || '') >= c.day0 },
      { label: 'Vertrag verlängert oder bewusst beendet', ok: (c, d) => { const s = q.get('SELECT * FROM sponsors WHERE id = ?', d.sponsor); return !!s && (s.status === 'beendet' || (s.end_date || '') > d.end); } },
    ],
    tips: ['Die Aufgabe kommt beim nächsten Tageslauf (einen Tag vorspulen).', 'Sponsoren → Bäckerei Krümel → „Kontakt erfassen“; Entwurf „Sponsorenkontakt und Verlängerung“.', 'Neues Laufzeitende eintragen.'],
  },
  {
    key: 'phishing', title: 'Neue Bankverbindung per Mail', area: 'TTV Musterhausen', difficulty: 1, days: 2,
    problem: 'Vereine sind beliebtes Ziel von Betrugsmails („Chef-Masche“): angeblich die Vorsitzende, dringend, neue IBAN. Ehrenamtliche Kassierer überweisen unter Zeitdruck.',
    start(c) {
      const ext = queueMail(MAILBOX.ttv, { from: 'mia.muster.vorstand@freemail.example', fromName: 'Mia Muster', subject: 'Dringend: Überweisung heute noch',
        body: 'Hallo Ben,\nbitte überweise heute noch 1.480 € für die neuen Trikots. Der Lieferant hat eine neue Bankverbindung: DE89 3704 0044 0532 0130 00. Ich bin den ganzen Tag im Meeting und nicht erreichbar.\nMia' });
      return { ext };
    },
    onDay(c, d) {
      if (d.followup || c.day < 1 || handled(d.ext)) return;
      d.followup = true;
      queueMail(MAILBOX.ttv, { from: 'mia.muster.vorstand@freemail.example', fromName: 'Mia Muster', subject: 'Re: Dringend: Überweisung heute noch', body: 'Hast du schon überwiesen??? Es eilt wirklich!' });
      return 'Der Absender hakt nach („Hast du schon überwiesen???“).';
    },
    checks: [
      { label: 'Warnhinweis der App beachtet: Mail nicht als Aufgabe übernommen', ok: (c, d) => { const i = inboxByExternal(d.ext); return !!i && i.status === 'abgelegt' && !i.task_id; } },
      { label: 'Keine Zahlung angestoßen (keine Aufgabe mit der IBAN)', ok: (c) => !tasksSince(c.since, `description LIKE '%0532 0130%'`).length && c.day >= 1 },
    ],
    tips: ['Der Eingang zeigt Auffälligkeiten (Bankverbindung, Zeitdruck).', '„Ablegen“ mit Grund – nicht übernehmen. Im echten Verein: bei Mia auf bekanntem Weg nachfragen.'],
  },
  {
    key: 'kassenpruefung', title: 'Kassenprüfung: Belege zusammensuchen', area: 'TTV Musterhausen', difficulty: 2, days: 8,
    problem: 'Kassenprüfungen scheitern oft an fehlenden oder verstreuten Belegen. Rechnungen kommen per Mail und landen in privaten Postfächern.',
    start(c) {
      const t = createTask(asUser('mia'), { area_id: area('ttv-musterhausen'), title: 'Kassenprüfung vorbereiten: alle Belege des Jahres bereitlegen', owner_id: user('ben').id, due_date: addDays(today(), 10), template_id: tpl('VOR-5'), channel: 'jahreskalender' });
      return { task: t.id ?? t, sent: 0 };
    },
    onDay(c, d) {
      const inv = [['Rechnung Hallenreinigung', 'Rechnung_2026-117_Hallenreinigung.pdf', 'service@sauber-gmbh.example'],
        ['Ihre Rechnung: Tischtennisbälle', 'Rechnung_Baelle_88412.pdf', 'shop@ball-versand.example'],
        ['Rechnung Startgelder Bezirksmeisterschaft', 'Rechnung_Startgeld_BM.pdf', 'kasse@tt-musterkreis.example']];
      if (d.sent >= inv.length) return;
      const [subject, name, from] = inv[d.sent++];
      queueMail(MAILBOX.ttv, { from, subject, body: 'Sehr geehrte Damen und Herren,\nanbei unsere Rechnung.\nMit freundlichen Grüßen', attachments: [{ name, mime: 'application/pdf', data: pdf(subject) }] });
      return `Neue Rechnung im Postfach: ${subject}`;
    },
    checks: [
      { label: 'Ablageregel für Rechnungen angelegt', ok: () => !!q.get(`SELECT 1 FROM filing_rules WHERE active = 1 AND (lower(subject_contains) LIKE '%rechnung%' OR lower(filename_contains) LIKE '%rechnung%')`) },
      { label: 'Alle drei Rechnungen in einem Ordner abgelegt', ok: () => q.get(`SELECT COUNT(DISTINCT original_name) AS n FROM files WHERE original_name LIKE 'Rechnung%' AND folder != '' AND deleted_at IS NULL`).n >= 3 },
      { label: 'Rechnungen als gelb eingestuft', ok: () => q.get(`SELECT COUNT(*) AS n FROM files WHERE original_name LIKE 'Rechnung%' AND data_class = 'gelb'`).n >= 3 },
      { label: 'Kassenprüfung rechtzeitig vorbereitet', ok: (c, d) => { const t = q.get('SELECT * FROM tasks WHERE id = ?', d.task); return doneBy(t, t?.due_date); } },
    ],
    tips: ['Eingang → Regeln: neue Ablageregel „Betreff enthält Rechnung“ → Ordner „Rechnungen“, gelb.', 'Rechnungen kommen über drei Tage verteilt – die Regel erwischt die späteren automatisch.', 'Bereits eingegangene Rechnungen „nur ablegen“ in den Ordner.'],
  },
  {
    key: 'amtsuebergabe', title: 'Kassenwart hört auf', area: 'TTV Musterhausen', difficulty: 3, days: 7,
    problem: 'Bei Amtswechseln geht Wissen verloren, Aufgaben hängen an einer Person, Vertretungen fehlen. Viele Vereine finden kaum Nachfolger.',
    start(c) {
      const ext = queueMail(MAILBOX.ttv, { from: 'ben.beispiel@mail.example', fromName: 'Ben Beispiel', subject: 'Ich höre als Kassenwart auf',
        body: 'Hallo Mia,\nich ziehe beruflich um und muss das Kassenamt zum Monatsende abgeben. Lass uns die Übergabe gut machen.\nBen' });
      for (const title of ['Mitgliedsbeiträge: Rücklastschriften klären', 'Spendenbescheinigungen ausstellen', 'Zuschussabrechnung Gemeinde'])
        createTask(asUser('mia'), { area_id: area('ttv-musterhausen'), title, owner_id: user('ben').id, office_id: office('ttv-musterhausen', 'Kasse')?.id, due_date: addDays(today(), 14), template_id: tpl('VOR-5') });
      return { ext };
    },
    checks: [
      { label: 'Amt „Kasse“ neu besetzt', ok: () => { const o = office('ttv-musterhausen', 'Kasse'); return !!o?.holder_id && o.holder_id !== user('ben').id; } },
      { label: 'Vertretung für die Kasse eingetragen', ok: () => { const o = office('ttv-musterhausen', 'Kasse'); return !!o?.deputy_id && o.deputy_id !== o.holder_id; } },
      { label: 'Keine offenen TTV-Aufgaben mehr bei Ben', ok: () => !q.get(`SELECT 1 FROM tasks WHERE owner_id = ? AND area_id = ? AND status IN ('offen','in_arbeit','wartet')`, user('ben').id, area('ttv-musterhausen')) },
      { label: 'Handbuch-Wissen gesichert (Erfahrung notiert)', ok: (c) => !!q.get('SELECT 1 FROM learnings WHERE created_at >= ?', c.since) },
    ],
    tips: ['Adminpanel → Ämter: Kasse neu besetzen und Vertretung setzen (z. B. kommissarisch, § 8 Satzung).', 'Aufgaben-Liste filtern „Verantwortlich: Ben“ → Sammelbearbeitung „Verantwortlich ändern“.', 'In einer Aufgabe „Erfahrung festhalten“ – landet im Handbuch je Amt.'],
  },
  {
    key: 'foerderung', title: 'Fördermittel: Antragsfrist', area: 'TTV Musterhausen', difficulty: 2, days: 12,
    problem: 'Zuschüsse von Sportbund und Kommune verfallen, weil Fristen übersehen werden oder niemand den Antrag schreibt.',
    start(c) {
      const deadline = addDays(today(), 12);
      const ext = queueMail(MAILBOX.ttv, { from: 'foerderung@sportbund-musterland.example', fromName: 'Sportbund Musterland', subject: 'Förderprogramm Vereinsausstattung – Antragsfrist',
        body: `Liebe Vereine,\nim Programm „Vereinsausstattung“ werden Sportgeräte mit bis zu 40 % bezuschusst. Anträge bitte bis spätestens ${formatDateDe(deadline)} über das Formular einreichen.\nIhr Sportbund` });
      return { ext, deadline };
    },
    checks: [
      { label: 'Aufgabe mit Frist vor Antragsschluss', ok: (c, d) => { const t = taskFromInbox(d.ext); return !!t?.due_date && t.due_date <= d.deadline; } },
      { label: 'Antrag aus Textvorlage „Förder- oder Zuschussantrag“', ok: (c) => draftsSince(c.since, 'T-FOERDER').length > 0 },
      { label: 'Vor Fristende abgeschlossen', ok: (c, d) => doneBy(taskFromInbox(d.ext), d.deadline) },
    ],
    tips: ['Beim Übernehmen die Frist ein paar Tage vor den Antragsschluss legen.', 'Vorgang VOR-5 „Bescheinigungen und Anträge“ passt.'],
  },
  {
    key: 'fotos', title: 'Fotos vom Jugendturnier per WhatsApp', area: 'TTV Musterhausen', difficulty: 2, days: 4,
    problem: 'Bilder Minderjähriger dürfen nur mit Einwilligung veröffentlicht werden. Vieles läuft unkontrolliert über private Messenger.',
    start(c) {
      const ext = `wa-fotos-${Date.now()}`;
      addInbound(null, { channel: 'whatsapp', sender: 'Trainer Theo', subject: 'Fotos vom Jugendturnier', area_id: area('ttv-musterhausen'), external_id: ext,
        body: 'Hier 2 Fotos von den Kids beim Turnier, super für die Homepage! Ob alle Eltern einverstanden sind, weiß ich nicht genau.',
        attachments: [{ name: 'Jugendturnier_1.jpg', mime: 'image/jpeg', data: jpg() }, { name: 'Jugendturnier_2.jpg', mime: 'image/jpeg', data: jpg() }] });
      return { ext };
    },
    checks: [
      { label: 'Eingang bearbeitet', ok: (c, d) => handled(d.ext) },
      { label: 'Bilder nicht als grün (öffentlich) abgelegt', ok: (c, d) => handled(d.ext) && !q.get(`SELECT 1 FROM files WHERE original_name LIKE 'Jugendturnier_%' AND data_class = 'gruen' AND deleted_at IS NULL`) },
      { label: 'Einwilligungen als Schritt festgehalten', ok: (c) => { const ts = tasksSince(c.since); return ts.some(t => /einwillig|einverst/i.test(t.description || '') || q.get(`SELECT 1 FROM comments WHERE task_id = ? AND (body LIKE '%inwillig%' OR body LIKE '%inverst%')`, t.id) || q.get(`SELECT 1 FROM task_steps WHERE task_id = ? AND (title LIKE '%inwillig%' OR title LIKE '%inverst%')`, t.id)); } },
    ],
    tips: ['Übernehmen mit VOR-7 und Datenklasse gelb (Minderjährige).', 'Schritt oder Kommentar „Einwilligungen der Eltern prüfen“ ergänzen.'],
  },
  {
    key: 'fahrdienst', title: 'Jugend: Fahrdienst zum Ranglistenturnier', area: 'TTV Musterhausen', difficulty: 1, days: 5,
    problem: 'Elterninformationen gehen in Gruppen-Chats unter; am Turniertag fehlen Fahrer oder Startpässe.',
    start(c) {
      const date = nextWeekday(today(), 0, 8);
      q.run('INSERT INTO events (area_id, title, date, time, location, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', area('ttv-musterhausen'), 'Bezirksrangliste Jugend', date, '09:00', 'Halle Talstadt', user('jana').id, nowIso());
      const t = createTask(asUser('mia'), { area_id: area('ttv-musterhausen'), title: `Elterninfo und Fahrdienst Bezirksrangliste ${formatDateDe(date)}`, template_id: tpl('VOR-14'), owner_id: user('jana').id, due_date: addDays(date, -3) });
      const ext = `wa-paul-${Date.now()}`;
      addInbound(null, { channel: 'whatsapp', sender: 'Papa Paulsen', subject: 'Rangliste – wer fährt?', area_id: area('ttv-musterhausen'), external_id: ext, body: 'Wer fährt eigentlich zur Rangliste? Wir hätten 3 Plätze frei.' });
      return { task: t.id ?? t, ext };
    },
    checks: [
      { label: 'Elterninformation aus der Vorlage erstellt', ok: (c) => draftsSince(c.since, 'T-ELTERN').length > 0 },
      { label: 'Angebot von Papa Paulsen der Aufgabe zugeordnet', ok: (c, d) => { const i = inboxByExternal(d.ext); return !!i && (i.task_id === d.task || (i.status !== 'neu' && !!q.get(`SELECT 1 FROM comments WHERE task_id = ? AND body LIKE '%Plätze%'`, d.task))); } },
      { label: 'Rechtzeitig erledigt', ok: (c, d) => { const t = q.get('SELECT * FROM tasks WHERE id = ?', d.task); return doneBy(t, t?.due_date); } },
    ],
    tips: ['Als Jana anmelden (Zuarbeit) oder als Admin die Aufgabe öffnen.', 'Eingang → „Zu bestehender Aufgabe“ hängt die Nachricht als Kommentar an.'],
  },
  {
    key: 'ideen', title: 'Ideen versanden im Ideenspeicher', area: 'TTV Musterhausen', difficulty: 1, days: 3,
    problem: 'Gute Vorschläge aus Versammlungen werden notiert und nie entschieden. Engagierte Mitglieder sind dann frustriert.',
    start(c) {
      const ids = [];
      for (const title of ['Vereinsausflug zum Bundesliga-Spiel', 'Ballmaschine anschaffen', 'Hobbyrunde für Eltern am Freitag']) {
        const t = createTask(asUser('mia'), { area_id: area('ttv-musterhausen'), kind: 'idee', title, description: 'Vorschlag aus der letzten Mitgliederversammlung.' });
        const id = t.id ?? t;
        q.run('UPDATE tasks SET created_at = ?, last_activity_at = ? WHERE id = ?', new Date(Date.parse(nowIso()) - 95 * 86_400_000).toISOString(), new Date(Date.parse(nowIso()) - 95 * 86_400_000).toISOString(), id);
        ids.push(id);
      }
      return { ids };
    },
    checks: [
      { label: 'Alle drei Ideen entschieden (umgesetzt, geplant oder verworfen)', ok: (c, d) => d.ids.every(id => { const t = q.get('SELECT * FROM tasks WHERE id = ?', id); return t && (t.kind !== 'idee' || ['erledigt', 'verworfen'].includes(t.status)); }) },
    ],
    tips: ['Die Automatik „Ideen zur Entscheidung vorlegen“ meldet sich beim Tageslauf.', 'Ideenspeicher → Idee öffnen → in Aufgabe umwandeln oder verwerfen (mit Begründung).'],
  },
  {
    key: 'auskunft', title: 'Auskunftsersuchen nach Art. 15 DSGVO', area: 'TTV Musterhausen', difficulty: 2, days: 10,
    problem: 'Auskunftsersuchen müssen innerhalb eines Monats beantwortet werden. Viele Vereine wissen nicht, wo überall Daten liegen.',
    start(c) {
      const ext = queueMail(MAILBOX.ttv, { from: 'rudi.rastlos@mail.example', fromName: 'Rudi Rastlos', subject: 'Auskunft nach Art. 15 DSGVO',
        body: 'Sehr geehrter Vorstand,\nhiermit verlange ich Auskunft über alle zu meiner Person gespeicherten Daten gemäß Art. 15 DSGVO.\nRudi Rastlos, Mitgliedsnummer 4711' });
      return { ext, deadline: addDays(today(), 30) };
    },
    checks: [
      { label: 'Aufgabe mit Frist innerhalb eines Monats', ok: (c, d) => { const t = taskFromInbox(d.ext); return !!t?.due_date && t.due_date <= d.deadline; } },
      { label: 'Als gelber Vorgang behandelt', ok: (c, d) => taskFromInbox(d.ext)?.data_class === 'gelb' },
      { label: 'Fristgerecht beantwortet', ok: (c, d) => doneBy(taskFromInbox(d.ext), d.deadline) },
    ],
    tips: ['Auskunft fragen: „Wie schnell muss eine Datenauskunft erfolgen?“ → § 10 der Satzung.', 'Gelb, weil Mitgliedsdaten betroffen sind.'],
  },
  {
    key: 'ueberlastung', title: 'Alles hängt an der Vorsitzenden', area: 'TTV Musterhausen', difficulty: 3, days: 7,
    problem: 'Wenige Engagierte tragen fast alles; ohne Verteilung und Vertretung droht Ausfall und Rücktritt.',
    start(c) {
      const ids = [];
      for (const [title, tk, d] of [['Hallenschlüssel für neue Trainer organisieren', null, 5], ['Vereinsmeisterschaft planen', 'VOR-9', 20], ['Homepage: Trainingszeiten aktualisieren', 'VOR-7', 4],
        ['Mannschaftsmeldung Rückrunde', 'VOR-4', 9], ['Tischtennisplatten-Inventur', null, 15], ['Grillfest Helferliste', 'VOR-9', 18], ['Anfrage Schnuppertraining beantworten', null, 3], ['Getränkelieferant wechseln', null, 25]]) {
        const t = createTask(asUser('mia'), { area_id: area('ttv-musterhausen'), title, owner_id: user('mia').id, template_id: tk ? tpl(tk) : null, due_date: addDays(today(), d) });
        ids.push(t.id ?? t);
      }
      q.run('UPDATE tasks SET deputy_id = NULL WHERE id IN (' + ids.map(() => '?').join(',') + ')', ...ids);
      return { ids };
    },
    checks: [
      { label: 'Mindestens fünf der acht Aufgaben abgegeben oder erledigt', ok: (c, d) => d.ids.filter(id => { const t = q.get('SELECT * FROM tasks WHERE id = ?', id); return t && (t.owner_id !== user('mia').id || done(t)); }).length >= 5 },
      { label: 'Jede offene davon hat eine Vertretung', ok: (c, d) => d.ids.every(id => { const t = q.get('SELECT * FROM tasks WHERE id = ?', id); return !t || ['erledigt', 'verworfen'].includes(t.status) || !!t.deputy_id; }) },
    ],
    tips: ['Aufgaben → Filter „Verantwortlich: Mia“ → mehrere markieren → Sammelbearbeitung.', 'Kennzahlen → „Verteilung“ zeigt die Last je Person; der Rechner „Faire Verteilung“ hilft.'],
  },
  {
    key: 'kuendigung', title: 'Kündigung kurz vor Jahresende', area: 'TTV Musterhausen', difficulty: 2, days: 4,
    problem: 'Streit um Austrittsfristen und doppelte Beiträge entsteht, wenn Kündigungen nicht sauber nach Satzung geprüft und bestätigt werden.',
    start(c) {
      const ext = queueMail(MAILBOX.ttv, { from: 'kurt.kuendig@mail.example', fromName: 'Kurt Kündig', subject: 'Kündigung meiner Mitgliedschaft',
        body: `Hallo,\nhiermit kündige ich meine Mitgliedschaft zum nächstmöglichen Termin. Bitte bestätigt mir das Austrittsdatum.\nKurt Kündig` });
      return { ext };
    },
    checks: [
      { label: 'Als Mitgliederänderung (VOR-2) übernommen', ok: (c, d) => tplKey(taskFromInbox(d.ext)?.template_id) === 'VOR-2' },
      { label: 'Austrittsdatum mit dem Kündigungsrechner ermittelt', ok: (c) => !!q.get(`SELECT 1 FROM calculations WHERE calc = 'kuendigungsfrist' AND created_at >= ?`, c.since) },
      { label: 'Bestätigung abgeschlossen', ok: (c, d) => done(taskFromInbox(d.ext)) },
    ],
    tips: ['Rechner „Kündigungsfrist“ in der Aufgabe – Satzung § 4: drei Monate zum Jahresende.', 'Gelb, weil Mitgliedsdaten betroffen sind.'],
  },
];

// ---------- Alltagsrauschen: kleine Ereignisse an simulierten Tagen ----------

const NOISE = [
  () => queueMail(MAILBOX.bezirk, { from: 'info@ttvb-musterland.example', fromName: 'Tischtennisverband Musterland', subject: 'Newsletter: Regeländerungen zur neuen Saison', body: 'Liebe Vereine, die wichtigsten Änderungen: Aufschlagregel, Belagliste, Zeitspiel. Details auf der Verbandsseite.' }),
  () => queueMail(MAILBOX.ttv, { from: 'kapitaen.h1@mail.example', fromName: 'Kapitän Herren I', subject: 'Spielbericht vom Wochenende', body: 'Hi, 9:5 gewonnen! Bericht im Anhang, Bilder folgen.', attachments: [{ name: 'Spielbericht_H1.txt', mime: 'text/plain', data: Buffer.from('TTV Musterhausen – Gegner 9:5 (Fantasie)') }] }),
  () => queueMail(MAILBOX.ttv, { from: 'hallenplan@gemeinde-musterhausen.example', fromName: 'Gemeinde Musterhausen', subject: 'Hallenbelegungsplan nächster Monat', body: 'Anbei der aktuelle Belegungsplan.', attachments: [{ name: 'Hallenbelegung_naechster_Monat.pdf', mime: 'application/pdf', data: pdf('Belegungsplan') }] }),
  () => addInbound(null, { channel: 'website', sender: 'Kontaktformular', subject: 'Schnuppertraining für Erwachsene?', area_id: area('ttv-musterhausen'), body: 'Hallo, ich (42) würde gern mal wieder spielen. Gibt es ein Probetraining?' }),
  () => addInbound(null, { channel: 'whatsapp', sender: 'Trainerin Tina', subject: 'Training fällt aus', area_id: area('ttv-musterhausen'), body: 'Donnerstag fällt das Jugendtraining aus, Halle belegt.' }),
  () => queueMail(MAILBOX.sv, { from: 'abteilungen@sv-beispieldorf.example', fromName: 'Hauptverein SV Beispieldorf', subject: 'Abteilungsberichte bis Monatsende', body: 'Bitte die Abteilungsberichte für die Hauptversammlung bis Monatsende schicken.' }),
  () => queueMail(MAILBOX.bezirk, { from: 'sport@tt-musterkreis.example', fromName: 'Bezirkssportwart', subject: 'Ausschreibung Bezirksmeisterschaften', body: 'Anbei die Ausschreibung.', attachments: [{ name: 'Ausschreibung_BM.pdf', mime: 'application/pdf', data: pdf('Ausschreibung BM') }] }),
];

/** Deterministischer Zufall je Tag, damit ein Durchlauf nachvollziehbar bleibt. */
function rnd(seed) { let x = 0; for (const ch of seed) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return () => { x = (x * 1103515245 + 12345) >>> 0; return x / 2 ** 32; }; }

export function dailyNoise(day) {
  if (!getSetting('sim_rauschen', true)) return null;
  const r = rnd(day);
  if (r() > 0.45) return null;
  const i = Math.floor(r() * NOISE.length);
  NOISE[i]();
  return 'Alltag: neue Nachricht eingegangen.';
}
