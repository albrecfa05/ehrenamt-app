// Automatisierungen: Regeln, Läufe, Freigaben, Berichte (Kapitel 6).

import { get, post, put } from '../http.js';
import { q, tx, getSetting } from '../db.js';
import { canSeeArea, requireAdmin } from '../access.js';
import { ALLOWED_ACTIONS, BLOCKED_TERMS, assertActionAllowed } from '../guards.js';
import { buildOverview, decideApproval, MANY_RECIPIENTS, runRule, TRIGGERS, validateRule } from '../services/automation.js';
import { audit, bad, int, LEVEL_LABEL, notFound, nowIso, parseJson, str } from '../util.js';
import { newVersion } from './templates.js';
import { gelbExtern, gelbLokal } from '../privacy.js';

get('/api/automation/meta', () => ({
  triggers: TRIGGERS,
  actions: Object.fromEntries(Object.entries(ALLOWED_ACTIONS).map(([k, a]) => [k, a])),
  levels: LEVEL_LABEL,
  blocked: ['Zahlungen', 'Lastschriften', 'Bankvorgänge', 'Bestellungen'],
  blockedTerms: BLOCKED_TERMS,
  manyRecipients: MANY_RECIPIENTS,
  yellowAllowed: gelbLokal(),
  yellowExternAllowed: gelbExtern(),
}));

const ruleView = (r) => ({ ...r, trigger_config: parseJson(r.trigger_config, {}), action_config: parseJson(r.action_config, {}) });

get('/api/rules', ({ user }) => q.all(`SELECT r.*, a.name AS area_name, p.name AS template_name, p.max_level AS template_max_level,
      u.name AS approved_by_name, c.name AS created_by_name,
      (SELECT outcome FROM rule_runs rr WHERE rr.rule_id = r.id ORDER BY rr.id DESC LIMIT 1) AS last_outcome
    FROM rules r LEFT JOIN areas a ON a.id = r.area_id LEFT JOIN process_templates p ON p.id = r.template_id
    LEFT JOIN users u ON u.id = r.approved_by LEFT JOIN users c ON c.id = r.created_by ORDER BY r.active DESC, r.name`)
  .filter(r => canSeeArea(user, r.area_id)).map(ruleView));

export function cleanRule(b) {
  const d = {
    name: str(b.name, { required: true, max: 200, name: 'Name' }),
    description: str(b.description, { max: 2000 }),
    area_id: int(b.area_id),
    template_id: int(b.template_id),
    trigger_type: str(b.trigger_type, { required: true, name: 'Auslöser' }),
    trigger_config: b.trigger_config && typeof b.trigger_config === 'object' ? b.trigger_config : {},
    action_type: str(b.action_type, { required: true, name: 'Aktion' }),
    action_config: b.action_config && typeof b.action_config === 'object' ? b.action_config : {},
    level: int(b.level, { min: 0, max: 4, nullable: false, name: 'Stufe' }),
  };
  validateRule(d); // prüft Sperrliste (AUT-8), Höchststufe (AUT-1) und Pflichtangaben
  return d;
}

// Nur Admins legen Regeln an und ändern sie (ROL-2). Neue und geänderte Regeln sind zunächst NICHT freigegeben.
/** Legt eine (bereits geprüfte) Regel an – immer ohne Freigabe. Auch für KI-Vorschläge genutzt. */
export function insertRule(user, d, origin = '') {
  const now = nowIso();
  const r = q.run(`INSERT INTO rules (name, description, area_id, template_id, trigger_type, trigger_config, action_type, action_config, level, created_by, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    d.name, d.description, d.area_id, d.template_id, d.trigger_type, JSON.stringify(d.trigger_config), d.action_type, JSON.stringify(d.action_config), d.level, user.id, now, now);
  const id = Number(r.lastInsertRowid);
  q.run('INSERT INTO changelog (entity, entity_id, title, note, version, created_at, created_by) VALUES (?, ?, ?, ?, 1, ?, ?)', 'rule', id, `Neue Regel „${d.name}“`, `Wartet auf Freigabe${origin ? ` – ${origin}` : ''}`, now, user.id);
  audit(user, { entity: 'rule', entityId: id, areaId: d.area_id, action: 'angelegt', summary: `Regel „${d.name}“ angelegt (Stufe ${d.level})${origin ? ` – ${origin}` : ''}, wartet auf Freigabe` });
  return id;
}

post('/api/rules', ({ user, body }) => {
  requireAdmin(user);
  return { id: insertRule(user, cleanRule(body)) };
});

put('/api/rules/:id', ({ user, params, body }) => tx(() => {
  requireAdmin(user);
  const r = q.get('SELECT * FROM rules WHERE id = ?', int(params.id));
  if (!r) throw notFound();
  const d = cleanRule(body);
  const note = str(body.note, { max: 1000 }) || 'Regel geändert';
  const version = newVersion(user, 'rule', r, note, `Regel „${d.name}“ geändert – Freigabe erneut nötig`);
  q.run(`UPDATE rules SET name = ?, description = ?, area_id = ?, template_id = ?, trigger_type = ?, trigger_config = ?, action_type = ?, action_config = ?, level = ?,
         version = ?, approved = 0, approved_by = NULL, approved_at = NULL, active = 0, updated_at = ? WHERE id = ?`,
    d.name, d.description, d.area_id, d.template_id, d.trigger_type, JSON.stringify(d.trigger_config), d.action_type, JSON.stringify(d.action_config), d.level,
    version, nowIso(), r.id);
  audit(user, { entity: 'rule', entityId: r.id, areaId: d.area_id, action: 'version', summary: `Regel „${d.name}“ → Version ${version}; Freigabe zurückgesetzt` });
  return { ok: true };
}));

// Freigabe einer Regel (ROL-3). Mit Person und Zeitpunkt im Protokoll.
post('/api/rules/:id/approve', ({ user, params, body }) => {
  requireAdmin(user);
  const r = q.get('SELECT * FROM rules WHERE id = ?', int(params.id));
  if (!r) throw notFound();
  validateRule(ruleView(r));
  if (body.approve === false) {
    q.run('UPDATE rules SET approved = 0, approved_by = NULL, approved_at = NULL, active = 0 WHERE id = ?', r.id);
    audit(user, { entity: 'rule', entityId: r.id, areaId: r.area_id, action: 'freigabe_entzogen', summary: `Freigabe der Regel „${r.name}“ entzogen` });
    return { ok: true };
  }
  const now = nowIso();
  q.run('UPDATE rules SET approved = 1, approved_by = ?, approved_at = ?, active = 1 WHERE id = ?', user.id, now, r.id);
  audit(user, { entity: 'rule', entityId: r.id, areaId: r.area_id, action: 'freigegeben', summary: `Regel „${r.name}“ (Stufe ${r.level}) freigegeben und aktiviert von ${user.name}` });
  return { ok: true };
});

post('/api/rules/:id/toggle', ({ user, params, body }) => {
  requireAdmin(user);
  const r = q.get('SELECT * FROM rules WHERE id = ?', int(params.id));
  if (!r) throw notFound();
  const active = body.active ? 1 : 0;
  if (active && !r.approved) throw bad('Die Regel muss zuerst freigegeben werden.');
  q.run('UPDATE rules SET active = ? WHERE id = ?', active, r.id);
  audit(user, { entity: 'rule', entityId: r.id, areaId: r.area_id, action: active ? 'aktiviert' : 'pausiert', summary: `Regel „${r.name}“ ${active ? 'aktiviert' : 'pausiert'}` });
  return { ok: true };
});

// Feste Abläufe auf Zuruf starten (AUT-3) – einzeln oder mehrere hintereinander
post('/api/rules/:id/run', ({ user, params }) => {
  requireAdmin(user);
  const r = q.get('SELECT * FROM rules WHERE id = ?', int(params.id));
  if (!r) throw notFound();
  return runRule(r, { user, trigger: `auf Zuruf von ${user.name}` });
});

post('/api/rules/run-sequence', ({ user, body }) => {
  requireAdmin(user);
  const ids = (body.ids || []).map(Number).filter(Boolean).slice(0, 50);
  if (!ids.length) throw bad('Bitte Regeln auswählen.');
  const results = [];
  for (const id of ids) {
    const r = q.get('SELECT * FROM rules WHERE id = ?', id);
    if (!r) continue;
    const res = runRule(r, { user, trigger: `Ablauf hintereinander (${results.length + 1}/${ids.length}) von ${user.name}` });
    results.push({ id, name: r.name, ...res });
    if (res.outcome === 'fehler' && body.stopOnError) break;
  }
  return { results };
});

get('/api/rule-runs', ({ query }) => q.all(`SELECT rr.*, r.name AS rule_name, u.name AS started_by_name FROM rule_runs rr
    LEFT JOIN rules r ON r.id = rr.rule_id LEFT JOIN users u ON u.id = rr.started_by
    ${query.rule ? 'WHERE rr.rule_id = ' + int(query.rule) : ''} ORDER BY rr.id DESC LIMIT 200`));

// Prüfen, ob eine Aktion erlaubt wäre (für die Oberfläche und Abnahmetest ABN-5)
post('/api/automation/check', ({ body }) => {
  try {
    assertActionAllowed(body.action_type, body.action_config);
    return { allowed: true };
  } catch (err) {
    return { allowed: false, reason: err.message };
  }
});

// ---------- Freigaben (AUT-6, AUT-7) ----------

get('/api/approvals', ({ user, query }) => {
  const status = ['offen', 'freigegeben', 'abgelehnt', 'ausgefuehrt', 'fehler', 'alle'].includes(query.status) ? query.status : 'offen';
  return q.all(`SELECT ap.*, r.name AS rule_name, t.title AS task_title, a.name AS area_name, rq.name AS requested_by_name, dc.name AS decided_by_name
                FROM approvals ap LEFT JOIN rules r ON r.id = ap.rule_id LEFT JOIN tasks t ON t.id = ap.task_id LEFT JOIN areas a ON a.id = ap.area_id
                LEFT JOIN users rq ON rq.id = ap.requested_by LEFT JOIN users dc ON dc.id = ap.decided_by
                ${status === 'alle' ? '' : 'WHERE ap.status = ?'} ORDER BY ap.id DESC LIMIT 300`, ...(status === 'alle' ? [] : [status]))
    .filter(a => canSeeArea(user, a.area_id))
    .map(a => ({ ...a, payload: parseJson(a.payload, {}), recipients: parseJson(a.recipients, []) }));
});

post('/api/approvals/:id/decide', ({ user, params, body }) => decideApproval(user, int(params.id), {
  approve: !!body.approve, note: str(body.note, { max: 1000 }), confirmRecipients: body.confirmRecipients === true,
}));

// ---------- Berichte (AUT-13) ----------

get('/api/reports', () => q.all('SELECT id, type, title, rule_id, created_at FROM reports ORDER BY id DESC LIMIT 100'));

get('/api/reports/:id', ({ params }) => {
  const r = q.get('SELECT * FROM reports WHERE id = ?', int(params.id));
  if (!r) throw notFound();
  return { ...r, content: parseJson(r.content, {}) };
});

// Übersicht sofort erstellen (ohne Regel), nur für die eigenen Bereiche
post('/api/reports/overview', ({ user, body }) => {
  const areas = body.area_id ? [int(body.area_id)] : null;
  if (areas && !canSeeArea(user, areas[0])) throw bad('Kein Zugriff auf diesen Bereich.');
  const report = buildOverview(areas, 'Übersicht');
  const r = q.run('INSERT INTO reports (type, title, content, created_at) VALUES (?, ?, ?, ?)', 'uebersicht', report.title, JSON.stringify(report), nowIso());
  audit(user, { entity: 'report', entityId: Number(r.lastInsertRowid), action: 'erstellt', summary: `${report.title} erstellt` });
  return { id: Number(r.lastInsertRowid) };
});
