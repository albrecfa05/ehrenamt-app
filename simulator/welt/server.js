// Server der Vereinswelt: eigene Seite (simulator/public), eigene Schnittstellen unter /api,
// Downloads der Unterlagen, Mails als .eml und die Nachbau-Dienste für die App.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clockNow } from '../../server/clock.js';
import { W, save, fileMeta, readFile, log } from './zustand.js';
import { handleDienst } from './dienste.js';
import { handleJugendplaner, jpParents } from './jugendplaner.js';
import { scanToMail } from './kanaele.js';
import { MAILBOX, PEOPLE, TEAMS, VEREIN } from './verein.js';
import { advance, abortEreignis, evaluate, react, sendMail, skip, startEreignis, status } from './motor.js';
import { ausfuellen } from './ausfuellen.js';
import { mail } from './kanaele.js';
import { EREIGNISSE } from './geschichte.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const visible = (m) => m.received <= clockNow().toISOString();

function eml(m) {
  const b = `----=_welt_${m.id}`;
  const enc = (s) => `=?UTF-8?B?${Buffer.from(String(s)).toString('base64')}?=`;
  const lines = [
    `From: ${enc(m.fromName)} <${m.from}>`, `To: <${m.mailbox}>`, `Subject: ${enc(m.subject)}`, `Date: ${new Date(m.received).toUTCString()}`,
    `Message-ID: <${m.id}@vereinswelt.example>`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${b}"`, '',
    `--${b}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(m.body).toString('base64').replace(/.{76}/g, '$&\r\n'),
  ];
  for (const fid of m.attachments) {
    const f = fileMeta(fid);
    lines.push(`--${b}`, `Content-Type: ${f.mime}; name="${f.name}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${f.name}"`, '', readFile(fid).toString('base64').replace(/.{76}/g, '$&\r\n'));
  }
  lines.push(`--${b}--`, '');
  return lines.join('\r\n');
}

function info(appUrl, base) {
  return {
    verein: VEREIN, app_url: appUrl,
    people: PEOPLE.map(p => ({ name: p.name, role: p.role, area: p.area, mail: p.mail, office: p.office, you: !!p.you, admin: !!p.admin })),
    mailboxes: Object.entries(W().mailboxes).map(([address, name]) => ({ address, name })),
    teams: Object.entries(TEAMS).map(([key, t]) => ({ key, ...t, ics: `${base}/clicktt/${key}.ics` })),
    m365: { tenant: 'ttv-musterhausen.onmicrosoft.example', ablage_ziel: `users/${MAILBOX.ttv}/drive`, kalender: MAILBOX.ttv },
  };
}

/** Vorschau ohne Download: Text aus unseren PDFs (einfacher Aufbau, unkomprimiert), Text-Dateien, Bilder. */
function vorschau(f, buf) {
  if (/^image\//.test(f.mime)) return { kind: 'image', name: f.name, src: `data:${f.mime};base64,${buf.toString('base64')}` };
  if (f.mime === 'application/pdf') {
    const s = buf.toString('latin1');
    const W1252 = { 0x80: '€', 0x84: '„', 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—' };
    const lines = [];
    for (const page of s.split(/endstream/)) {
      for (const mm of page.matchAll(/\/(F\d) ([\d.]+) Tf [\d.]+ [\d.]+ Td \(((?:\\.|[^\\)])*)\) Tj/g)) {
        const text = mm[3].replace(/\\(.)/g, '$1').replace(/[\x80-\x9f]/g, c => W1252[c.charCodeAt(0)] || c);
        if (/Vorstandsarbeit-Simulator \(Fantasiedaten\)$/.test(text)) continue;
        lines.push({ text, bold: mm[1] === 'F2', size: Number(mm[2]) });
      }
    }
    return { kind: 'pdf', name: f.name, lines };
  }
  return { kind: 'text', name: f.name, text: buf.toString('utf8').slice(0, 200_000) };
}

export function createWeltServer(opts) {
  // opts.base wird bei jedem Aufruf gelesen (in Tests ist der Port erst nach dem Start bekannt)
  const { appUrl } = opts;
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://welt');
    const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
    try {
      if (await handleJugendplaner(req, res, url, '/jugendplaner', { getData: () => W().jp, saveData: (d) => { W().jp = d; save(); } })) return;
      if (await handleDienst(req, res, url)) return;
      const p = url.pathname;
      const body = async () => { const c = []; for await (const x of req) c.push(x); try { return JSON.parse(Buffer.concat(c).toString('utf8') || '{}'); } catch { return {}; } };

      // Dateien
      let m;
      if ((m = p.match(/^\/datei\/([\w-]+)$/))) {
        const f = fileMeta(m[1]);
        if (!f) return json({ error: 'Nicht gefunden' }, 404);
        res.writeHead(200, { 'Content-Type': f.mime, 'Content-Disposition': `${url.searchParams.has('ansehen') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}` });
        return res.end(readFile(m[1]));
      }
      if ((m = p.match(/^\/eml\/([\w-]+)$/))) {
        const mail = W().mails.find(x => x.id === m[1]);
        if (!mail) return json({ error: 'Nicht gefunden' }, 404);
        res.writeHead(200, { 'Content-Type': 'message/rfc822', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(mail.subject.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'Mail')}.eml` });
        return res.end(eml(mail));
      }

      // Schnittstellen der Vereinswelt
      if (p === '/api/status') return json(status());
      if (p === '/api/welt') return json(info(appUrl, opts.base));
      if (p === '/api/postfach') {
        const mb = url.searchParams.get('mailbox'), folder = url.searchParams.get('folder') || 'inbox';
        return json(W().mails.filter(x => x.mailbox === mb && x.folder === folder && visible(x)).sort((a, b) => b.received.localeCompare(a.received))
          .map(x => ({ id: x.id, from: x.from, fromName: x.fromName, to: x.to, subject: x.subject, received: x.received, read: x.read, attachments: x.attachments.length, source: x.source })));
      }
      if ((m = p.match(/^\/api\/mail\/([\w-]+)$/))) {
        const x = W().mails.find(y => y.id === m[1]);
        if (!x) return json({ error: 'Nicht gefunden' }, 404);
        if (!x.read) { x.read = true; save(); }
        return json({ ...x, attachments: x.attachments.map(fid => fileMeta(fid)) });
      }
      if (p === '/api/mail/send' && req.method === 'POST') return json({ id: sendMail(await body()), status: status() });
      if (p === '/api/post') return json(W().post.filter(x => x.date <= clockNow().toISOString()).slice().reverse().map(x => ({ ...x, file: x.file ? fileMeta(x.file) : null })));
      if ((m = p.match(/^\/api\/post\/([\w-]+)\/(scan|abheften)$/)) && req.method === 'POST') {
        const x = W().post.find(y => y.id === m[1]);
        if (!x) return json({ error: 'Nicht gefunden' }, 404);
        if (m[2] === 'scan') scanToMail(x.id); else { x.status = 'abgeheftet'; save(); }
        return json({ ok: true });
      }
      if (p === '/api/chats') return json(Object.entries(W().chats).map(([key, c]) => ({ key, name: c.name, messages: c.messages.map(x => ({ ...x, files: x.files.map(fid => fileMeta(fid)) })) })));
      if ((m = p.match(/^\/api\/chats\/(\w+)\/gelesen$/)) && req.method === 'POST') { W().chats[m[1]]?.messages.forEach(x => { x.read = true; }); save(); return json({ ok: true }); }
      if (p === '/api/ordner') return json(W().docs.map(d => ({ ...d, file: fileMeta(d.file) })));
      if (p === '/api/clicktt') return json({ teams: info(appUrl, opts.base).teams, games: W().games.filter(g => g.date >= clockNow().toISOString().slice(0, 10)).slice(0, 30) });
      if (p === '/api/jugendplaner') {
        const jp = W().jp, d0 = clockNow().toISOString().slice(0, 10);
        return json({ teams: jp.youthTeams, parents: jpParents(), url: `${opts.base}/jugendplaner`, games: jp.games.filter(g => g.date >= d0).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 24) });
      }
      if (p === '/api/jugendplaner/set' && req.method === 'POST') {
        const b = await body();
        const g = W().jp.games.find(x => x.id === b.id);
        if (!g) return json({ error: 'Spiel nicht gefunden' }, 404);
        if (b.field === 'drivers') g.drivers = String(b.value || '');
        else if (b.field === 'cancelled') g.cancelled = !!b.value;
        else if (b.field === 'avail') { if (b.value) g.avail[b.player] = b.value; else delete g.avail[b.player]; }
        W().jp.rev = (W().jp.rev || 0) + 1;
        save();
        log(`Jugendplaner: ${b.field === 'drivers' ? `Fahrer für ${g.team} am ${g.date}: ${g.drivers || '(leer)'}` : b.field === 'avail' ? `Rückmeldung für ${g.team} am ${g.date} geändert` : `${g.team} am ${g.date} ${g.cancelled ? 'abgesagt' : 'wieder angesetzt'}`}`);
        return json({ ok: true });
      }
      if (p === '/api/m365') return json({ aussen: W().aussen.slice().reverse(), drafts: W().mails.filter(x => x.folder === 'drafts').length, info: info(appUrl, opts.base).m365 });
      if (p === '/api/zeit' && req.method === 'POST') { const b = await body(); await advance(b.days); return json(status()); }
      if (p === '/api/pruefen' && req.method === 'POST') { react(); evaluate(); return json(status()); }
      if (p === '/api/ereignis' && req.method === 'POST') {
        const b = await body();
        let key = b.key;
        if (key === 'zufall') {
          const open = EREIGNISSE.filter(e => !W().ereignisse[e.key]);
          if (!open.length) return json(status());
          key = open[Math.floor(Math.random() * open.length)].key;
        }
        startEreignis(key);
        return json(status());
      }
      if (p === '/api/ereignis/abbrechen' && req.method === 'POST') { abortEreignis((await body()).key); return json(status()); }
      if (p === '/api/kapitel/ausfuellen' && req.method === 'POST') {
        const b = await body();
        const offen = status().einrichtung.filter(c => !c.ok && !c.skipped).map(c => c.key);
        const msgs = await ausfuellen(b.key, { appUrl, base: opts.base, offen });
        evaluate();
        return json({ messages: msgs, status: status() });
      }
      if (p === '/api/kapitel/ueberspringen' && req.method === 'POST') { const b = await body(); skip(b.key, b.on !== false); return json(status()); }
      if ((m = p.match(/^\/api\/datei\/([\w-]+)\/mailen$/)) && req.method === 'POST') {
        const f = fileMeta(m[1]);
        if (!f) return json({ error: 'Nicht gefunden' }, 404);
        const b = await body();
        mail(MAILBOX.ttv, { from: 'mia.muster@mail.example', fromName: 'Mia Muster (weitergeleitet)', subject: b.betreff || f.name, body: b.text || `Weitergeleitet aus der Vereinswelt: ${f.name}`, attachments: [[f.name, readFile(f.id), f.mime]] });
        log(`✉ ${f.name} ans Vorstandspostfach geschickt`);
        return json({ ok: true });
      }
      if ((m = p.match(/^\/api\/chats\/(\w+)\/([\w-]+)\/weiterleiten$/)) && req.method === 'POST') {
        const msg = W().chats[m[1]]?.messages.find(x => x.id === m[2]);
        if (!msg) return json({ error: 'Nicht gefunden' }, 404);
        mail(MAILBOX.ttv, { from: 'mia.muster@mail.example', fromName: `WhatsApp: ${msg.from} (weitergeleitet)`, subject: `WhatsApp ${W().chats[m[1]].name}: ${msg.text.slice(0, 50)}`, body: `${msg.from} schrieb in „${W().chats[m[1]].name}“:\n${msg.text}`, attachments: msg.files.map(fid => [fileMeta(fid).name, readFile(fid), fileMeta(fid).mime]) });
        log(`✉ WhatsApp-Nachricht von ${msg.from} ans Vorstandspostfach weitergeleitet`);
        return json({ ok: true });
      }
      if ((m = p.match(/^\/vorschau\/([\w-]+)$/))) {
        const f = fileMeta(m[1]);
        if (!f) return json({ error: 'Nicht gefunden' }, 404);
        return json(vorschau(f, readFile(f.id)));
      }
      if (p === '/api/einstellung' && req.method === 'POST') {
        const b = await body();
        if ('saison' in b) W().saison = !!b.saison;
        if ('rauschen' in b) W().rauschen = !!b.rauschen;
        if ('zweiterVerein' in b) W().zweiterVerein = !!b.zweiterVerein;
        save();
        log(`Einstellung: Saisonverlauf ${W().saison ? 'an' : 'aus'}, Alltagsrauschen ${W().rauschen ? 'an' : 'aus'}`);
        return json(status());
      }
      if (p.startsWith('/api/')) return json({ error: 'Unbekannt' }, 404);

      // Seite
      const file = path.join(PUBLIC, p === '/' ? 'index.html' : path.normalize(p).replace(/^([/\\])+/, ''));
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Nicht gefunden'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      if (!err.status) console.error('[Vereinswelt]', err);
      json({ error: err.message }, err.status || 500);
    }
  });
}
