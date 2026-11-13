// Schnittstellen des Vorstandsarbeit-Simulators. Werden nur geladen, wenn die App als Simulator läuft
// (scripts/simulator.js), nie in der echten App.

import { get, post } from '../http.js';
import { setSetting } from '../db.js';
import { requireAdmin } from '../access.js';
import { audit } from '../util.js';
import { advance, abortScenario, pull, startScenario, status } from './engine.js';
import { SCENARIOS } from './scenarios.js';

if (process.env.TTE_SIMULATOR !== '1') throw new Error('Simulator-Schnittstellen nur im Simulator laden.');

get('/api/sim', ({ user }) => { requireAdmin(user); return status(); });

post('/api/sim/advance', async ({ user, body }) => {
  requireAdmin(user);
  await advance(body.days);
  audit(user, { entity: 'simulator', action: 'zeitraffer', summary: `Simulator: ${Number(body.days) || 1} Tag(e) vorgespult` });
  return status();
});

post('/api/sim/scenario', async ({ user, body }) => {
  requireAdmin(user);
  let key = body.key;
  if (key === 'zufall') {
    const st = status().scenarios.filter(s => s.state === 'neu');
    if (!st.length) return status();
    key = st[Math.floor(Math.random() * st.length)].key;
  }
  await startScenario(key);
  audit(user, { entity: 'simulator', action: 'szenario', summary: `Simulator: Szenario „${SCENARIOS.find(s => s.key === key)?.title}“ gestartet` });
  return status();
});

post('/api/sim/scenario/abort', ({ user, body }) => { requireAdmin(user); abortScenario(body.key); return status(); });

post('/api/sim/pull', async ({ user }) => { requireAdmin(user); await pull(); return status(); });

post('/api/sim/noise', ({ user, body }) => { requireAdmin(user); setSetting('sim_rauschen', !!body.on); return status(); });
