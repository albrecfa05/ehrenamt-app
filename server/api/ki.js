// KI-Assistent für Automatisierungen: Schnittstelle. Nur Admins (ROL-2, ROL-3).

import { get, post } from '../http.js';
import { q } from '../db.js';
import { requireAdmin } from '../access.js';
import { isOn } from '../services/catalog.js';
import { applyProposal, ask, previewContext, requestView, setRuleValidator } from '../services/ki.js';
import { status as claudeStatus } from '../connectors/claude.js';
import { bad, int, notFound, oneOf } from '../util.js';
import { cleanRule, insertRule } from './automation.js';

setRuleValidator(cleanRule);

get('/api/ki/status', async ({ user }) => {
  requireAdmin(user);
  const s = await claudeStatus();
  const usage = q.get(`SELECT COUNT(*) AS n, COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o FROM ki_requests WHERE created_at >= ?`,
    new Date(Date.now() - 30 * 86_400_000).toISOString());
  return { ...s, active: isOn('ki_assistent'), last30: usage };
});

// Transparenz: genau der Kontext, der mitgeschickt würde
get('/api/ki/preview', ({ user, query }) => {
  requireAdmin(user);
  return previewContext(query.mode === 'ideen' ? 'ideen' : 'beschreibung');
});

post('/api/ki/ask', async ({ user, body }) => {
  requireAdmin(user);
  if (!isOn('ki_assistent')) throw bad('Der KI-Assistent ist ausgeschaltet oder es fehlt der API-Schlüssel (Adminpanel → Automatisierungen → KI).');
  const mode = oneOf(body.mode, ['beschreibung', 'ideen'], { name: 'Modus' });
  return ask(user, { mode, text: body.text || '' });
});

get('/api/ki/requests', ({ user }) => {
  requireAdmin(user);
  return q.all(`SELECT k.*, u.name AS user_name FROM ki_requests k LEFT JOIN users u ON u.id = k.user_id ORDER BY k.id DESC LIMIT 50`).map(requestView);
});

get('/api/ki/requests/:id', ({ user, params }) => {
  requireAdmin(user);
  const r = q.get('SELECT k.*, u.name AS user_name FROM ki_requests k LEFT JOIN users u ON u.id = k.user_id WHERE k.id = ?', int(params.id));
  if (!r) throw notFound();
  return requestView(r);
});

post('/api/ki/requests/:id/apply', ({ user, params, body }) => {
  requireAdmin(user);
  return applyProposal(user, int(params.id), int(body.index, { min: 0, nullable: false, name: 'Vorschlag' }), insertRule);
});
