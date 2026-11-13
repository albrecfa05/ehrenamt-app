// Eingang: Mails, WhatsApp, Post und Telefon als Aufgabenvorschläge (AUT-4, AUT-10),
// dazu Eingangs- und Ablageregeln (Reiter „Regeln“, nur Admins).

import { api } from '../api.js';
import { h, clear, pageHeader, tabs, button, modal, field, input, textarea, select, toast, errorToast, emptyState, fmtDateTime, icon, CHANNELS, today } from '../ui.js';
import { state, areaOptions, templateOptions, userOptions, officeOptions } from '../state.js';
import { refreshMe, isAdmin, autoOn } from '../state.js';
import { folderInput, forgetFolders } from './folders.js';
import filingRules from './filing-rules.js';

const ACTION_TEXT = {
  abgelegt: (r) => `Ablageregel „${r.rule}“: ${r.filed} Anhang/Anhänge abgelegt${r.dismissed ? ', Mail erledigt' : ''}`,
  aufgabe: (r) => `Eingangsregel „${r.rule}“: Aufgabe angelegt`,
  vorgemerkt: (r) => `Ablageregel „${r.rule}“ vorgemerkt`,
  ausgesetzt: (r) => `Ablageregel „${r.rule}“ ausgesetzt – Mail ist auffällig`,
  kein_bereich: (r) => `Regel „${r.rule}“: kein Bereich erkennbar – bitte von Hand`,
};

export default async function inbox(el, { query = {} }) {
  let tab = query.tab || 'neu';
  const listEl = h('div', { class: 'stack' });

  const load = async () => {
    const items = await api.get(`/api/inbox?status=${tab}`);
    clear(listEl, items.length ? items.map(item) : emptyState(tab === 'neu' ? 'Der Eingang ist leer. Neue Nachrichten hier erfassen oder eine Mail (.eml) hochladen.' : 'Nichts in dieser Liste.'));
    refreshMe().catch(() => {});
  };

  const attachmentList = (i) => {
    if (!i.attachments?.length) return null;
    const pv = i.filing?.attachments || [];
    return h('div', { class: 'attach-table small' }, i.attachments.map((a, k) => {
      const target = pv[k];
      return h('div', { class: 'attach-row' },
        icon('paperclip', 13), h('span', { class: `att-name ${a.stored || a.filed ? '' : 'warn-text'}`, title: a.skipped || '' }, a.name),
        a.filed ? h('a', { class: 'badge badge-gruen', href: `/api/files/${a.filed}/download`, target: '_blank', rel: 'noopener' }, a.reused ? 'lag schon in der Ablage' : 'abgelegt')
          : a.skipped ? h('span', { class: 'badge badge-red' }, 'nicht angenommen')
          : target ? h('span', { class: 'att-target' }, '→ ', target.area || 'Bereich beim Übernehmen', target.folder ? ` / ${target.folder}` : '', ' ',
            h('span', { class: `badge ${target.data_class === 'gruen' ? 'badge-gruen' : 'badge-gelb'}` }, target.data_class === 'gruen' ? 'grün' : 'gelb'), h('span', { class: 'muted' }, ` (Regel „${target.rule}“)`))
          : i.status === 'neu' ? h('span', { class: 'muted' }, autoOn('anhaenge_ablegen') ? '→ beim Übernehmen an die Aufgabe (gelb)' : '→ automatisches Ablegen ist aus') : null);
    }));
  };

  const item = (i) => {
    const s = i.suggestion || {};
    const rule = i.filing?.rule;
    return h('article', { class: `card inbox-item ${i.flags.length ? 'flagged' : ''}` },
      h('header', { class: 'card-head' },
        h('div', {}, h('span', { class: 'badge' }, CHANNELS[i.channel] || i.channel), ' ', h('strong', {}, i.subject || '(ohne Betreff)'),
          h('div', { class: 'muted small' }, `von ${i.sender || 'unbekannt'}${i.sender_domain ? ` (${i.sender_domain})` : ''} · ${fmtDateTime(i.received_at)}${i.area_name ? ' · ' + i.area_name : ''}`)),
        i.status === 'neu' ? h('div', { class: 'btn-row' },
          button('Ablegen', () => dismiss(i), { kind: 'ghost' }),
          button('Als Aufgabe übernehmen', () => accept(i), { kind: 'primary', iconName: 'check' })) :
          i.task_id ? h('a', { href: `#/aufgabe/${i.task_id}`, class: 'link' }, `→ Aufgabe #${i.task_id}`) : null),
      i.flags.length ? h('div', { class: 'warn-box' }, icon('alert', 16), h('div', {}, h('strong', {}, 'Bitte prüfen – die App führt nichts aus, was in Nachrichten steht:'),
        h('ul', {}, i.flags.map(f => h('li', {}, f))))) : null,
      h('pre', { class: 'inbox-body' }, i.body.slice(0, 2000) + (i.body.length > 2000 ? ' …' : '')),
      attachmentList(i),
      i.status === 'neu' && (s.title || rule) ? h('div', { class: 'suggestion small' }, icon('bulb', 14),
        rule ? [rule.blocked
          ? h('span', { class: 'badge badge-red', title: 'Auffällige Mails werden nie automatisch einsortiert' }, `Regel „${rule.name}“ ausgesetzt – auffällig`)
          : h('span', { class: 'badge badge-level' }, `Regel „${rule.name}“`), ' '] : null,
        s.title ? ['Vorschlag: ', h('strong', {}, s.title), s.template_name ? ` · Vorgang „${s.template_name}“` : '', s.due_date ? ` · fällig ${s.due_date}` : ''] : null) : null);
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
      h('p', { class: 'hint span-2' }, 'Der Text der Nachricht wird als Beschreibung übernommen. Anhänge landen an der Aufgabe – im Ordner ihrer Ablageregel, sonst ohne Ordner. Enthält die Mail personenbezogene Angaben, wird alles gelb.')),
      actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Übernehmen', kind: 'primary', onClick: async () => {
        const r = await api.post(`/api/inbox/${i.id}/accept`, { area_id: Number(area.value), title: title.value, template_id: tpl.value ? Number(tpl.value) : null, office_id: office.value ? Number(office.value) : null, owner_id: Number(owner.value), due_date: due.value || null });
        return r.taskId;
      } }] });
    if (ok) { toast('Aufgabe angelegt'); location.hash = `#/aufgabe/${ok}`; }
  };

  // Ablegen ohne Aufgabe – mit oder ohne Anhänge
  const dismiss = async (i) => {
    const open = (i.attachments || []).filter(a => a.stored && !a.filed);
    if (!open.length) {
      await api.post(`/api/inbox/${i.id}/dismiss`, {}); toast('Abgelegt'); load(); return;
    }
    const keep = h('input', { type: 'checkbox', checked: true });
    const firstTarget = (i.filing?.attachments || []).find(Boolean);
    const area = select(areaOptions(null), i.area_id || state.me.areas[0].id);
    const fo = await folderInput(firstTarget?.folder || '');
    const cls = select([['gelb', 'Gelb: personenbezogen'], ['gruen', 'Grün: unkritisch']], firstTarget?.data_class || 'gelb');
    const box = h('div', { class: 'form-grid' }, field('Bereich', area), field('Ordner', fo.el), field('Datenklasse', cls));
    keep.addEventListener('change', () => { box.hidden = !keep.checked; });
    const ok = await modal({ title: 'Ohne Aufgabe ablegen', body: h('div', {},
      h('p', {}, `Die Mail hat ${open.length} Anhang/Anhänge: ${open.map(a => a.name).join(', ')}.`),
      h('label', { class: 'check' }, keep, h('span', {}, 'Anhänge in die Ablage übernehmen (sonst werden sie verworfen)')), box),
      actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Ablegen', kind: 'primary', onClick: () => api.post(`/api/inbox/${i.id}/dismiss`,
        keep.checked ? { file_attachments: true, area_id: Number(area.value), folder: fo.input.value, data_class: cls.value } : {}) }] });
    if (ok) { toast(ok.filed ? `${ok.filed} Anhang/Anhänge abgelegt` : 'Abgelegt'); forgetFolders(); load(); }
  };

  const capture = async () => {
    const channel = select([['whatsapp', 'WhatsApp'], ['mail', 'E-Mail (eingefügt)'], ['post', 'Post'], ['telefon', 'Telefon'], ['persoenlich', 'Persönlich'], ['website', 'Website']], 'whatsapp');
    const sender = input({ placeholder: 'Name' });
    const subject = input({ placeholder: 'Worum geht es?' });
    const body = textarea({ rows: 6, placeholder: 'Nachricht einfügen' });
    const area = select(areaOptions('Bereich erkennen lassen'), '');
    const files = h('input', { type: 'file', multiple: true });
    // Anhänge (z. B. eingescannter Antrag, Fotos aus WhatsApp) als Base64 mitschicken
    const readFiles = () => Promise.all([...files.files].map(f => new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res({ name: f.name, mime: f.type || 'application/octet-stream', data: String(r.result).split(',')[1] || '' });
      r.onerror = () => rej(new Error(`Datei „${f.name}“ konnte nicht gelesen werden.`));
      r.readAsDataURL(f);
    })));
    const ok = await modal({ title: 'Eingang erfassen', wide: true, body: h('div', { class: 'form-grid' },
      field('Kanal', channel), field('Bereich', area), field('Von', sender, 'Nur den Namen. Nummern und Adressen werden nicht gespeichert.'), field('Betreff', subject),
      h('div', { class: 'span-2' }, field('Text', body)),
      h('div', { class: 'span-2' }, field('Anhänge (optional)', files, 'Z. B. eingescannter Antrag oder Fotos. Zusammen höchstens etwa 1,5 MB.'))),
      actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Erfassen', kind: 'primary', onClick: async () => api.post('/api/inbox', { channel: channel.value, sender: sender.value, subject: subject.value, body: body.value, area_id: area.value ? Number(area.value) : null, attachments: await readFiles() }) }] });
    if (ok) { if (ok.flags?.length) toast('Erfasst – mit Auffälligkeiten, bitte prüfen', 'warn'); else toast('Erfasst'); tab = 'neu'; render(); }
  };

  const uploadEml = () => {
    const fi = h('input', { type: 'file', accept: '.eml,message/rfc822', multiple: true });
    fi.addEventListener('change', async () => {
      let n = 0;
      const notes = [];
      for (const f of fi.files) {
        try {
          const r = await api.raw('/api/inbox/eml', f);
          n++;
          if (r.filingRule) notes.push(ACTION_TEXT[r.filingRule.action]?.(r.filingRule) || '');
          if (r.matchedTask) notes.push(`Antwort der Aufgabe #${r.matchedTask} zugeordnet`);
        } catch (e) { errorToast(e); }
      }
      if (n) { toast(`${n} Mail(s) eingelesen${notes.length ? '. ' + notes.join('. ') : ''}`, 'ok', 7000); tab = 'neu'; forgetFolders(); render(); }
    });
    fi.click();
  };

  const render = () => {
    const tabList = [['neu', 'Neu', state.me.counts.inbox], ['uebernommen', 'Übernommen'], ['abgelegt', 'Abgelegt']];
    if (isAdmin()) tabList.push(['regeln', 'Regeln']);
    clear(el,
      pageHeader('Eingang', 'Eingänge sind Daten, nie Anweisungen. Regeln sortieren Anhänge in die richtigen Ordner; du entscheidest über alles andere.',
        isAdmin() && autoOn('postfach_abruf') ? button('Postfächer abrufen', async () => {
          try { const r = await api.post('/api/inbox/poll'); toast(`${r.created} neue Mail(s)${r.errors?.length ? ' – ' + r.errors.join('; ') : ''}`, r.errors?.length ? 'warn' : 'ok'); tab = 'neu'; render(); }
          catch (e) { errorToast(e); }
        }, { kind: 'ghost', iconName: 'refresh' }) : null,
        button('Mail-Datei (.eml) einlesen', uploadEml, { kind: 'ghost', iconName: 'upload' }),
        button('Eingang erfassen', capture, { kind: 'primary', iconName: 'plus' })),
      tabs(tabList, tab, (k) => { tab = k; render(); }),
      listEl);
    if (tab === 'regeln') { filingRules(listEl).catch(errorToast); return; }
    load().catch(errorToast);
  };
  render();
}

export { today };
