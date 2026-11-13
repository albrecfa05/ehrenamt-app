// Wege, auf denen in der Vereinswelt etwas passiert: Postfach, Briefkasten, WhatsApp-Gruppen.

import { clockNow } from '../../server/clock.js';
import { W, save, putFile, newId, log } from './zustand.js';
import { MAILBOX } from './verein.js';

const now = () => clockNow().toISOString();

/** Mail in ein Postfach der Welt. attachments: [[name, Buffer, mime?]] */
export function mail(mailbox, { from, fromName, subject, body, attachments = [], received = null, conv = null, to = null }) {
  const id = newId('m');
  W().mails.push({
    id, mailbox: mailbox.toLowerCase(), folder: 'inbox', from, fromName: fromName || from, to: to || mailbox, subject, body,
    received: received || now(), read: false, conv: conv || `conv-${id}`, source: 'welt',
    attachments: attachments.map(([name, data, mime]) => putFile(name, mime || guessMime(name), data)),
  });
  save();
  return id;
}

/** Brief im Vereinsbriefkasten (Papier). file: [name, Buffer] */
export function post({ from, title, text, file = null }) {
  const id = newId('p');
  W().post.push({ id, date: now(), from, title, text, file: file ? putFile(file[0], guessMime(file[0]), file[1]) : null, status: 'neu' });
  save();
  return id;
}

/** WhatsApp-Nachricht in einer Gruppe. files: [[name, Buffer]] */
export function whatsapp(group, from, text, files = []) {
  const id = newId('w');
  W().chats[group].messages.push({ id, at: now(), from, text, files: files.map(([n, d]) => putFile(n, guessMime(n), d)) });
  save();
  return id;
}

/** Brief einscannen: der Multifunktionsdrucker im Vereinsheim mailt den Scan ans Vorstandspostfach. */
export function scanToMail(postId) {
  const p = W().post.find(x => x.id === postId);
  if (!p) throw Object.assign(new Error('Brief nicht gefunden.'), { status: 404 });
  const id = newId('m');
  W().mails.push({ id, mailbox: MAILBOX.ttv, folder: 'inbox', from: 'scanner@ttv-musterhausen.example', fromName: 'Scanner Vereinsheim', to: MAILBOX.ttv,
    subject: `Scan: ${p.title}`, body: `Gescannt im Vereinsheim.\n\n${p.text || ''}`, received: now(), read: false, conv: `conv-${id}`, source: 'welt',
    attachments: p.file ? [p.file] : [] });
  p.status = 'gescannt';
  save();
  log(`Brief „${p.title}“ eingescannt und an ${MAILBOX.ttv} geschickt.`);
  return id;
}

export function guessMime(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return { pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', eml: 'message/rfc822' }[ext] || 'application/octet-stream';
}
