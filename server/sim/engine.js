// Vorstandsarbeit-Simulator: Zeitraffer, Szenario-Steuerung und Auswertung.

import { q, getSetting, setSetting } from '../db.js';
import { clockNow, clockOffset, setClockOffset } from '../clock.js';
import { addDays, bad, berlinClock, daysBetween, nowIso, today } from '../util.js';
import { tick, settle } from '../services/scheduler.js';
import { pollMailboxes } from '../services/inbox.js';
import { syncAllFeeds } from '../services/jobs.js';
import { SCENARIOS, dailyNoise } from './scenarios.js';
import { worldInfo } from './world.js';

export function restoreClock() { setClockOffset(getSetting('sim_offset', 0)); }

function log(text) {
  const l = getSetting('sim_log', []);
  l.push({ at: nowIso(), text });
  setSetting('sim_log', l.slice(-200));
}

const states = () => getSetting('sim_szenarien', {}) || {};
const saveStates = (s) => setSetting('sim_szenarien', s);
const ctxFor = (st) => ({ since: st.started_at, day0: st.day0, day: daysBetween(st.day0, today()) });

/** Prüft alle laufenden Szenarien. Erfüllte Prüfungen bleiben erfüllt. */
export function evaluate() {
  const all = states();
  let changed = false;
  for (const s of SCENARIOS) {
    const st = all[s.key];
    if (!st || st.solved_at || st.aborted) continue;
    const ctx = ctxFor(st);
    s.checks.forEach((c, i) => {
      if (st.achieved[i]) return;
      let ok = false;
      try { ok = !!c.ok(ctx, st.data); } catch (err) { console.error(`[Simulator] Prüfung ${s.key}/${i}:`, err.message); }
      if (ok) { st.achieved[i] = nowIso(); changed = true; log(`✓ ${s.title}: ${c.label}`); }
    });
    if (s.checks.every((c, i) => st.achieved[i])) {
      st.solved_at = nowIso();
      st.solved_days = ctx.day;
      changed = true;
      log(`★ Gelöst: ${s.title} (nach ${ctx.day} simulierten Tag(en))`);
    }
  }
  if (changed) saveStates(all);
}

/** Holt Postfächer und Spielpläne sofort (im Simulator zeitlich unkritisch). */
export async function pull() {
  await settle();
  await pollMailboxes({ force: true }).catch(err => log(`Postfach-Abruf: ${err.message}`));
  await syncAllFeeds().catch(err => log(`Spielplan: ${err.message}`));
}

export async function startScenario(key) {
  const s = SCENARIOS.find(x => x.key === key);
  if (!s) throw bad('Unbekanntes Szenario.');
  const all = states();
  if (all[key] && !all[key].solved_at && !all[key].aborted) throw bad('Dieses Szenario läuft bereits.');
  const st = { started_at: nowIso(), day0: today(), achieved: {}, data: {} };
  st.data = s.start(ctxFor(st)) || {};
  all[key] = st;
  saveStates(all);
  log(`▶ Szenario gestartet: ${s.title}`);
  await pull();
  evaluate();
}

export function abortScenario(key) {
  const all = states();
  if (!all[key]) throw bad('Szenario läuft nicht.');
  all[key].aborted = nowIso();
  saveStates(all);
  log(`■ Szenario abgebrochen: ${SCENARIOS.find(x => x.key === key)?.title}`);
}

/** Uhrzeit: Ziel-Tag um 07:30 Berlin (vor dem Tageslauf um 7 Uhr ist schon vorbei → der läuft beim Tick). */
function berlinMorning(day) {
  let t = Date.parse(`${day}T07:30:00Z`) - 3600_000;
  const h = berlinClock(new Date(t)).hour;
  if (h !== 7) t -= (h - 7) * 3600_000;
  return t;
}

/** Spult n Tage vor: je Tag Tageslauf, Regeln, Abrufe, Reaktionen der Welt, Alltagsrauschen, Auswertung. */
export async function advance(days) {
  const n = Math.max(1, Math.min(60, Number(days) || 1));
  for (let i = 0; i < n; i++) {
    const day = addDays(today(), 1);
    const target = berlinMorning(day);
    setClockOffset(Math.max(clockOffset(), target - Date.now()));
    setSetting('sim_offset', clockOffset());
    tick(clockNow());
    await pull();
    const all = states();
    for (const s of SCENARIOS) {
      const st = all[s.key];
      if (!st || st.solved_at || st.aborted || !s.onDay) continue;
      try { const msg = s.onDay(ctxFor(st), st.data); if (msg) log(`↻ ${s.title}: ${msg}`); }
      catch (err) { console.error(`[Simulator] ${s.key}.onDay:`, err.message); }
    }
    saveStates(all);
    const noise = dailyNoise(day);
    if (noise) log(noise);
    await pull();
    evaluate();
  }
  log(`⏩ ${n} Tag(e) vorgespult – jetzt ${today()}`);
}

function health() {
  const one = (sql, ...p) => q.get(sql, ...p).n;
  const d = today();
  return {
    ueberfaellig: one(`SELECT COUNT(*) AS n FROM tasks WHERE kind = 'aufgabe' AND status IN ('offen','in_arbeit','wartet') AND due_date < ?`, d),
    offen: one(`SELECT COUNT(*) AS n FROM tasks WHERE kind = 'aufgabe' AND status IN ('offen','in_arbeit','wartet')`),
    ohne_verantwortung: one(`SELECT COUNT(*) AS n FROM tasks WHERE kind = 'aufgabe' AND status IN ('offen','in_arbeit','wartet') AND owner_id IS NULL`),
    eingang: one(`SELECT COUNT(*) AS n FROM inbox WHERE status = 'neu'`),
    freigaben: one(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'offen'`),
  };
}

export function status() {
  evaluate();
  const all = states();
  const scen = SCENARIOS.map(s => {
    const st = all[s.key];
    const running = !!st && !st.solved_at && !st.aborted;
    return {
      key: s.key, title: s.title, area: s.area, difficulty: s.difficulty, days: s.days, problem: s.problem, tips: s.tips,
      state: !st ? 'neu' : st.solved_at ? 'geloest' : st.aborted ? 'abgebrochen' : 'laeuft',
      started_at: st?.started_at || null, solved_at: st?.solved_at || null, solved_days: st?.solved_days ?? null,
      day: running ? ctxFor(st).day : null,
      checks: s.checks.map((c, i) => ({ label: c.label, ok: !!st?.achieved?.[i] })),
    };
  });
  const solved = scen.filter(s => s.state === 'geloest');
  const h = health();
  const points = solved.reduce((p, s) => p + 10 * s.difficulty + Math.max(0, s.days - (s.solved_days ?? s.days)) * 2, 0);
  return {
    now: nowIso(), today: today(), sim_day: Math.max(0, daysBetween(getSetting('sim_welt', {})?.start || today(), today())),
    world: worldInfo(), scenarios: scen, health: h,
    score: { solved: solved.length, total: scen.length, points, penalty: h.ueberfaellig * 2 + h.eingang },
    log: getSetting('sim_log', []).slice(-80).reverse(),
    aussen: getSetting('sim_aussen', []).slice(-80).reverse(),
    rauschen: getSetting('sim_rauschen', true),
    spiele: getSetting('sim_spiele', []).filter(g => g.date >= today()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8),
  };
}
