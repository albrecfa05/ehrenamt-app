// Notfall: Passwort eines Kontos auf dem Server zurücksetzen, wenn sich kein Admin mehr anmelden kann.
//   npm run passwort-zuruecksetzen -- <anmeldename>
// Gibt ein vorläufiges Passwort aus; es muss bei der nächsten Anmeldung geändert werden.

import crypto from 'node:crypto';
import { openDb, q } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { audit } from '../server/util.js';

const login = (process.argv[2] || '').toLowerCase();
if (!login) { console.error('Bitte den Anmeldenamen angeben: npm run passwort-zuruecksetzen -- fabian'); process.exit(1); }
openDb();
const u = q.get('SELECT * FROM users WHERE login = ?', login);
if (!u) { console.error(`Kein Konto „${login}“.`); process.exit(1); }
const pw = `Tt-${crypto.randomBytes(9).toString('base64url')}-${10 + crypto.randomInt(89)}`;
q.run('UPDATE users SET pw_hash = ?, must_change_pw = 1, active = 1 WHERE id = ?', hashPassword(pw), u.id);
q.run('DELETE FROM sessions WHERE user_id = ?', u.id);
audit(null, { entity: 'user', entityId: u.id, action: 'passwort_zurueckgesetzt', summary: `Passwort von „${u.name}“ über die Server-Konsole zurückgesetzt` });
console.log(`Vorläufiges Passwort für ${u.name}: ${pw}`);
