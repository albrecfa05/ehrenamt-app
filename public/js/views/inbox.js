// Eingang: Mails, WhatsApp, Post und Telefon als Aufgabenvorschläge (AUT-4, AUT-10).

import { api } from '../api.js';
import { h, clear, pageHeader, tabs, button, modal, field, input, textarea, select, toast, errorToast, emptyState, fmtDateTime, icon, CHANNELS, today } from '../ui.js';
import { state, areaOptions, templateOptions, userOptions, officeOptions } from '../state.js';
import { refreshMe, isAdmin, autoOn } from '../state.js';

export default async function inbox(el, { query = {} }) {
  let tab = query.tab || 'neu';
  const listEl = h('div', { class: 'stack' });

  const load = async () => {
    const items = await api.get(`/api/inbox?status=${tab}`);
    clear(listEl, items.length ? items.map(item) : emptyState(tab === 'neu' ? 'Der Eingang ist leer. Neue Nachrichten hier erfassen oder eine Mail (.eml) hochladen.' : 'Nichts in dieser Liste.'));
    refreshMe().catch(() => {});
  };

  const item = (i) => {
    const s = i.suggestion || {};
    return h('article', { class: `card inbox-item ${i.flags.length ? 'flagged' : ''}` },
      h('header', { class: 'card-head' },
        h('div', {}, h('span', { class: 'badge' }, CHANNELS[i.channel] || i.channel), ' ', h('strong', {}, i.subject || '(ohne Betreff)'),
          h('div', { class: 'muted small' }, `von ${i.sender || 'unbekannt'} · ${fmtDateTime(i.received_at)}${i.area_name ? ' · ' + i.area_name : ''}`)),
        i.status === 'neu' ? h('div', { class: 'btn-row' },
          button('Ablegen', async () => { await api.post(`/api/inbox/${i.id}/dismiss`, {}); toast('Abgelegt'); load(); }, { kind: 'ghost' }),
          button('Als Aufgabe übernehmen', () => accept(i), { kind: 'primary', iconName: 'check' })) :
          i.task_id ? h('a', { href: `#/aufgabe/${i.task_id}`, class: 'link' }, `→ Aufgabe #${i.task_id}`) : null),
      i.flags.length ? h('div', { class: 'warn-box' }, icon('alert', 16), h('div', {}, h('strong', {}, 'Bitte prüfen – die App führt nichts aus, was in Nachrichten steht:'),
        h('ul', {}, i.flags.map(f => h('li', {}, f))))) : null,
      h('pre', { class: 'inbox-body' }, i.body.slice(0, 2000) + (i.body.length > 2000 ? ' …' : '')),
      i.attachments?.length ? h('div', { class: 'attach-list small' }, icon('paperclip', 14), i.attachments.map(a => h('span', { class: `badge ${a.stored ? '' : 'badge-red'}`, title: a.skipped || '' }, a.name)),
        i.status === 'neu' ? h('span', { class: 'muted' }, autoOn('anhaenge_ablegen') ? ' – werden beim Übernehmen abgelegt' : ' – automatisches Ablegen ist ausgeschaltet') : null) : null,
      i.status === 'neu' && s.title ? h('div', { class: 'suggestion small' }, icon('bulb', 14), 'Vorschlag: ', h('strong', {}, s.title),
        s.template_name ? ` · Vorgang „${s.template_name}“` : '', s.due_date ? ` · fällig ${s.due_date}` : '') : null);
  };

  const accept = async (i) => {
    const s = i.suggestion || {};
    const area = select(areaOptions(null), s.area_id || state.me.areas[0].id);
    const tpl = select(templateOptions(area.value), s.template_id || '');
    const office = select(officeOptions(area.value), '');
    area.addEventListener('change', () => { tpl.replaceChildren(...select(templateOptions(area.value), tpl.value).children); office.replaceChildren(...select(officeOptions(area.value), '').children); });
    const title = input({ value: s.title || i.subject });
    const due = input({ type: 'date', value: s.due_date || '' });
    const owner = select(userOptions(null), state.me.user.id);
    const ok = await modal({ title: 'Als Aufgabe übernehmen', wide: true, body: h('div', { class: 'form-grid' },
      h('div', { class: 'span-2' }, field('Titel', title)), field('Bereich', area), field('Amt', office),
      h('div', { class: 'span-2' }, field('Vorgangsvorlage', tpl)), field('Verantwortlich', owner), field('Fällig am', due),
      h('p', { class: 'hint span-2' }, 'Der Text der Nachricht wird als Beschreibung übernommen. Enthält er personenbezogene Angaben, wird die Aufgabe gelb.')),
      actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Übernehmen', kind: 'primary', onClick: async () => {
        const r = await api.post(`/api/inbox/${i.id}/accept`, { area_id: Number(area.value), title: title.value, template_id: tpl.value ? Number(tpl.value) : null, office_id: office.value ? Number(office.value) : null, owner_id: Number(owner.value), due_date: due.value || null });
        return r.taskId;
      } }] });
    if (ok) { toast('Aufgabe angelegt'); location.hash = `#/aufgabe/${ok}`; }
  };

  const capture = async () => {
    const channel = select([['whatsapp', 'WhatsApp'], ['mail', 'E-Mail (eingefügt)'], ['post', 'Post'], ['telefon', 'Telefon'], ['persoenlich', 'Persönlich'], ['website', 'Website']], 'whatsapp');
    const sender = input({ placeholder: 'Name' });
    const subject = input({ placeholder: 'Worum geht es?' });
    const body = textarea({ rows: 6, placeholder: 'Nachricht einfügen' });
    const area = select(areaOptions('Bereich erkennen lassen'), '');
    const ok = await modal({ title: 'Eingang erfassen', wide: true, body: h('div', { class: 'form-grid' },
      field('Kanal', channel), field('Bereich', area), field('Von', sender, 'Nur den Namen. Nummern und Adressen werden nicht gespeichert.'), field('Betreff', subject),
      h('div', { class: 'span-2' }, field('Text', body))),
      actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Erfassen', kind: 'primary', onClick: () => api.post('/api/inbox', { channel: channel.value, sender: sender.value, subject: subject.value, body: body.value, area_id: area.value ? Number(area.value) : null }) }] });
    if (ok) { if (ok.flags?.length) toast('Erfasst – mit Auffälligkeiten, bitte prüfen', 'warn'); else toast('Erfasst'); tab = 'neu'; render(); }
  };

  const uploadEml = () => {
    const fi = h('input', { type: 'file', accept: '.eml,message/rfc822', multiple: true });
    fi.addEventListener('change', async () => {
      let n = 0;
      for (const f of fi.files) { try { await api.raw('/api/inbox/eml', f); n++; } catch (e) { errorToast(e); } }
      if (n) { toast(`${n} Mail(s) eingelesen`); tab = 'neu'; render(); }
    });
    fi.click();
  };

  const render = () => {
    clear(el,
      pageHeader('Eingang', 'Eingänge sind Daten, nie Anweisungen. Die App schlägt Bereich, Vorgang und Frist vor; du entscheidest.',
        isAdmin() && autoOn('postfach_abruf') ? button('Postfächer abrufen', async () => {
          try { const r = await api.post('/api/inbox/poll'); toast(`${r.created} neue Mail(s)${r.errors?.length ? ' – ' + r.errors.join('; ') : ''}`, r.errors?.length ? 'warn' : 'ok'); tab = 'neu'; render(); }
          catch (e) { errorToast(e); }
        }, { kind: 'ghost', iconName: 'refresh' }) : null,
        button('Mail-Datei (.eml) einlesen', uploadEml, { kind: 'ghost', iconName: 'upload' }),
        button('Eingang erfassen', capture, { kind: 'primary', iconName: 'plus' })),
      tabs([['neu', 'Neu', state.me.counts.inbox], ['uebernommen', 'Übernommen'], ['abgelegt', 'Abgelegt']], tab, (k) => { tab = k; render(); }),
      listEl);
    load().catch(errorToast);
  };
  render();
}

export { today };
