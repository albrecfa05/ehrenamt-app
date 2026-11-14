// Die Geschichte der Vereinswelt.
//
// Kapitel 1 „Die App einrichten“: Der Verein läuft seit Jahren – mit Ordnern, Asana, Mails und WhatsApp.
// Jetzt kommt die App dazu. Jede Prüfung vergleicht den Stand der App mit den Unterlagen des Vereins.
//
// Kapitel 2 „Vereinsalltag“: Ereignisse aus typischen Problemen von Sportvereinen. Sie kommen über die
// Kanäle der Welt (Briefkasten, Postfach, WhatsApp, click-TT) – nie direkt in die App. Wie im echten
// Leben muss man sie selbst in die App holen (oder die App holt sie, wenn das Postfach verbunden ist).
// Geprüft wird am Datenbestand der App; die Welt liest dort nur.

import { q, getSetting } from '../../server/db.js';
import { addDays, formatDateDe, today } from '../../server/util.js';
import { W, save, log } from './zustand.js';
import { mail, post, whatsapp } from './kanaele.js';
import { makePdf, tinyJpeg } from './pdf.js';
import { MAILBOX, HALL, VEREIN, sponsors, nextWeekday } from './verein.js';

// ---------- Hilfen zum Lesen der App-Daten ----------
const one = (sql, ...p) => q.get(sql, ...p);
const all = (sql, ...p) => q.all(sql, ...p);
const like = (cols, words) => `(${words.map(() => cols.map(c => `${c} LIKE ?`).join(' OR ')).join(' OR ')})`;
const likeArgs = (cols, words) => words.flatMap(w => cols.map(() => `%${w}%`));
const tasksAbout = (since, ...words) => all(`SELECT * FROM tasks WHERE created_at >= ? AND ${like(['title', 'description'], words)} ORDER BY id`, since, ...likeArgs(['title', 'description'], words));
const taskAbout = (since, ...words) => tasksAbout(since, ...words)[0] || null;
const tplKey = (id) => (id == null ? null : one('SELECT key FROM process_templates WHERE id = ?', id)?.key);
const textId = (key) => one('SELECT id FROM text_templates WHERE key = ?', key)?.id ?? -1;
const drafts = (since, key, taskId = null) => all(`SELECT * FROM drafts WHERE created_at >= ? AND template_id = ?${taskId ? ' AND task_id = ?' : ''}`, since, textId(key), ...(taskId ? [taskId] : []));
const done = (t) => t?.status === 'erledigt';
const doneBy = (t, date) => done(t) && !!t.completed_at && t.completed_at.slice(0, 10) <= date;
const appInbox = (since, subjectLike) => one('SELECT * FROM inbox WHERE created_at >= ? AND subject LIKE ? ORDER BY id DESC', since, subjectLike);
const areaLike = (w) => one('SELECT * FROM areas WHERE active = 1 AND name LIKE ?', `%${w}%`);
const player = () => one(`SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`);
const sentTo = (since, addr) => W().mails.some(m => m.folder === 'sent' && m.received >= since && (m.to || '').toLowerCase().includes(addr));
const pdf = (title, lines) => makePdf([{ text: title, size: 15, bold: true, gap: 0 }, { rule: true }, ...lines.map(t => typeof t === 'string' ? { text: t } : t)], { title });

/** Heimspiel einer Mannschaft im Fenster [min, max] Tage; sonst das nächste. */
function homeGame(team, min, max) {
  const d = today();
  const g = W().games.filter(x => x.team === team && x.home && !x.cancelled);
  return g.find(x => x.date >= addDays(d, min) && x.date <= addDays(d, max)) || g.find(x => x.date >= addDays(d, min)) || g[0];
}

// ---------- Kapitel 1: Die App einrichten ----------

export const EINRICHTUNG = [
  { key: 'konto', label: 'Erstes Admin-Konto angelegt (du bist Mia Muster, 1. Vorsitzende)', ok: () => !!player(),
    tip: 'Die App öffnen und das erste Konto anlegen. Danach startet der Einrichtungsassistent.' },
  { key: 'bereiche', label: 'Bereiche heißen wie im Verein: TTV Musterhausen und Bezirk Musterkreis (SV Beispieldorf nur, wenn oben gewählt)', ok: () => !!(areaLike('Musterhausen') && (!W().zweiterVerein || areaLike('Beispieldorf')) && one(`SELECT 1 FROM areas WHERE active = 1 AND type = 'bezirk' AND name LIKE '%Musterkreis%'`)),
    tip: 'Assistent Schritt 1: „Mein Verein“ umbenennen und den Bezirk als Typ „Bezirk“ hinzufügen (SV Beispieldorf nur mit zweitem Verein).' },
  { key: 'konten', label: 'Vorstandskollegen haben Konten (mindestens 4, davon 2 Admins)', ok: () => one(`SELECT COUNT(*) AS n FROM users WHERE active = 1`).n >= 4 && one(`SELECT COUNT(*) AS n FROM users WHERE active = 1 AND role = 'admin'`).n >= 2,
    tip: 'Vereinsordner → Ämterliste. Admin: Vorsitz, Stellvertretung, Kasse, Bezirk. Zuarbeit: z. B. Jugend, Presse.' },
  { key: 'aemter', label: 'Ämter im TTV laut Ämterliste besetzt (mindestens 6)', ok: () => { const a = areaLike('Musterhausen'); return !!a && one('SELECT COUNT(*) AS n FROM offices WHERE area_id = ? AND holder_id IS NOT NULL', a.id).n >= 6; },
    tip: 'Assistent Schritt 2 – Inhaber und Vertretung je Amt.' },
  { key: 'vertretung', label: 'Vertretungen eingetragen (mindestens 3 Ämter im TTV)', ok: () => { const a = areaLike('Musterhausen'); return !!a && one('SELECT COUNT(*) AS n FROM offices WHERE area_id = ? AND deputy_id IS NOT NULL', a.id).n >= 3; },
    tip: 'Die Ämterliste nennt die bisherigen Vertretungen. Die Kasse hat keine – das rächt sich später.' },
  { key: 'fristen', label: 'Fristen laut Satzung: Einladung 21 Tage, Kündigung 3 Monate', ok: () => Number(getSetting('einladung_frist_tage', 14)) === 21 && Number(getSetting('kuendigung_frist_monate', 3)) === 3,
    tip: 'Satzung § 7 („drei Wochen“) und § 4 – Assistent Schritt 3.' },
  { key: 'beitraege', label: 'Beitragsstufen laut Beitragsordnung (48 € und 96 €)', ok: () => { const s = getSetting('beitragsstufen', []) || []; return s.some(x => Number(x.beitrag) === 48) && s.some(x => Number(x.beitrag) === 96); },
    tip: 'Beitragsordnung § 1 – die Voreinstellung der App (60/120 €) stimmt für diesen Verein nicht.' },
  { key: 'satzung', label: 'Satzung in der Wissensbasis (Auskunft mit Fundstelle)', ok: () => !!one(`SELECT 1 FROM kb_documents WHERE active = 1 AND source_type = 'satzung'`),
    tip: 'Vereinsordner → Satzung → „Text kopieren“, dann Assistent Schritt 8 einfügen.' },
  { key: 'datenschutz', label: 'Über die Datenschutz-Schalter entschieden', ok: () => getSetting('gelb_lokal', null) !== null || getSetting('gelb_extern', null) !== null || !!(getSetting('einrichtung', {}) || {}).steps?.datenschutz,
    tip: 'Assistent Schritt 4. Im Simulator darf man beide einschalten – es gibt nur Fantasiedaten.' },
  { key: 'postfach', label: 'Vorstandspostfach mit der App verbunden', ok: () => (getSetting('m365', {})?.mailboxes || []).some(m => String(m.address).toLowerCase() === MAILBOX.ttv),
    tip: 'Microsoft-365-Bereich der Vereinswelt: Zugangsdaten liegen schon bereit. In der App: Adminpanel → Verbindungen → Postfächer eintragen.' },
  { key: 'spielplan', label: 'Spielpläne abonniert (mindestens eine Mannschaft)', ok: () => one(`SELECT COUNT(*) AS n FROM feeds WHERE active = 1 AND url LIKE '%/clicktt/%'`).n >= 1,
    tip: 'click-TT-Bereich der Vereinswelt: ICS-Adresse kopieren, in der App unter Verbindungen → Spielpläne eintragen, Heimspiel-Erkennung „TTV Musterhausen“.' },
  { key: 'asana', label: 'Bisherige Aufgaben aus Asana übernommen', ok: () => one(`SELECT COUNT(*) AS n FROM tasks WHERE parent_source LIKE 'asana:%'`).n >= 5,
    tip: 'Vereinsordner → Asana-Export herunterladen; App: Adminpanel → Asana-Import, Bereich TTV Musterhausen.' },
  { key: 'kalender', label: 'Jahreskalender mit dem Jahresplan abgeglichen (mindestens 6 Termine bestätigt)', ok: () => one('SELECT COUNT(*) AS n FROM recurring WHERE active = 1 AND assumption = 0').n >= 6,
    tip: 'Vereinsordner → Jahresplan. Z. B. MV am dritten Freitag im März, Beitragseinzug zum 1. März.' },
  { key: 'sponsoren', label: 'Sponsoren erfasst (mindestens 3)', ok: () => one('SELECT COUNT(*) AS n FROM sponsors').n >= 3,
    tip: 'Vereinsordner → Sponsorenübersicht; App: Sponsoren → „Sponsor anlegen“ mit Laufzeitende.' },
  { key: 'jugendplaner', label: 'Jugendplaner angebunden (Bereich gewählt und abgeglichen)', ok: () => !!(getSetting('jugendplaner', {}) || {}).area_id && !!getSetting('jugendplaner_stand', null)?.counts && !getSetting('jugendplaner_stand', null)?.error,
    tip: 'Die Zugangsdaten setzt der Simulator selbst. App: Adminpanel → Verbindungen → Jugendplaner: Bereich TTV Musterhausen wählen, „Jetzt abgleichen“, „Spielplan-Abo anlegen“.' },
  { key: 'automatik', label: 'Voreinstellung für Automatisierungen gewählt', ok: () => !!getSetting('einrichtung_preset', null),
    tip: 'Assistent Schritt 6.' },
  { key: 'fertig', label: 'Einrichtung abgeschlossen', ok: () => !!(getSetting('einrichtung', {}) || {}).done,
    tip: 'Assistent → Schritt „Los geht’s“ → „Einrichtung abschließen“.' },
];

// ---------- Kapitel 2: Ereignisse ----------

const year = () => Number(today().slice(0, 4));

export const EREIGNISSE = [
  {
    key: 'mitgliedsantrag', title: 'Neues Mitglied: Mitgliedsantrag im Briefkasten', tag: 1, kanal: 'Briefkasten', difficulty: 2,
    problem: 'Familie Lustig wirft nach dem Training den ausgefüllten Antrag für ihre Tochter Lea (12) ein. Das SEPA-Mandat fehlt, das Foto-Häkchen ist nicht gesetzt. Unvollständige Anträge bleiben in vielen Vereinen wochenlang liegen.',
    start() {
      const born = `03.05.${year() - 12}`;
      const entry = addDays(today().slice(0, 8) + '01', 32).slice(0, 8) + '01';
      const file = makePdf([
        { text: 'TTV Musterhausen 1962 e. V.', size: 9, gap: 0 },
        { text: 'Antrag auf Mitgliedschaft', size: 17, bold: true },
        { text: 'Bitte vollständig ausfüllen und mit SEPA-Lastschriftmandat beim Vorstand abgeben.', size: 9 },
        { rule: true },
        { field: 'Vorname, Name', value: 'Lea Lustig' }, { field: 'Geburtsdatum', value: born },
        { field: 'Straße, Hausnummer', value: 'Ahornweg 7' }, { field: 'PLZ, Ort', value: '12345 Musterhausen' },
        { field: 'E-Mail', value: 'familie.lustig@mail.example' },
        { field: 'Erziehungsberechtigte', value: 'Lisa und Lars Lustig' },
        { field: 'Eintritt zum', value: formatDateDe(entry) },
        { space: 6 }, { text: 'Beitragsart (laut Beitragsordnung)', bold: true, size: 10 },
        { check: 'Kinder und Jugendliche bis 17 Jahre – 48 € im Jahr', on: true }, { check: 'Erwachsene ab 18 Jahren – 96 € im Jahr', on: false },
        { space: 6 }, { text: 'Einwilligung', bold: true, size: 10 },
        { check: 'Ich bin einverstanden, dass Fotos meines Kindes auf der Homepage veröffentlicht werden.', on: false },
        { check: 'Ich habe die Datenschutzhinweise erhalten.', on: true },
        { space: 6 }, { field: 'Ort, Datum', value: `Musterhausen, ${formatDateDe(today())}` }, { field: 'Unterschrift Erziehungsberechtigte', value: 'Lisa Lustig' },
        { space: 14 }, { text: 'SEPA-Lastschriftmandat', bold: true, size: 12 },
        { text: 'Gläubiger-ID DE00ZZZ00000000000 (Fantasie). Ich ermächtige den TTV Musterhausen, Zahlungen von meinem Konto mittels Lastschrift einzuziehen.', size: 9 },
        { field: 'Kontoinhaber', value: '' }, { field: 'IBAN', value: '' }, { field: 'Unterschrift', value: '' },
        { text: 'Handschriftlich: „Mandat reichen wir nach – Lisa“', size: 10, gap: 8 },
      ], { title: 'Mitgliedsantrag Lea Lustig' });
      post({ from: 'Familie Lustig (eingeworfen)', title: 'Mitgliedsantrag Lea Lustig', text: 'Ausgefüllter Antrag für Lea (12). Das SEPA-Mandat ist nicht ausgefüllt („reichen wir nach“), die Foto-Einwilligung ist nicht angekreuzt.', file: ['Mitgliedsantrag_Lea_Lustig.pdf', file] });
      return {};
    },
    onDay(c, d) {
      if (d.sepa || c.day < 3) return null;
      d.sepa = true;
      const t = taskAbout(c.since, 'Lustig');
      mail(MAILBOX.ttv, { from: 'familie.lustig@mail.example', fromName: 'Familie Lustig', subject: `${t ? `[#${t.id}] ` : ''}SEPA-Mandat Lea Lustig`,
        body: 'Hallo liebes TTV-Team,\nanbei wie versprochen das unterschriebene SEPA-Mandat für Lea.\nViele Grüße\nLisa Lustig',
        attachments: [['SEPA-Mandat_Lea_Lustig.pdf', pdf('SEPA-Lastschriftmandat', [{ field: 'Kontoinhaber', value: 'Lisa Lustig' }, { field: 'IBAN', value: 'DE00 0000 0000 0000 0000 00 (Fantasie)' }, { field: 'Unterschrift', value: 'Lisa Lustig' }])]] });
      return 'Familie Lustig hat das SEPA-Mandat ans Vorstandspostfach gemailt.';
    },
    checks: [
      { label: 'Antrag in der App als Neuaufnahme (Vorgang VOR-1)', ok: (c) => tplKey(taskAbout(c.since, 'Lustig')?.template_id) === 'VOR-1' },
      { label: 'Als gelber Vorgang eingestuft (Daten einer Minderjährigen)', ok: (c) => taskAbout(c.since, 'Lustig')?.data_class === 'gelb' },
      { label: 'Antrag als PDF in der App abgelegt', ok: () => !!one(`SELECT 1 FROM files WHERE original_name LIKE '%Mitgliedsantrag%' AND deleted_at IS NULL`) },
      { label: '„Wartet auf“ das SEPA-Mandat gesetzt', ok: (c) => { const t = taskAbout(c.since, 'Lustig'); return t?.status === 'wartet' && /sepa|mandat|lastschrift/i.test(`${t.waiting_what} ${t.waiting_who}`); } },
      { label: 'Willkommensmail vorbereitet', ok: (c) => { const t = taskAbout(c.since, 'Lustig'); return !!t && drafts(c.since, 'T-WILLKOMMEN', t.id).length > 0; } },
      { label: 'Nach Eingang des Mandats abgeschlossen', ok: (c, d) => !!d.sepa && done(taskAbout(c.since, 'Lustig')) },
    ],
    tips: ['Briefkasten → „Scannen und ans Postfach“: der Antrag kommt als Mail mit PDF. Oder PDF herunterladen und in der App „Eingang erfassen“ mit Anhang (Kanal Post).',
      'Beim Übernehmen: Vorgang VOR-1 „Neuaufnahme“, Datenklasse gelb.', 'Status „Wartet“ – worauf: SEPA-Mandat. Die Antwort der Familie trägt die Vorgangsnummer im Betreff und wird zugeordnet.',
      'Die Willkommensmail kommt aus der Textvorlage – oder automatisch per Regel, wenn der Schalter „Gelb lokal“ an ist und die Beispielregel freigegeben wurde.'],
  },
  {
    key: 'fahrer_absage', title: 'Jugend: Fahrer springt ab', tag: 2, kanal: 'WhatsApp + Jugendplaner', difficulty: 1,
    problem: 'Fahrdienste für Jugendspiele hängen an wenigen Eltern. Sagt jemand kurzfristig ab, merkt es der Vorstand oft erst am Spieltag.',
    start() {
      const d = today();
      const jp = W().jp;
      const g = jp.games.filter(x => !x.cancelled && x.date >= addDays(d, 2) && x.date <= addDays(d, 10)).sort((a, b) => a.date.localeCompare(b.date))[0] || jp.games.find(x => x.date >= d);
      const who = g.drivers || 'Petra Ahorn';
      g.drivers = ''; g.respTeam = '';
      jp.rev = (jp.rev || 0) + 1;
      save();
      whatsapp('eltern', who, `Sorry, wir können am ${formatDateDe(g.date)} doch nicht zur ${jp.youthTeams.find(t => t.id === g.team)?.name || g.team} fahren – ich hab’s im Jugendplaner rausgenommen.`);
      return { game: g.id, date: g.date };
    },
    checks: [
      { label: 'Die App hat die Lücke erkannt (Aufgabe aus dem Jugendplaner-Abgleich)', ok: (c, d) => !!one('SELECT 1 FROM tasks WHERE parent_source = ?', `jugendplaner:${d.game}`) },
      { label: 'Im Jugendplaner ist wieder ein Fahrer eingetragen', ok: (c, d) => !!W().jp.games.find(g => g.id === d.game)?.drivers },
      { label: 'Die Aufgabe hat sich nach dem nächsten Abgleich selbst erledigt', ok: (c, d) => !!W().jp.games.find(g => g.id === d.game)?.drivers && one('SELECT status FROM tasks WHERE parent_source = ? ORDER BY id DESC', `jugendplaner:${d.game}`)?.status === 'erledigt' },
    ],
    tips: ['Jugendplaner in der App verbinden (Kapitel 1). Der Abgleich läuft alle paar Stunden und beim Vorspulen – oder „Jetzt abgleichen“ unter Spielbetrieb Jugend.', 'Neuen Fahrer im Jugendplaner der Vereinswelt eintragen (Menü „Jugendplaner“) – nicht in der App: dort wird nur angezeigt.', 'Danach erneut abgleichen; die Aufgabe schließt sich mit Kommentar.'],
  },
  {
    key: 'sr_absage', title: 'Schiedsrichter sagt kurzfristig ab', tag: 3, kanal: 'Postfach Bezirk', difficulty: 1,
    problem: 'Schiedsrichter sind knapp; Absagen kommen oft erst wenige Tage vor dem Spiel. Ohne festen Ablauf wird hektisch herumtelefoniert.',
    start() {
      const g = homeGame('herren1', 3, 8);
      mail(MAILBOX.bezirk, { from: 'k.kurzfrist@mail.example', fromName: 'Klaus Kurzfrist', subject: `Absage Schiedsrichtereinsatz ${formatDateDe(g.date)}`,
        body: `Hallo Tom,\nleider kann ich am ${formatDateDe(g.date)} beim Spiel ${g.summary} nicht pfeifen – Familienfeier.\nTut mir leid!\nKlaus` });
      return { game_date: g.date };
    },
    checks: [
      { label: 'Absage als Aufgabe im Bereich Bezirk', ok: (c) => !!tasksAbout(c.since, 'Kurzfrist', 'Schiedsrichter').find(t => t.area_id === areaLike('Musterkreis')?.id) },
      { label: 'Vorgang „Schiedsrichter-Ersatz“ (VOR-3)', ok: (c) => tasksAbout(c.since, 'Kurzfrist', 'Schiedsrichter').some(t => tplKey(t.template_id) === 'VOR-3') },
      { label: 'Rundfrage an den Schiedsrichter-Pool vorbereitet', ok: (c) => drafts(c.since, 'T-SR-RUNDFRAGE').length > 0 },
      { label: 'Vor dem Spieltag erledigt', ok: (c, d) => tasksAbout(c.since, 'Kurzfrist', 'Schiedsrichter').some(t => doneBy(t, d.game_date)) },
    ],
    tips: ['Die Mail liegt im Postfach des Bezirks. Ist es verbunden, holt die App sie beim Abruf.', 'Textvorlage „Rundfrage Schiedsrichter-Ersatz“ in der Aufgabe.', 'Ersatz gilt als gefunden, sobald du die Aufgabe abschließt.'],
  },
  {
    key: 'foerderung', title: 'Fördermittel: Antragsfrist', tag: 4, kanal: 'Postfach TTV', difficulty: 2,
    problem: 'Zuschüsse von Sportbund und Gemeinde verfallen, weil Fristen übersehen werden oder niemand den Antrag schreibt.',
    start() {
      const deadline = addDays(today(), 12);
      mail(MAILBOX.ttv, { from: 'foerderung@sportbund-musterland.example', fromName: 'Sportbund Musterland', subject: 'Förderprogramm Vereinsausstattung – Antragsfrist',
        body: `Liebe Vereine,\nim Programm „Vereinsausstattung“ werden Sportgeräte mit bis zu 40 % bezuschusst. Anträge bitte bis spätestens ${formatDateDe(deadline)} einreichen.\nIhr Sportbund` });
      return { deadline };
    },
    checks: [
      { label: 'Aufgabe mit Frist vor dem Antragsschluss', ok: (c, d) => tasksAbout(c.since, 'Förder', 'Vereinsausstattung').some(t => t.due_date && t.due_date <= d.deadline) },
      { label: 'Antrag aus der Textvorlage „Förder- oder Zuschussantrag“', ok: (c) => drafts(c.since, 'T-FOERDER').length > 0 },
      { label: 'Vor Fristende abgeschlossen', ok: (c, d) => tasksAbout(c.since, 'Förder', 'Vereinsausstattung').some(t => doneBy(t, d.deadline)) },
    ],
    tips: ['Beim Übernehmen die Frist ein paar Tage vor den Antragsschluss legen.', 'Vorgang VOR-5 „Bescheinigungen und Anträge“ passt; die Ballmaschine aus Asana wäre ein Kandidat.'],
  },
  {
    key: 'phishing', title: 'Neue Bankverbindung per Mail', tag: 5, kanal: 'Postfach TTV', difficulty: 1,
    problem: 'Vereine sind beliebtes Ziel der „Chef-Masche“: angeblich die Vorsitzende, dringend, neue IBAN. Ehrenamtliche Kassierer überweisen unter Zeitdruck.',
    start() {
      mail(MAILBOX.ttv, { from: 'mia.muster.vorstand@freemail.example', fromName: 'Mia Muster', subject: 'Dringend: Überweisung heute noch',
        body: 'Hallo Ben,\nbitte überweise heute noch 1.480 € für die neuen Trikots. Der Lieferant hat eine neue Bankverbindung: DE89 3704 0044 0532 0130 00. Ich bin den ganzen Tag im Meeting und nicht erreichbar.\nMia' });
      return {};
    },
    onDay(c, d) {
      if (d.followup || c.day < 1) return null;
      d.followup = true;
      mail(MAILBOX.ttv, { from: 'mia.muster.vorstand@freemail.example', fromName: 'Mia Muster', subject: 'Re: Dringend: Überweisung heute noch', body: 'Hast du schon überwiesen??? Es eilt wirklich!' });
      whatsapp('vorstand', 'Ben Beispiel', 'Mia, hast du mir gerade eine Mail wegen 1.480 € geschickt? Kommt mir komisch vor.');
      return 'Der Absender hakt nach; Ben fragt in der Vorstandsgruppe nach.';
    },
    checks: [
      { label: 'Mail in der App angekommen (Postfach abgerufen)', ok: (c) => !!appInbox(c.since, 'Dringend: Überweisung%') },
      { label: 'Nicht als Aufgabe übernommen, sondern abgelegt', ok: (c) => { const i = appInbox(c.since, 'Dringend: Überweisung%'); return !!i && i.status === 'abgelegt' && !i.task_id; } },
      { label: 'Keine Zahlungsaufgabe mit der fremden IBAN', ok: (c) => c.day >= 1 && !one(`SELECT 1 FROM tasks WHERE created_at >= ? AND description LIKE '%0532 0130%'`, c.since) },
    ],
    tips: ['Der Eingang zeigt Auffälligkeiten (Bankverbindung, Zeitdruck, fremder Absender).', '„Ablegen“ mit Grund. Im echten Verein bei Mia auf bekanntem Weg nachfragen – Ben tut das in der WhatsApp-Gruppe.'],
  },
  {
    key: 'hallensperrung', title: 'Halle gesperrt – Heimspiel verlegen', tag: 6, kanal: 'Postfach TTV', difficulty: 2,
    problem: 'Hallenzeiten werden kurzfristig gestrichen (Wasserschaden, Schulfest). Dann muss ein Heimspiel fristgerecht verlegt werden.',
    start() {
      const g = homeGame('herren1', 6, 13);
      mail(MAILBOX.ttv, { from: 'halle@gemeinde-musterhausen.example', fromName: 'Gemeinde Musterhausen – Hallenverwaltung', subject: 'Sperrung Sporthalle wegen Wasserschaden',
        body: `Sehr geehrte Damen und Herren,\nwegen eines Wasserschadens bleibt die Sporthalle am ${formatDateDe(g.date)} gesperrt. Den geänderten Hallenplan finden Sie im Anhang.\nMit freundlichen Grüßen\nIhre Gemeindeverwaltung`,
        attachments: [['Hallenplan_Sperrung.pdf', pdf('Hallensperrung', [`Sporthalle Musterhausen gesperrt am ${formatDateDe(g.date)}.`, 'Ersatzzeiten: Freitag in der Folgewoche 19–22 Uhr.'])]] });
      return { uid: g.uid, old: g.date, summary: g.summary };
    },
    react(c, d) {
      if (d.moved) return null;
      if (!drafts(c.since, 'T-VERLEGUNG').length && !sentTo(c.since, 'staffel@')) return null;
      const g = W().games.find(x => x.uid === d.uid);
      g.date = addDays(g.date, 6); g.time = '19:30';
      d.moved = g.date;
      save();
      mail(MAILBOX.ttv, { from: 'staffel@tt-musterkreis.example', fromName: 'Staffelleitung Bezirksliga', subject: `Verlegung genehmigt: ${d.summary}`,
        body: `Hallo,\ndie Verlegung ist genehmigt. Neuer Termin: ${formatDateDe(g.date)}, 19:30 Uhr. click-TT ist aktualisiert.\nGruß, Staffelleitung` });
      return `Staffelleitung hat die Verlegung genehmigt (neu: ${formatDateDe(g.date)}).`;
    },
    checks: [
      { label: 'Hallenplan in der Ablage der App', ok: () => !!one(`SELECT 1 FROM files WHERE original_name = 'Hallenplan_Sperrung.pdf' AND deleted_at IS NULL`) },
      { label: 'Verlegungsantrag an die Staffelleitung (Textvorlage oder Mail)', ok: (c) => drafts(c.since, 'T-VERLEGUNG').length > 0 || sentTo(c.since, 'staffel@') },
      { label: 'Neuer Termin über das Spielplan-Abo in der App angekommen', ok: (c, d) => !!d.moved && !!one('SELECT 1 FROM events WHERE external_uid LIKE ? AND date = ?', `${d.uid}%`, d.moved) },
    ],
    tips: ['Eine Ablageregel „Absender gemeinde-musterhausen.example → Ordner Hallenbelegung“ legt solche Pläne künftig automatisch ab.', 'Aufgabe mit VOR-3, Entwurf „Anfrage Spielverlegung“. Oder im Postfach der Vereinswelt direkt an staffel@tt-musterkreis.example schreiben.', 'Die Staffel antwortet am nächsten Tag; der Spielplan-Abruf trägt den neuen Termin ein (Herren I muss abonniert sein).'],
  },
  {
    key: 'ideen', title: 'Was wurde aus den Ideen der Versammlung?', tag: 7, kanal: 'Postfach TTV', difficulty: 1,
    problem: 'Vorschläge aus Versammlungen werden notiert und nie entschieden. Engagierte Mitglieder sind dann frustriert.',
    start() {
      mail(MAILBOX.ttv, { from: person('frieda'), fromName: 'Frieda Feder', subject: 'Ideen aus der letzten MV', body: 'Hallo Mia,\nim Protokoll der letzten MV stehen drei Ideen (Ausflug, Mini-Meisterschaften, Hobbyrunde). Mitglieder fragen, was daraus wird. Können wir das entscheiden?\nFrieda' });
      return {};
    },
    checks: [
      { label: 'Alle drei Ideen in der App', ok: () => IDEEN.every(t => !!one('SELECT 1 FROM tasks WHERE title LIKE ?', `%${t}%`)) },
      { label: 'Alle drei entschieden (umgesetzt, geplant oder verworfen)', ok: () => IDEEN.every(t => { const x = one('SELECT * FROM tasks WHERE title LIKE ? ORDER BY id DESC', `%${t}%`); return !!x && (x.kind !== 'idee' || ['erledigt', 'verworfen'].includes(x.status)); }) },
    ],
    tips: ['Kommen mit dem Asana-Import als Ideen (Abschnitt „Ideen“), sonst im Ideenspeicher anlegen.', 'Idee öffnen → in Aufgabe umwandeln oder verwerfen (mit Begründung).'],
  },
  {
    key: 'helfer', title: 'Helfermangel am Heimspieltag', tag: 8, kanal: 'WhatsApp', difficulty: 2,
    problem: 'Immer weniger Menschen melden sich für Dienste. Am Heimspieltag fehlen Kuchen, Kasse und Aufbau.',
    start() {
      const g = homeGame('herren1', 4, 9);
      whatsapp('helfer', 'Karin Kuchen', `Hallo zusammen, ich bin am ${formatDateDe(g.date)} leider nicht da. Küche und Kuchen sind damit offen – sorry!`);
      whatsapp('helfer', 'Paul Presse', 'Ich kann diesmal auch nicht 🙈');
      return { uid: g.uid, game_date: g.date };
    },
    checks: [
      { label: 'Heimspieltag-Aufgabe aus dem Spielplan', ok: (c, d) => !!one('SELECT 1 FROM tasks WHERE parent_source LIKE ?', `spielplan:%:${d.uid}%`) },
      { label: 'Aufruf Hallen- und Küchendienst vorbereitet', ok: (c) => drafts(c.since, 'T-HEIMSPIEL').length + drafts(c.since, 'T-HELFER').length > 0 },
      { label: 'Absagen aus WhatsApp in der App festgehalten', ok: (c) => !!one(`SELECT 1 FROM inbox WHERE created_at >= ? AND (body LIKE '%Kuchen%' OR sender LIKE '%Karin%')`, c.since) || !!one(`SELECT 1 FROM comments WHERE created_at >= ? AND (body LIKE '%Karin%' OR body LIKE '%Kuchen%')`, c.since) },
      { label: 'Heimspieltag vor Anpfiff vorbereitet', ok: (c, d) => doneBy(one('SELECT * FROM tasks WHERE parent_source LIKE ?', `spielplan:%:${d.uid}%`), d.game_date) },
    ],
    tips: ['Herren I muss abonniert sein, „Heimspiel-Aufgaben“ im Katalog an – die Aufgabe entsteht 10 Tage vorher.', 'WhatsApp: Text kopieren → App „Eingang erfassen“ (Kanal WhatsApp) oder als Kommentar an die Heimspiel-Aufgabe.'],
  },
  {
    key: 'fotos', title: 'Fotos vom Jugendturnier per WhatsApp', tag: 9, kanal: 'WhatsApp', difficulty: 2,
    problem: 'Bilder Minderjähriger dürfen nur mit Einwilligung veröffentlicht werden (Satzung § 10). Vieles läuft unkontrolliert über private Messenger.',
    start() {
      whatsapp('vorstand', 'Trainer Theo', 'Hier zwei Fotos von den Kids beim Turnier – super für die Homepage! Ob alle Eltern einverstanden sind, weiß ich nicht genau.', [['Jugendturnier_1.jpg', tinyJpeg()], ['Jugendturnier_2.jpg', tinyJpeg()]]);
      return {};
    },
    checks: [
      { label: 'In der App erfasst', ok: (c) => !!one(`SELECT 1 FROM inbox WHERE created_at >= ? AND (subject LIKE '%Foto%' OR body LIKE '%Foto%')`, c.since) || tasksAbout(c.since, 'Foto', 'Jugendturnier').length > 0 },
      { label: 'Fotos nicht als grün (öffentlich) abgelegt', ok: (c) => (!!one(`SELECT 1 FROM inbox WHERE created_at >= ? AND (subject LIKE '%Foto%' OR body LIKE '%Foto%') AND status != 'neu'`, c.since) || tasksAbout(c.since, 'Foto', 'Jugendturnier').length > 0) && !one(`SELECT 1 FROM files WHERE original_name LIKE 'Jugendturnier_%' AND data_class = 'gruen' AND deleted_at IS NULL`) },
      { label: 'Einwilligungen der Eltern als Schritt oder Kommentar', ok: (c) => tasksAbout(c.since, 'Foto', 'Jugendturnier').some(t => /einwillig|einverst/i.test(t.description || '') || !!one(`SELECT 1 FROM comments WHERE task_id = ? AND (body LIKE '%inwillig%' OR body LIKE '%inverst%')`, t.id) || !!one(`SELECT 1 FROM task_steps WHERE task_id = ? AND (title LIKE '%inwillig%' OR title LIKE '%inverst%')`, t.id)) },
    ],
    tips: ['Fotos aus der WhatsApp-Gruppe herunterladen, in der App „Eingang erfassen“ mit Anhängen.', 'Übernehmen mit VOR-7, Datenklasse gelb; Schritt „Einwilligungen der Eltern prüfen“ ergänzen.'],
  },
  {
    key: 'mv_einladung', title: 'Mitgliederversammlung fristgerecht einladen', tag: 10, kanal: 'Postfach TTV', difficulty: 2,
    problem: 'Formfehler bei der Einladung (Frist, Tagesordnung) machen Beschlüsse anfechtbar. Die Satzung verlangt drei Wochen Vorlauf.',
    start() {
      const mv = nextWeekday(today(), 5, 28);
      mail(MAILBOX.ttv, { from: 'frieda.feder@mail.example', fromName: 'Frieda Feder', subject: `Außerordentliche MV am ${formatDateDe(mv)}`,
        body: `Hallo Mia,\nwie besprochen machen wir wegen der Hallensanierung eine außerordentliche Mitgliederversammlung am ${formatDateDe(mv)}, 19:30 Uhr im Vereinsheim. Denk an die Frist aus § 7 – drei Wochen!\nTagesordnung: 1. Begrüßung 2. Hallensanierung und Eigenleistung 3. Verschiedenes\nFrieda` });
      return { mv };
    },
    checks: [
      { label: 'Aufgabe zur Einladung angelegt', ok: (c) => tasksAbout(c.since, 'Mitgliederversammlung', 'MV').length > 0 },
      { label: 'Einladungsfrist mit dem Rechner geprüft', ok: (c) => !!one(`SELECT 1 FROM calculations WHERE calc = 'einladungsfrist' AND created_at >= ?`, c.since) },
      { label: 'Einladung aus der Textvorlage erstellt', ok: (c) => drafts(c.since, 'T-EINLADUNG-MV').length > 0 },
      { label: 'Spätestens 21 Tage vor der Versammlung fertig', ok: (c, d) => tasksAbout(c.since, 'Mitgliederversammlung', 'MV').some(t => doneBy(t, addDays(d.mv, -21))) },
    ],
    tips: ['Rechner „Einladungsfrist“ in der Aufgabe – mit den 21 Tagen aus den Einstellungen.', 'Auskunft: „Wie lange vorher muss eingeladen werden?“ findet § 7 – wenn die Satzung in der Wissensbasis ist.'],
  },
  {
    key: 'fahrdienst', title: 'Jugend: Fahrdienst zum Ranglistenturnier', tag: 11, kanal: 'Postfach Bezirk + WhatsApp', difficulty: 1,
    problem: 'Elterninformationen gehen in Gruppen-Chats unter; am Turniertag fehlen Fahrer oder Startpässe.',
    start() {
      const date = nextWeekday(today(), 0, 9);
      mail(MAILBOX.bezirk, { from: 'jugend@tt-musterkreis.example', fromName: 'Bezirksjugendwart', subject: `Ausschreibung Bezirksrangliste Jugend ${formatDateDe(date)}`,
        body: `Hallo,\nanbei die Ausschreibung zur Bezirksrangliste am ${formatDateDe(date)} in Talstadt, Beginn 9 Uhr.`, attachments: [['Ausschreibung_Rangliste.pdf', pdf('Ausschreibung Bezirksrangliste Jugend', [`Termin: ${formatDateDe(date)}, 9 Uhr, Halle Talstadt.`, 'Meldung über die Vereine.'])]] });
      whatsapp('eltern', 'Paul Paulsen', 'Wer fährt eigentlich zur Rangliste? Wir hätten 3 Plätze frei.');
      return { date };
    },
    checks: [
      { label: 'Aufgabe zur Rangliste im TTV (Jugend)', ok: (c) => tasksAbout(c.since, 'Rangliste').some(t => t.area_id === areaLike('Musterhausen')?.id) },
      { label: 'Elterninformation aus der Vorlage erstellt', ok: (c) => drafts(c.since, 'T-ELTERN').length > 0 },
      { label: 'Mindestens drei Tage vorher erledigt', ok: (c, d) => tasksAbout(c.since, 'Rangliste').some(t => doneBy(t, addDays(d.date, -3))) },
    ],
    tips: ['Die Ausschreibung kommt im Bezirkspostfach an – für den Verein eine eigene Aufgabe im TTV anlegen (VOR-14), am besten für Jana.', 'Das Angebot von Paul Paulsen als Kommentar festhalten.'],
  },
  {
    key: 'sponsor', title: 'Sponsorvertrag läuft aus', tag: 12, kanal: 'Postfach TTV', difficulty: 1,
    problem: 'Sponsoren springen ab, wenn sich niemand meldet. Oft merkt der Verein das Vertragsende erst, wenn die Zahlung fehlt.',
    start() {
      const end = sponsors(W().start).find(s => s.company === 'Bäckerei Krümel').ende;
      mail(MAILBOX.ttv, { from: 'info@baeckerei-kruemel.example', fromName: 'Bäckerei Krümel', subject: 'Unsere Bandenwerbung',
        body: `Hallo TTV,\nunser Vertrag für die Bande läuft am ${formatDateDe(end)} aus. Von euch haben wir lange nichts gehört – wie geht es weiter?\nFrau Krümel` });
      return { end };
    },
    checks: [
      { label: 'Bäckerei Krümel in der App mit Laufzeitende', ok: () => !!one(`SELECT 1 FROM sponsors WHERE company LIKE '%Krümel%' AND end_date IS NOT NULL`) },
      { label: 'Kontakt aufgenommen und erfasst', ok: (c) => (one(`SELECT last_contact FROM sponsors WHERE company LIKE '%Krümel%'`)?.last_contact || '') >= c.day0 },
      { label: 'Vertrag verlängert oder bewusst beendet', ok: (c, d) => { const s = one(`SELECT * FROM sponsors WHERE company LIKE '%Krümel%'`); return !!s && (s.status === 'beendet' || (s.end_date || '') > d.end); } },
    ],
    tips: ['Wenn die Sponsoren bei der Einrichtung erfasst wurden, legt die App die Verlängerungsaufgabe selbst an.', 'Sponsoren → Bäckerei Krümel → „Kontakt erfassen“; Textvorlage „Sponsorenkontakt und Verlängerung“; neues Laufzeitende eintragen.'],
  },
  {
    key: 'auskunft', title: 'Auskunftsersuchen nach Art. 15 DSGVO', tag: 13, kanal: 'Postfach TTV', difficulty: 2,
    problem: 'Auskunftsersuchen müssen innerhalb eines Monats beantwortet werden. Viele Vereine wissen nicht, wo überall Daten liegen.',
    start() {
      mail(MAILBOX.ttv, { from: 'rudi.rastlos@mail.example', fromName: 'Rudi Rastlos', subject: 'Auskunft nach Art. 15 DSGVO',
        body: 'Sehr geehrter Vorstand,\nhiermit verlange ich Auskunft über alle zu meiner Person gespeicherten Daten gemäß Art. 15 DSGVO.\nRudi Rastlos, Mitgliedsnummer 1042' });
      return { deadline: addDays(today(), 30) };
    },
    checks: [
      { label: 'Aufgabe mit Frist innerhalb eines Monats', ok: (c, d) => tasksAbout(c.since, 'Rastlos', 'Art. 15').some(t => t.due_date && t.due_date <= d.deadline) },
      { label: 'Als gelber Vorgang behandelt', ok: (c) => tasksAbout(c.since, 'Rastlos', 'Art. 15').some(t => t.data_class === 'gelb') },
      { label: 'Fristgerecht beantwortet', ok: (c, d) => tasksAbout(c.since, 'Rastlos', 'Art. 15').some(t => doneBy(t, d.deadline)) },
    ],
    tips: ['Auskunft: „Wie schnell muss eine Datenauskunft erfolgen?“ → Satzung § 10.', 'Adminpanel → Datenschutz-Auskunft zeigt, wo die App Daten zu einem Namen hat.'],
  },
  {
    key: 'kuendigung', title: 'Kündigung kurz vor Jahresende', tag: 14, kanal: 'Postfach TTV', difficulty: 2,
    problem: 'Streit um Austrittsfristen und doppelte Beiträge entsteht, wenn Kündigungen nicht sauber nach Satzung geprüft und bestätigt werden.',
    start() {
      mail(MAILBOX.ttv, { from: 'kurt.kuendig@mail.example', fromName: 'Kurt Kündig', subject: 'Kündigung meiner Mitgliedschaft',
        body: 'Hallo,\nhiermit kündige ich meine Mitgliedschaft zum nächstmöglichen Termin. Bitte bestätigt mir das Austrittsdatum.\nKurt Kündig' });
      return {};
    },
    checks: [
      { label: 'Als Mitgliederänderung (VOR-2) übernommen', ok: (c) => tasksAbout(c.since, 'Kündig').some(t => tplKey(t.template_id) === 'VOR-2') },
      { label: 'Austrittsdatum mit dem Kündigungsrechner ermittelt', ok: (c) => !!one(`SELECT 1 FROM calculations WHERE calc = 'kuendigungsfrist' AND created_at >= ?`, c.since) },
      { label: 'Bestätigung abgeschlossen', ok: (c) => tasksAbout(c.since, 'Kündig').some(done) },
    ],
    tips: ['Rechner „Kündigungsfrist“ in der Aufgabe – Satzung § 4: drei Monate zum Jahresende.'],
  },
  {
    key: 'kassenpruefung', title: 'Kassenprüfung: Belege zusammensuchen', tag: 15, kanal: 'Postfach TTV', difficulty: 2,
    problem: 'Kassenprüfungen scheitern an verstreuten Belegen (schon im letzten MV-Protokoll bemängelt). Rechnungen kommen per Mail und landen in privaten Postfächern.',
    start() {
      const date = addDays(today(), 12);
      mail(MAILBOX.ttv, { from: 'gerd.genau@mail.example', fromName: 'Gerd Genau (Kassenprüfer)', subject: `Kassenprüfung am ${formatDateDe(date)}`,
        body: `Hallo Ben, hallo Mia,\nwir würden am ${formatDateDe(date)} prüfen. Bitte diesmal alle Belege vollständig und an einem Ort – letztes Jahr fehlte einiges.\nGerd` });
      return { date, sent: 0 };
    },
    onDay(c, d) {
      const inv = [['Rechnung Hallenreinigung', 'Rechnung_2026-117_Hallenreinigung.pdf', 'service@sauber-gmbh.example', '180,00 €'],
        ['Ihre Rechnung: Tischtennisbälle', 'Rechnung_Baelle_88412.pdf', 'shop@ball-versand.example', '64,80 €'],
        ['Rechnung Startgelder Bezirksmeisterschaft', 'Rechnung_Startgeld_BM.pdf', 'kasse@tt-musterkreis.example', '45,00 €']];
      if (d.sent >= inv.length) return null;
      const [subject, name, from, sum] = inv[d.sent++];
      mail(MAILBOX.ttv, { from, subject, body: 'Sehr geehrte Damen und Herren,\nanbei unsere Rechnung.\nMit freundlichen Grüßen', attachments: [[name, pdf(subject, [`Betrag: ${sum} (Fantasie)`])]] });
      return `Neue Rechnung im Postfach: ${subject}`;
    },
    checks: [
      { label: 'Ablageregel für Rechnungen angelegt', ok: () => !!one(`SELECT 1 FROM filing_rules WHERE active = 1 AND (lower(subject_contains) LIKE '%rechnung%' OR lower(filename_contains) LIKE '%rechnung%')`) },
      { label: 'Alle drei neuen Rechnungen in einem Ordner', ok: () => one(`SELECT COUNT(DISTINCT original_name) AS n FROM files WHERE original_name IN ('Rechnung_2026-117_Hallenreinigung.pdf','Rechnung_Baelle_88412.pdf','Rechnung_Startgeld_BM.pdf') AND folder != '' AND deleted_at IS NULL`).n >= 3 },
      { label: 'Rechnungen als gelb eingestuft', ok: () => one(`SELECT COUNT(*) AS n FROM files WHERE original_name IN ('Rechnung_2026-117_Hallenreinigung.pdf','Rechnung_Baelle_88412.pdf','Rechnung_Startgeld_BM.pdf') AND data_class = 'gelb'`).n >= 3 },
      { label: 'Kassenprüfung rechtzeitig vorbereitet (Aufgabe erledigt)', ok: (c, d) => tasksAbout(c.since, 'Kassenprüfung').some(t => doneBy(t, d.date)) },
    ],
    tips: ['Eingang → Regeln: „Betreff enthält Rechnung“ → Ordner „Rechnungen“, gelb, „nur ablegen“.', 'Die Rechnungen kommen über drei Tage – die Regel erwischt die späteren automatisch.'],
  },
  {
    key: 'ueberlastung', title: 'Alles hängt an der Vorsitzenden', tag: 16, kanal: 'Postfach TTV + WhatsApp', difficulty: 3,
    problem: 'Wenige Engagierte tragen fast alles; ohne Verteilung und Vertretung droht Ausfall und Rücktritt.',
    start() {
      mail(MAILBOX.ttv, { from: 'frieda.feder@mail.example', fromName: 'Frieda Feder', subject: 'Protokoll Vorstandssitzung',
        body: `Hallo Mia,\nanbei das Protokoll. Mir ist aufgefallen: alle Punkte sind wieder bei dir gelandet.\nFrieda`,
        attachments: [['Protokoll_Vorstandssitzung.pdf', pdf('Protokoll Vorstandssitzung', ['Anwesend: Mia, Ben, Sara, Jana, Frieda, Max.', { text: 'Aufgaben (alle: Mia Muster)', bold: true }, ...UEBERLAST.map(t => `• ${t}`)])]] });
      whatsapp('vorstand', 'Sara Satz', 'Mia, du machst echt zu viel. Gib mir die Mannschaftsmeldung und die Inventur, Jana kann die Grundschule übernehmen.');
      return {};
    },
    checks: [
      { label: 'Die Punkte aus dem Protokoll stehen als Aufgaben in der App (mindestens 6)', ok: (c) => UEBERLAST.filter(t => tasksAbout(c.since, t.split(' ').slice(0, 2).join(' ')).length).length >= 6 },
      { label: 'Mindestens fünf davon an andere verteilt oder erledigt', ok: (c) => { const p = player(); return UEBERLAST.map(t => tasksAbout(c.since, t.split(' ').slice(0, 2).join(' '))[0]).filter(Boolean).filter(t => t.owner_id !== p?.id || done(t)).length >= 5; } },
      { label: 'Jede offene davon hat eine Vertretung', ok: (c) => { const ts = UEBERLAST.map(t => tasksAbout(c.since, t.split(' ').slice(0, 2).join(' '))[0]).filter(Boolean); return ts.length >= 6 && ts.every(t => ['erledigt', 'verworfen'].includes(t.status) || !!t.deputy_id); } },
    ],
    tips: ['Aufgaben anlegen, dann Aufgaben → Filter „Verantwortlich“ → Sammelbearbeitung.', 'Kennzahlen → Verteilung zeigt die Last je Person; der Rechner „Faire Verteilung“ hilft.'],
  },
  {
    key: 'beitragsstufen', title: 'Jahreswechsel: Wer wechselt die Beitragsstufe?', tag: 18, kanal: 'Postfach TTV', difficulty: 2,
    problem: 'Mitglieder, die 18 werden, zahlen oft jahrelang den Jugendbeitrag weiter – oder werden ohne Hinweis hochgestuft.',
    start() {
      mail(MAILBOX.ttv, { from: 'max.mitglied@mail.example', fromName: 'Max Mitglied', subject: 'Beitragsstufen fürs neue Jahr',
        body: 'Hallo Mia,\nkannst du mit dem meinVerein-Export prüfen, wer zum 1. Januar die Stufe wechselt? Der Export liegt im Vereinsordner.\nMax' });
      return {};
    },
    checks: [
      { label: 'Prüfung durchgeführt und Aufgabe mit den Stufenwechseln angelegt', ok: (c) => !!one(`SELECT 1 FROM tasks WHERE created_at >= ? AND title LIKE 'Beitragsstufen zum%'`, c.since) },
      { label: 'Info an die Betroffenen vorbereitet', ok: (c) => drafts(c.since, 'T-BEITRAG-WECHSEL').length > 0 },
    ],
    tips: ['Braucht den Schalter „Gelbe Daten lokal verarbeiten“ und die Automatik „Beitragsstufen aus meinVerein-Export prüfen“.', 'Adminpanel → Verbindungen → meinVerein-Prüfung: CSV aus dem Vereinsordner hochladen, Stichtag 1. Januar.'],
  },
  {
    key: 'amtsuebergabe', title: 'Kassenwart hört auf', tag: 20, kanal: 'Postfach TTV', difficulty: 3,
    problem: 'Bei Amtswechseln geht Wissen verloren, Aufgaben hängen an einer Person, Vertretungen fehlen. Viele Vereine finden kaum Nachfolger.',
    start() {
      mail(MAILBOX.ttv, { from: 'ben.beispiel@mail.example', fromName: 'Ben Beispiel', subject: 'Ich höre als Kassenwart auf',
        body: 'Hallo Mia,\nich ziehe beruflich um und muss das Kassenamt zum Monatsende abgeben. Max hätte Lust, kommissarisch zu übernehmen (Satzung § 8). Lass uns die Übergabe gut machen.\nBen' });
      return {};
    },
    checks: [
      { label: 'Amt „Kasse“ im TTV neu besetzt', ok: () => { const a = areaLike('Musterhausen'); const o = a && one(`SELECT o.*, u.name AS holder FROM offices o LEFT JOIN users u ON u.id = o.holder_id WHERE o.area_id = ? AND o.name = 'Kasse'`, a.id); return !!o?.holder_id && !/^Ben\b/i.test(o.holder || ''); } },
      { label: 'Vertretung für die Kasse eingetragen', ok: () => { const a = areaLike('Musterhausen'); const o = a && one(`SELECT * FROM offices WHERE area_id = ? AND name = 'Kasse'`, a.id); return !!o?.deputy_id && o.deputy_id !== o.holder_id; } },
      { label: 'Keine offenen TTV-Aufgaben mehr bei Ben', ok: () => { const a = areaLike('Musterhausen'); const b = one(`SELECT id FROM users WHERE name LIKE 'Ben%'`); return !!a && (!b || !one(`SELECT 1 FROM tasks WHERE owner_id = ? AND area_id = ? AND status IN ('offen','in_arbeit','wartet')`, b.id, a.id)); } },
      { label: 'Wissen gesichert (Erfahrung im Handbuch notiert)', ok: (c) => !!one('SELECT 1 FROM learnings WHERE created_at >= ?', c.since) },
    ],
    tips: ['Adminpanel → Bereiche und Ämter: Kasse neu besetzen, Vertretung setzen.', 'Aufgaben-Liste nach „Ben“ filtern → Sammelbearbeitung „Verantwortlich ändern“.', 'In einer Aufgabe „Erfahrung festhalten“ – landet im Handbuch je Amt.'],
  },
];

const IDEEN = ['Vereinsausflug zum Bundesliga-Spiel', 'Mini-Meisterschaften an der Grundschule', 'Hobbyrunde für Eltern'];
const UEBERLAST = ['Hallenschlüssel für neue Trainer', 'Vereinsmeisterschaft planen', 'Mannschaftsmeldung Rückrunde', 'Tischtennisplatten-Inventur', 'Grillfest Helferliste', 'Schnuppertraining Erwachsene anbieten', 'Getränkelieferant wechseln', 'Grundschul-Kooperation vorbereiten'];
function person(k) { return { frieda: 'frieda.feder@mail.example' }[k]; }

// ---------- Alltagsrauschen ----------

const NOISE = [
  () => mail(MAILBOX.bezirk, { from: 'info@ttvb-musterland.example', fromName: 'Tischtennisverband Musterland', subject: 'Newsletter: Regeländerungen', body: 'Liebe Vereine, die wichtigsten Änderungen zur neuen Saison: Aufschlagregel, Belagliste, Zeitspiel.' }),
  () => mail(MAILBOX.ttv, { from: 'kapitaen.h1@mail.example', fromName: 'Kapitän Herren I', subject: 'Spielbericht vom Wochenende', body: 'Hi, knapp 8:8 gespielt. Bericht im Anhang.', attachments: [['Spielbericht_H1.txt', Buffer.from('Unentschieden 8:8 (Fantasie)')]] }),
  () => mail(MAILBOX.ttv, { from: 'hallenplan@gemeinde-musterhausen.example', fromName: 'Gemeinde Musterhausen', subject: 'Hallenbelegungsplan nächster Monat', body: 'Anbei der aktuelle Belegungsplan.', attachments: [['Hallenbelegung_naechster_Monat.pdf', pdf('Hallenbelegung', ['Unverändert.'])]] }),
  () => mail(MAILBOX.ttv, { from: 'kontakt@ttv-musterhausen.example', fromName: 'Kontaktformular Homepage', subject: 'Schnuppertraining für Erwachsene?', body: 'Hallo, ich (42) würde gern mal wieder spielen. Gibt es ein Probetraining?' }),
  () => whatsapp('vorstand', 'Jana Jugend', 'Donnerstag fällt das Jugendtraining aus, Halle belegt.'),
  () => whatsapp('helfer', 'Karin Kuchen', 'Wer hat noch den Schlüssel vom Getränkelager?'),
  () => whatsapp('eltern', 'Mama Mertens', 'Ist morgen Training? Bei uns steht nichts in der Gruppe.'),
  () => mail(MAILBOX.sv, { from: 'abteilungen@sv-beispieldorf.example', fromName: 'Hauptverein SV Beispieldorf', subject: 'Erinnerung: Abteilungsbericht', body: 'Bitte den Abteilungsbericht bis Monatsende schicken.' }),
  () => mail(MAILBOX.bezirk, { from: 'sport@tt-musterkreis.example', fromName: 'Bezirkssportwart', subject: 'Ausschreibung Bezirkspokal', body: 'Anbei die Ausschreibung.', attachments: [['Ausschreibung_Bezirkspokal.pdf', pdf('Ausschreibung Bezirkspokal', ['Fantasie-Ausschreibung.'])]] }),
];
function rnd(seed) { let x = 0; for (const ch of seed) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return () => { x = (x * 1103515245 + 12345) >>> 0; return x / 2 ** 32; }; }
export function noise(day) {
  if (!W().rauschen) return false;
  const r = rnd(day);
  if (r() > 0.5) return false;
  NOISE[Math.floor(r() * NOISE.length)]();
  return true;
}

export { VEREIN, HALL };
