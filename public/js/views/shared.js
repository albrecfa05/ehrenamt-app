// Wiederverwendbare Dialoge: Entwurf aus Vorlage, Rechner, Datei hochladen, Entwurfskarte.

import { api } from '../api.js';
import { h, modal, field, input, textarea, select, toast, errorToast, button, copyText, fmtDateTime, formValues, fmtBytes, icon, today } from '../ui.js';
import { state, areaOptions, autoOn, refreshMe } from '../state.js';
import { folderInput } from './folders.js';

// ---------- Entwurf aus Textvorlage (AUT-5) ----------

export async function draftDialog(task, preselectId) {
  const templates = (await api.get('/api/text-templates')).filter(t => !t.area_id || t.area_id === task.area_id);
  const tplSel = select([['', 'Vorlage wählen …'], ...templates.map(t => [t.id, `${t.category} · ${t.name}`])], preselectId || '');
  const varsBox = h('div', { class: 'form-grid' });
  const recipients = textarea({ rows: 2, placeholder: 'Nur Namen, durch Komma oder Zeile getrennt. Keine Adressen.' });
  const preview = h('div', { class: 'preview' });
  let values = {};
  const renderVars = () => {
    const t = templates.find(x => String(x.id) === tplSel.value);
    varsBox.replaceChildren();
    preview.replaceChildren();
    if (!t) return;
    for (const v of t.variables.filter(v => !v.builtin)) {
      const i = input({ value: values[v.name] ?? '', placeholder: v.default || '' });
      i.addEventListener('input', () => { values[v.name] = i.value; updatePreview(); });
      varsBox.append(field(v.name.replace(/_/g, ' '), i));
    }
    if (t.notes) varsBox.append(h('p', { class: 'hint span-2' }, t.notes));
    updatePreview();
  };
  let pt;
  const updatePreview = () => {
    clearTimeout(pt);
    pt = setTimeout(async () => {
      if (!tplSel.value) return;
      const r = await api.post(`/api/text-templates/${tplSel.value}/preview`, { values, area_id: task.area_id }).catch(() => null);
      if (!r) return;
      preview.replaceChildren(h('div', { class: 'preview-subject' }, r.subject), h('pre', { class: 'preview-body' }, r.body),
        r.warnings.length ? h('ul', { class: 'warnings' }, r.warnings.map(w => h('li', {}, w))) : null);
    }, 200);
  };
  tplSel.addEventListener('change', () => { values = {}; renderVars(); });
  if (preselectId) renderVars();
  const id = await modal({
    title: 'Entwurf aus Vorlage', wide: true,
    body: h('div', {}, field('Textvorlage', tplSel), varsBox, field('Empfänger (optional)', recipients, 'Ab 5 Empfängern ist beim Übernehmen eine eigene Bestätigung der Liste nötig.'),
      h('h4', { class: 'mt' }, 'Vorschau'), preview),
    actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Entwurf erzeugen', kind: 'primary', onClick: async () => {
      if (!tplSel.value) throw new Error('Bitte eine Vorlage wählen.');
      const r = await api.post(`/api/tasks/${task.id}/drafts`, { template_id: Number(tplSel.value), values, recipients: recipients.value });
      return r.id;
    } }],
  });
  if (id) toast('Entwurf erzeugt. Versand nur durch dich.');
  return id;
}

/** Karte eines Entwurfs mit Bearbeiten, Kopieren, Mailprogramm, Übernehmen, Verwerfen. */
export function draftCard(d, onChange) {
  const subject = input({ value: d.subject });
  const body = textarea({ rows: 10, value: d.body });
  const rec = textarea({ rows: 2, value: (d.recipients || []).join(', ') });
  const editable = d.status === 'entwurf';
  if (!editable) { subject.disabled = true; body.disabled = true; rec.disabled = true; }
  const save = async () => { await api.put(`/api/drafts/${d.id}`, { subject: subject.value, body: body.value, recipients: rec.value }); };
  const take = async () => {
    try {
      await save();
      const list = rec.value.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
      let payload = {};
      if (list.length >= 5) {
        const ok = await modal({ title: `Empfängerliste bestätigen (${list.length})`,
          body: h('div', {}, h('p', {}, 'Diese Nachricht geht an viele Empfänger. Bitte die Liste prüfen (AUT-7):'), h('ol', { class: 'recipients' }, list.map(n => h('li', {}, n)))),
          actions: [{ label: 'Abbrechen', kind: 'ghost', value: false }, { label: `Ja, an alle ${list.length} – ich verschicke selbst`, kind: 'primary', value: true }] });
        if (!ok) return;
        payload = { confirmRecipients: true, recipientCount: list.length };
      }
      await api.post(`/api/drafts/${d.id}/take`, payload);
      toast('Als übernommen protokolliert. Bitte jetzt selbst verschicken.');
      onChange?.();
    } catch (e) { errorToast(e); }
  };
  const mailto = () => {
    save().catch(() => {});
    location.href = `mailto:?subject=${encodeURIComponent(subject.value)}&body=${encodeURIComponent(body.value)}`;
  };
  return h('div', { class: `draft-card status-${d.status}` },
    h('div', { class: 'draft-head' },
      h('div', {}, h('strong', {}, d.template_name || 'Entwurf'), d.template_version ? h('span', { class: 'badge' }, `Vorlage v${d.template_version}`) : null,
        d.rule_name ? h('span', { class: 'badge badge-level' }, `aus Regel „${d.rule_name}“`) : null),
      h('small', { class: 'muted' }, d.status === 'uebernommen' ? `übernommen ${fmtDateTime(d.taken_at)}` : d.status === 'verworfen' ? 'verworfen' : fmtDateTime(d.created_at))),
    (d.warnings || []).length ? h('ul', { class: 'warnings' }, d.warnings.map(w => h('li', {}, w))) : null,
    field('Betreff', subject), field('Text', body), field('Empfänger (Namen)', rec),
    editable ? h('div', { class: 'btn-row' },
      button('Speichern', async () => { try { await save(); toast('Gespeichert'); } catch (e) { errorToast(e); } }, { kind: 'ghost' }),
      button('Kopieren', () => copyText(`${subject.value}\n\n${body.value}`), { kind: 'ghost', iconName: 'copy' }),
      button('Im Mailprogramm öffnen', mailto, { kind: 'ghost', iconName: 'external' }),
      h('span', { class: 'spacer' }),
      button('Verwerfen', async () => { await api.post(`/api/drafts/${d.id}/discard`); onChange?.(); }, { kind: 'ghost' }),
      autoOn('postfach_entwuerfe') ? button('Ins Postfach legen', async () => {
        try {
          await save();
          await api.post(`/api/drafts/${d.id}/mailbox`);
          toast('Freigabe angefragt: Nach dem Ja eines Admins liegt der Entwurf im Postfach. Verschickt wird er von dir in Outlook.', 'ok', 6000);
          refreshMe().catch(() => {});
          onChange?.();
        } catch (e) { errorToast(e); }
      }, { kind: 'ghost', iconName: 'inbox', title: 'Stufe 3: als Entwurf ins Funktionspostfach – nach Freigabe' }) : null,
      button('Übernehmen', take, { kind: 'primary', iconName: 'check', title: 'Du verschickst selbst; die App protokolliert die Übernahme.' })) :
    d.remote_id ? h('div', { class: 'small muted' }, `Liegt als Entwurf im Postfach ${d.mailbox}. Antworten werden der Aufgabe automatisch zugeordnet.`) : null);
}

// ---------- Rechner (AUT-12) ----------

let calcCache;
export async function calcDialog(task, preselect) {
  calcCache ||= await api.get('/api/calculators');
  const sel = select([['', 'Rechner wählen …'], ...calcCache.map(c => [c.key, c.label])], preselect || '');
  const box = h('div', {});
  const result = h('div', { class: 'calc-result' });
  const render = () => {
    const c = calcCache.find(x => x.key === sel.value);
    box.replaceChildren(); result.replaceChildren();
    if (!c) return;
    box.append(h('p', { class: 'hint' }, c.description));
    const grid = h('div', { class: 'form-grid' });
    for (const fdef of c.fields) {
      let ctl;
      if (fdef.type === 'select') ctl = select((fdef.options || []).map(o => [o, o]), fdef.default ?? '', { name: fdef.name });
      else if (fdef.type === 'textarea') ctl = textarea({ name: fdef.name, rows: 4 });
      else ctl = input({ name: fdef.name, type: fdef.type === 'number' ? 'number' : fdef.type === 'date' ? 'date' : 'text', value: fdef.default ?? (fdef.type === 'date' ? today() : ''), step: fdef.type === 'number' ? 'any' : null });
      grid.append(h('div', { class: fdef.type === 'textarea' ? 'span-2' : '' }, field(fdef.label, ctl)));
    }
    box.append(grid);
  };
  sel.addEventListener('change', render);
  render();
  await modal({
    title: 'Berechnung mit Rechenweg', wide: true,
    body: h('div', {}, field('Rechner', sel), box, result),
    actions: [{ label: 'Schließen', kind: 'ghost' }, { label: task ? 'Berechnen und an Aufgabe speichern' : 'Berechnen', kind: 'primary', onClick: async () => {
      if (!sel.value) throw new Error('Bitte einen Rechner wählen.');
      const values = formValues(box);
      const r = task ? await api.post(`/api/tasks/${task.id}/calc`, { calc: sel.value, input: values }) : await api.post(`/api/calculators/${sel.value}`, values);
      result.replaceChildren(h('div', { class: 'calc-summary' }, icon('calc', 16), r.summary), h('ol', { class: 'calc-steps' }, r.steps.map(s => h('li', {}, s))),
        r.result?.plan ? h('table', { class: 'table' }, h('tbody', {}, r.result.plan.map(p => h('tr', {}, h('td', {}, p.termin), h('td', {}, p.personen.join(', ') || '—', p.fehlt ? h('span', { class: 'warn-text' }, ` (fehlen ${p.fehlt})`) : null))))) : null);
      if (task) toast('Ergebnis mit Rechenweg im Vorgang gespeichert');
      return false; // Dialog offen lassen, damit das Ergebnis sichtbar bleibt
    } }],
  });
}

// ---------- Datei hochladen (ABL-1, ABL-2, DAT-1) ----------

export async function uploadDialog({ areaId, taskId, folder = '' } = {}) {
  const fileInput = h('input', { type: 'file', multiple: true, required: true });
  const area = select(areaOptions(null), areaId || state.me.areas[0]?.id, { name: 'area_id', disabled: !!taskId });
  const dataClass = select([['gruen', 'Grün: unkritisch, darf dauerhaft liegen'], ['gelb', 'Gelb: personenbezogen (Stammdaten, Bankdaten, Minderjährige)'], ['rot', 'Rot: Gesundheit, Zugangsdaten']], 'gruen');
  const docDate = input({ type: 'date', value: today() });
  const issuer = input({ placeholder: 'z. B. Sporthaus Müller, Bezirk, Gemeinde' });
  const occasion = input({ placeholder: 'z. B. Rechnung Bälle, Aufnahmeantrag' });
  const fo = await folderInput(folder);
  const nameOut = h('code', { class: 'filename' }, '');
  const redWarn = h('div', { class: 'form-error', hidden: true }, 'Rote Daten nimmt die App nicht an (DAT-1). Bitte nicht hochladen.');
  const upd = async () => {
    redWarn.hidden = dataClass.value !== 'rot';
    const f = fileInput.files[0];
    if (!f) { nameOut.textContent = '—'; return; }
    const r = await api.post('/api/files/suggest-name', { doc_date: docDate.value, issuer: issuer.value, occasion: occasion.value, original_name: f.name });
    nameOut.textContent = fileInput.files.length > 1 ? `${r.filename} (und ${fileInput.files.length - 1} weitere mit eigenem Anlass)` : r.filename;
  };
  for (const el of [fileInput, docDate, issuer, occasion, dataClass]) el.addEventListener('input', upd);
  fileInput.addEventListener('change', upd);
  const ok = await modal({
    title: 'Datei ablegen', wide: true,
    body: h('div', { class: 'form-grid' },
      h('div', { class: 'span-2' }, field('Datei(en)', fileInput, 'Erlaubt: PDF, Bilder, Office, Text, Mail (.eml). Höchstens 25 MB.')),
      field('Bereich', area), field('Datenklasse (Ampel)', dataClass),
      field('Datum des Dokuments', docDate), field('Aussteller', issuer),
      field('Anlass', occasion), field('Ordner', fo.el, 'optional, Unterordner mit „/“'),
      h('div', { class: 'span-2' }, h('div', { class: 'hint' }, 'Einheitlicher Name: ', nameOut)), h('div', { class: 'span-2' }, redWarn)),
    actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Hochladen', kind: 'primary', onClick: async () => {
      if (!fileInput.files.length) throw new Error('Bitte eine Datei wählen.');
      if (dataClass.value === 'rot') throw new Error('Rote Daten nimmt die App nicht an (DAT-1).');
      let n = 0;
      for (const f of fileInput.files) {
        const r = await api.upload('/api/files', f, {
          area_id: Number(area.value), task_id: taskId || null, data_class: dataClass.value, original_name: f.name, mime: f.type, folder: fo.input.value,
          doc_date: docDate.value, issuer: issuer.value, occasion: fileInput.files.length > 1 ? (occasion.value ? `${occasion.value} ${n + 1}` : '') : occasion.value,
        });
        if (r.duplicateOf) toast(`Hinweis: identische Datei liegt schon als „${r.duplicateOf.filename}“ in der Ablage.`, 'warn', 6000);
        n++;
      }
      return n;
    } }],
  });
  if (ok) toast(`${ok} Datei(en) abgelegt`);
  return ok;
}

export function fileLink(f) {
  const viewable = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)/.test(f.mime || '');
  return h('div', { class: 'file-item' },
    icon('paperclip', 14),
    h('a', { href: `/api/files/${f.id}/download${viewable ? '?inline=1' : ''}`, target: '_blank', rel: 'noopener' }, f.filename),
    f.data_class === 'gelb' ? h('span', { class: 'badge badge-gelb' }, 'Gelb') : null,
    f.size ? h('small', { class: 'muted' }, fmtBytes(f.size)) : null);
}
