// Motor der Vereinswelt: Zeitraffer, Saisonverlauf, Reaktionen der Welt, Auswertung.

import { q } from '../../server/db.js';
import { clockNow, clockOffset, setClockOffset } from '../../server/clock.js';
import { addDays, berlinClock, daysBetween, today } from '../../server/util.js';
import { tick, settle } from '../../server/services/scheduler.js';
import { W, save, log, newId } from './zustand.js';
import { EINRICHTUNG, EREIGNISSE, noise } from './geschichte.js';
import { ausfuellbar } from './ausfuellen.js';

/** Kapitel-1-Schritt überspringen bzw. wieder aufnehmen */
export function skip(key, on = true) {
  if (!EINRICHTUNG.some(c => c.key === key)) throw Object.assign(new Error('Unbekannter Schritt.'), { status: 400 });
  W().kapitel.skipped ||= {};
  if (on) W().kapitel.skipped[key] = clockNow().toISOString(); else delete W().kapitel.skipped[key];
  log(`${on ? '⤼ Übersprungen' : '↺ Wieder aufgenommen'}: ${EINRICHTUNG.find(c => c.key === key).label}`);
  save();
}

export function restoreClock() { setClockOffset(W().offset || 0); }
export const simDay = () => Math.max(0, daysBetween(W().start, today()));
const ctxFor = (st) => ({ since: st.started_at, day0: st.day0, day: daysBetween(st.day0, today()) });

/** Prüft Einrichtung und laufende Ereignisse. Erfüllte Prüfungen bleiben erfüllt. */
export function evaluate() {
  const w = W();
  for (const c of EINRICHTUNG) {
    if (w.kapitel.achieved[c.key] || w.kapitel.skipped?.[c.key]) continue;
    let ok = false;
    try { ok = !!c.ok(); } catch (err) { console.error(`[Vereinswelt] Einrichtung ${c.key}:`, err.message); }
    if (ok) { w.kapitel.achieved[c.key] = clockNow().toISOString(); log(`✓ Einrichtung: ${c.label}`, 'ok'); }
  }
  for (const e of EREIGNISSE) {
    const st = w.ereignisse[e.key];
    if (!st || st.solved_at || st.aborted) continue;
    const ctx = ctxFor(st);
    e.checks.forEach((c, i) => {
      if (st.achieved[i]) return;
      let ok = false;
      try { ok = !!c.ok(ctx, st.data); } catch (err) { console.error(`[Vereinswelt] ${e.key}/${i}:`, err.message); }
      if (ok) { st.achieved[i] = clockNow().toISOString(); log(`✓ ${e.title}: ${c.label}`, 'ok'); }
    });
    if (e.checks.every((c, i) => st.achieved[i])) {
      st.solved_at = clockNow().toISOString();
      st.solved_days = ctx.day;
      log(`★ Gelöst: ${e.title} (nach ${ctx.day} Tag(en))`, 'star');
    }
  }
  save();
}

/** Lässt die Welt auf das Handeln reagieren (Entwürfe in der App, verschickte Mails). */
export function react() {
  for (const e of EREIGNISSE) {
    const st = W().ereignisse[e.key];
    if (!st || st.solved_at || st.aborted || !e.react) continue;
    try { const msg = e.react(ctxFor(st), st.data); if (msg) log(`↻ ${e.title}: ${msg}`, 'welt'); } catch (err) { console.error(`[Vereinswelt] ${e.key}.react:`, err.message); }
  }
  save();
}

export function startEreignis(key) {
  const e = EREIGNISSE.find(x => x.key === key);
  if (!e) throw Object.assign(new Error('Unbekanntes Ereignis.'), { status: 400 });
  const cur = W().ereignisse[key];
  if (cur && !cur.solved_at && !cur.aborted) throw Object.assign(new Error('Dieses Ereignis läuft bereits.'), { status: 400 });
  const st = { started_at: clockNow().toISOString(), day0: today(), achieved: {}, data: {} };
  W().ereignisse[key] = st;
  st.data = e.start(ctxFor(st)) || {};
  log(`▶ ${e.title} (${e.kanal})`, 'start');
  save();
}

export function abortEreignis(key) {
  const st = W().ereignisse[key];
  if (!st) throw Object.assign(new Error('Ereignis läuft nicht.'), { status: 400 });
  st.aborted = clockNow().toISOString();
  log(`■ Abgebrochen: ${EREIGNISSE.find(x => x.key === key)?.title}`);
}

function berlinMorning(day) {
  let t = Date.parse(`${day}T07:30:00Z`) - 3600_000;
  const h = berlinClock(new Date(t)).hour;
  if (h !== 7) t -= (h - 7) * 3600_000;
  return t;
}

/** n Tage vorspulen: je Tag der normale Tageslauf der App, dann reagiert die Welt. */
export async function advance(days) {
  const n = Math.max(1, Math.min(60, Number(days) || 1));
  for (let i = 0; i < n; i++) {
    const day = addDays(today(), 1);
    setClockOffset(Math.max(clockOffset(), berlinMorning(day) - Date.now()));
    W().offset = clockOffset();
    tick(clockNow());
    await settle();
    // Saisonverlauf: fällige Ereignisse treten ein
    if (W().saison) for (const e of EREIGNISSE) if (!W().ereignisse[e.key] && e.tag <= simDay()) startEreignis(e.key);
    for (const e of EREIGNISSE) {
      const st = W().ereignisse[e.key];
      if (!st || st.solved_at || st.aborted || !e.onDay) continue;
      try { const msg = e.onDay(ctxFor(st), st.data); if (msg) log(`↻ ${e.title}: ${msg}`, 'welt'); } catch (err) { console.error(`[Vereinswelt] ${e.key}.onDay:`, err.message); }
    }
    noise(day);
    react();
    // Eine Viertelstunde später: die App ruft (falls eingeschaltet) die neuen Mails ab
    setClockOffset(clockOffset() + 16 * 60_000);
    W().offset = clockOffset();
    tick(clockNow());
    await settle();
    evaluate();
  }
  log(`⏩ ${n} Tag(e) vorgespult – Tag ${simDay()} der Simulation`, 'zeit');
  save(true);
}

/** Mail aus dem Postfach der Welt verschicken (Entwurf der App oder eigene Antwort). */
export function sendMail({ mailbox, draftId = null, to, subject, body, replyTo = null }) {
  const w = W();
  let m = draftId ? w.mails.find(x => x.id === draftId && x.folder === 'drafts') : null;
  if (draftId && !m) throw Object.assign(new Error('Entwurf nicht gefunden.'), { status: 404 });
  if (!String(to || '').includes('@')) throw Object.assign(new Error('Bitte eine Empfängeradresse angeben.'), { status: 400 });
  if (!m) {
    const orig = replyTo ? w.mails.find(x => x.id === replyTo) : null;
    m = { id: newId('m'), mailbox: (mailbox || orig?.mailbox || '').toLowerCase(), from: '', fromName: '', received: '', read: true, conv: orig?.conv || null, source: 'welt', attachments: [] };
    w.mails.push(m);
  }
  Object.assign(m, { folder: 'sent', to, subject: subject ?? m.subject, body: body ?? m.body, from: m.mailbox, fromName: w.mailboxes[m.mailbox], received: clockNow().toISOString() });
  log(`✉ Verschickt von ${m.mailbox} an ${to}: „${m.subject}“`, 'mail');
  react();
  evaluate();
  return m.id;
}

function health() {
  const one = (sql, ...p) => { try { return q.get(sql, ...p).n; } catch { return 0; } };
  const d = today();
  return {
    ueberfaellig: one(`SELECT COUNT(*) AS n FROM tasks WHERE kind = 'aufgabe' AND status IN ('offen','in_arbeit','wartet') AND due_date < ?`, d),
    offen: one(`SELECT COUNT(*) AS n FROM tasks WHERE kind = 'aufgabe' AND status IN ('offen','in_arbeit','wartet')`),
    eingang: one(`SELECT COUNT(*) AS n FROM inbox WHERE status = 'neu'`),
    freigaben: one(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'offen'`),
    unbearbeitet_welt: W().post.filter(p => p.status === 'neu').length,
  };
}

export function status() {
  evaluate();
  const w = W();
  const ereignisse = EREIGNISSE.map(e => {
    const st = w.ereignisse[e.key];
    const running = !!st && !st.solved_at && !st.aborted;
    return {
      key: e.key, title: e.title, tag: e.tag, kanal: e.kanal, difficulty: e.difficulty, problem: e.problem, tips: e.tips,
      state: !st ? 'neu' : st.solved_at ? 'geloest' : st.aborted ? 'abgebrochen' : 'laeuft',
      day: running ? ctxFor(st).day : null, solved_days: st?.solved_days ?? null,
      checks: e.checks.map((c, i) => ({ label: c.label, ok: !!st?.achieved?.[i] })),
    };
  });
  const solved = ereignisse.filter(e => e.state === 'geloest');
  const einrichtung = EINRICHTUNG.map(c => ({ key: c.key, label: c.label, tip: c.tip, ok: !!w.kapitel.achieved[c.key], skipped: !w.kapitel.achieved[c.key] && !!w.kapitel.skipped?.[c.key], auto: ausfuellbar(c.key) }));
  return {
    today: today(), now: clockNow().toISOString(), day: simDay(), saison: w.saison, rauschen: w.rauschen, zweiterVerein: !!w.zweiterVerein,
    einrichtung, ereignisse, health: health(),
    score: { einrichtung: einrichtung.filter(c => c.ok || c.skipped).length, einrichtung_total: einrichtung.length, solved: solved.length, total: ereignisse.length,
      points: einrichtung.filter(c => c.ok).length * 5 + solved.reduce((p, e) => p + 10 * e.difficulty, 0) },
    unread: {
      mail: Object.fromEntries(Object.keys(w.mailboxes).map(mb => [mb, w.mails.filter(m => m.mailbox === mb && m.folder === 'inbox' && !m.read && m.received <= clockNow().toISOString()).length])),
      drafts: w.mails.filter(m => m.folder === 'drafts').length,
      post: w.post.filter(p => p.status === 'neu').length,
      chats: Object.fromEntries(Object.entries(w.chats).map(([k, c]) => [k, c.messages.filter(m => !m.read).length])),
    },
    log: w.log.slice(-120).reverse(),
  };
}
