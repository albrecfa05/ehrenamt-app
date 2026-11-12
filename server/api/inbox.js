// Eingang (AUT-4, AUT-10): Schnittstelle. Die Fachlogik steht in services/inbox.js.

import { get, post } from '../http.js';
import { q } from '../db.js';
import { assertArea, canSeeArea, requireAdmin } from '../access.js';
import { acceptInbox, addInbound, dismissInbox, pollMailboxes } from '../services/inbox.js';
import { bad, int, notFound, nowIso, oneOf, parseJson, str } from '../util.js';
import { getSetting } from '../db.js';

const CHANNELS = ['mail', 'whatsapp', 'post', 'telefon', 'persoenlich', 'website'];

get('/api/inbox', ({ user, query }) => {
  const status = ['neu', 'uebernommen', 'abgelegt'].includes(query.status) ? query.status : 'neu';
  return q.all(`SELECT i.*, a.name AS area_name, u.name AS created_by_name FROM inbox i LEFT JOIN areas a ON a.id = i.area_id
                LEFT JOIN users u ON u.id = i.created_by WHERE i.status = ? ORDER BY i.received_at DESC LIMIT 300`, status)
    .filter(i => (i.area_id == null ? user.role === 'admin' : canSeeArea(user, i.area_id)))
    .map(i => ({ ...i, suggestion: parseJson(i.suggestion, {}), flags: parseJson(i.flags, []), attachments: parseJson(i.attachments, []) }));
});

// Manuelle Erfassung (WhatsApp, Post, Telefon) oder eingefügte Mail
post('/api/inbox', ({ user, body }) => {
  const d = {
    channel: oneOf(body.channel, CHANNELS, { name: 'Kanal' }),
    sender: str(body.sender, { max: 200 }),
    subject: str(body.subject, { max: 300 }),
    body: str(body.body, { max: 100_000 }),
    area_id: int(body.area_id),
    received_at: body.received_at || null,
  };
  if (!d.subject && !d.body) throw bad('Bitte Betreff oder Text angeben.');
  if (d.area_id) assertArea(user, d.area_id);
  return addInbound(user, d);
});

// Mail-Datei (.eml) hochladen, z. B. aus Outlook oder Thunderbird gespeichert – mit Anhängen
post('/api/inbox/eml', ({ user, body }) => {
  const mail = parseEml(body.toString('latin1'));
  return addInbound(user, { channel: 'mail', ...mail, area_id: null });
}, { raw: true });

// Postfächer jetzt abrufen (Microsoft 365)
post('/api/inbox/poll', async ({ user }) => {
  requireAdmin(user);
  return pollMailboxes({ force: true, user });
});

get('/api/inbox/status', () => ({ last: getSetting('m365_letzter_abruf', null) }));

post('/api/inbox/:id/accept', ({ user, params, body }) => {
  const i = q.get('SELECT * FROM inbox WHERE id = ?', int(params.id));
  if (!i) throw notFound();
  const areaId = int(body.area_id, { nullable: false, name: 'Bereich' });
  assertArea(user, areaId);
  const taskId = acceptInbox(user, i.id, {
    area_id: areaId, title: str(body.title, { max: 300 }), description: body.description, template_id: int(body.template_id), office_id: int(body.office_id),
    owner_id: int(body.owner_id) ?? user.id, due_date: body.due_date || null, data_class: body.data_class,
  });
  return { taskId };
});

post('/api/inbox/:id/dismiss', ({ user, params, body }) => {
  const i = q.get('SELECT * FROM inbox WHERE id = ?', int(params.id));
  if (!i) throw notFound();
  if (i.area_id && !canSeeArea(user, i.area_id)) throw notFound();
  dismissInbox(user, i.id, str(body.reason, { max: 300 }));
  return { ok: true };
});

// ---------- Minimaler .eml-Leser (RFC 5322 / MIME) mit Anhängen ----------

function decodeWords(s) {
  return String(s || '').replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_, cs, enc, txt) => {
    const buf = enc.toUpperCase() === 'B' ? Buffer.from(txt, 'base64')
      : Buffer.from(txt.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (__, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
    return decodeCharset(buf, cs);
  });
}

function decodeCharset(buf, cs) {
  try { return new TextDecoder(String(cs || 'utf-8').toLowerCase().replace('latin1', 'iso-8859-1')).decode(buf); }
  catch { return buf.toString('utf8'); }
}

function splitHeaders(raw) {
  const idx = raw.search(/\r?\n\r?\n/);
  const head = idx >= 0 ? raw.slice(0, idx) : raw;
  const body = idx >= 0 ? raw.slice(idx).replace(/^\r?\n\r?\n/, '') : '';
  const headers = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) headers[m[1].toLowerCase()] = m[2];
  }
  return { headers, body };
}

function bodyBuffer(body, headers) {
  const enc = (headers['content-transfer-encoding'] || '').toLowerCase();
  if (enc === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64');
  if (enc === 'quoted-printable') return Buffer.from(body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
  return Buffer.from(body, 'latin1');
}

function decodeBody(body, headers) {
  const cs = (headers['content-type'] || '').match(/charset="?([^";]+)"?/i)?.[1] || 'utf-8';
  return decodeCharset(bodyBuffer(body, headers), cs);
}

function htmlToText(html) {
  return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/** Läuft durch alle MIME-Teile: sammelt Text (plain bevorzugt) und Dateianhänge. */
function walk(part, acc) {
  const ct = (part.headers['content-type'] || 'text/plain').toLowerCase();
  const disp = part.headers['content-disposition'] || '';
  const fname = decodeWords((disp.match(/filename\*?="?([^";]+)"?/i) || part.headers['content-type']?.match(/name="?([^";]+)"?/i) || [])[1] || '');
  if (ct.startsWith('multipart/')) {
    const boundary = (part.headers['content-type'].match(/boundary="?([^";]+)"?/i) || [])[1];
    if (!boundary) return;
    for (const p of part.body.split('--' + boundary).slice(1)) {
      if (p.startsWith('--')) break;
      walk(splitHeaders(p.replace(/^\r?\n/, '')), acc);
    }
    return;
  }
  if (/attachment/i.test(disp) || (fname && !ct.startsWith('text/plain') && !ct.startsWith('text/html'))) {
    if (acc.attachments.length < 20) acc.attachments.push({ name: fname || 'anhang.bin', mime: ct.split(';')[0], data: bodyBuffer(part.body, part.headers) });
    return;
  }
  if (ct.startsWith('text/plain') && !acc.plain) acc.plain = decodeBody(part.body, part.headers);
  else if (ct.startsWith('text/html') && !acc.html) acc.html = htmlToText(decodeBody(part.body, part.headers));
}

export function parseEml(raw) {
  const top = splitHeaders(raw);
  const acc = { plain: '', html: '', attachments: [] };
  walk(top, acc);
  const text = (acc.plain || acc.html).replace(/\r\n/g, '\n').trim().slice(0, 100_000);
  const date = Date.parse(top.headers.date || '');
  return {
    sender: decodeWords(top.headers.from || ''),
    subject: decodeWords(top.headers.subject || '').slice(0, 300),
    body: text,
    received_at: Number.isNaN(date) ? nowIso() : new Date(date).toISOString(),
    attachments: acc.attachments,
  };
}
