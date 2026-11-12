// Mein Konto: Name, Passwort, Sitzungen, Kalender-Abo.

import { api } from '../api.js';
import { h, clear, pageHeader, button, input, field, toast, errorToast, fmtDateTime, relTime, confirmDialog } from '../ui.js';
import { state, refreshMe } from '../state.js';

export default async function account(el) {
  const sessions = await api.get('/api/me/sessions');
  const name = input({ value: state.me.user.name });
  const cur = input({ type: 'password', autocomplete: 'current-password' });
  const pw = input({ type: 'password', autocomplete: 'new-password' });
  const pw2 = input({ type: 'password', autocomplete: 'new-password' });
  const device = (ua) => /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Gerät';
  const browser = (ua) => /Edg\//.test(ua) ? 'Edge' : /Firefox/.test(ua) ? 'Firefox' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '';
  clear(el, pageHeader('Mein Konto', `${state.me.user.login} · ${state.me.user.role === 'admin' ? 'Admin' : 'Zuarbeit'}`),
    h('div', { class: 'grid-2' },
      h('section', { class: 'card pad' }, h('h2', {}, 'Name'), field('Anzeigename', name),
        button('Speichern', async () => { try { await api.put('/api/me', { name: name.value }); await refreshMe(); toast('Gespeichert'); } catch (e) { errorToast(e); } }, { kind: 'primary' })),
      h('section', { class: 'card pad' }, h('h2', {}, 'Passwort ändern'),
        field('Bisheriges Passwort', cur), field('Neues Passwort', pw, 'Mindestens 12 Zeichen, drei Zeichenarten, keine naheliegenden Wörter.'), field('Neues Passwort wiederholen', pw2),
        button('Passwort ändern', async () => {
          if (pw.value !== pw2.value) return errorToast(new Error('Die neuen Passwörter stimmen nicht überein.'));
          try { await api.post('/api/auth/password', { current: cur.value, password: pw.value }); toast('Passwort geändert. Andere Geräte sind abgemeldet.'); cur.value = pw.value = pw2.value = ''; account(el); } catch (e) { errorToast(e); }
        }, { kind: 'primary' })),
      h('section', { class: 'card pad' }, h('h2', {}, 'Angemeldete Geräte'),
        h('ul', { class: 'mini-list' }, sessions.map(s => h('li', {}, h('span', {}, `${device(s.user_agent)} ${browser(s.user_agent)}`, s.current ? h('span', { class: 'badge badge-gruen' }, 'dieses Gerät') : null),
          h('small', { class: 'muted' }, `seit ${fmtDateTime(s.created_at)} · zuletzt ${relTime(s.last_seen)}`)))),
        sessions.length > 1 ? button('Alle anderen Geräte abmelden', async () => {
          if (!(await confirmDialog('Alle anderen Sitzungen beenden?', { ok: 'Abmelden', danger: true }))) return;
          const r = await api.post('/api/me/sessions/revoke-others'); toast(`${r.revoked} Sitzung(en) beendet`); account(el);
        }, { kind: 'ghost' }) : null),
      h('section', { class: 'card pad' }, h('h2', {}, 'Kalender-Abo'), h('p', {}, 'Termine und Fristen in deinem eigenen Kalender.'), h('a', { class: 'btn', href: '#/kalender/abo' }, 'Abo-Link anzeigen'))));
}
