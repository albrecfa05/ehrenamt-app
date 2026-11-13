// Eingang → Regeln: Eingangs- und Ablageregeln pflegen, Reihenfolge, Probelauf, nachträglich anwenden.

import { api } from '../api.js';
import { h, clear, button, iconButton, select, input, field, modal, toast, errorToast, confirmDialog, relTime, icon, textarea } from '../ui.js';
import { state, areaOptions, templateOptions, officeOptions, autoOn } from '../state.js';
import { folderInput, forgetFolders } from './folders.js';

const MODE_LABEL = { vormerken: 'vormerken', ablegen: 'nur ablegen', aufgabe: 'Aufgabe anlegen' };

export default async function filingRules(el) {
  const { rules, modes } = await api.get('/api/filing-rules');
  const reload = () => filingRules(el).catch(errorToast);

  const cond = (r) => [
    r.area_name ? `Bereich ${r.area_name}` : null,
    r.sender_contains ? `Absender enthält „${r.sender_contains}“` : null,
    r.subject_contains ? `Betreff enthält „${r.subject_contains}“` : null,
    r.filename_contains ? `Dateiname enthält „${r.filename_contains}“` : null,
    r.file_types ? `Dateityp ${r.file_types}` : null,
  ].filter(Boolean).join(' und ');
  const result = (r) => [
    r.target_area_name || 'Bereich des Eingangs',
    r.folder ? `Ordner „${r.folder}“` : 'ohne Ordner',
    r.data_class === 'gruen' ? 'grün' : 'gelb',
    MODE_LABEL[r.mode] + (r.mode === 'aufgabe' && r.template_name ? ` (${r.template_name})` : '') + (r.dismiss_mail ? ', Mail danach erledigt' : ''),
    r.mirror ? 'SharePoint-Kopie vorschlagen' : null,
  ].filter(Boolean).join(' · ');

  const move = async (i, dir) => {
    const ids = rules.map(r => r.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api.post('/api/filing-rules/order', { ids });
    reload();
  };

  const ruleCard = (r, i) => {
    const toggle = h('input', { type: 'checkbox', class: 'switch', checked: !!r.active, 'aria-label': 'Regel aktiv' });
    toggle.addEventListener('change', async () => { await api.put(`/api/filing-rules/${r.id}`, { active: toggle.checked }); toast(toggle.checked ? 'Aktiviert' : 'Pausiert'); });
    return h('article', { class: `auto-item ${r.active ? 'on' : ''}` },
      h('div', { class: 'auto-toggle' }, toggle),
      h('div', { class: 'auto-body' },
        h('div', { class: 'auto-title' }, h('span', { class: 'rule-no' }, i + 1), h('strong', {}, r.name),
          h('span', { class: `pill ${r.mode === 'vormerken' ? 'st-offen' : 'st-arbeit'}` }, MODE_LABEL[r.mode]),
          r.origin ? h('span', { class: 'badge' }, r.origin) : null,
          h('span', { class: 'muted small' }, r.hits ? `${r.hits} Treffer, zuletzt ${relTime(r.last_hit_at)}` : 'noch kein Treffer')),
        h('div', { class: 'rule-flow small' }, h('span', { class: 'rf-when' }, 'Wenn ', cond(r)), icon('chevronRight', 14), h('span', { class: 'rf-do' }, result(r)))),
      h('div', { class: 'step-edit-actions' },
        iconButton('chevronLeft', () => move(i, -1), 'nach oben'), iconButton('chevronRight', () => move(i, 1), 'nach unten'),
        iconButton('edit', () => edit(r), 'Bearbeiten'),
        iconButton('trash', async () => { if (await confirmDialog(`Regel „${r.name}“ löschen?`, { danger: true, ok: 'Löschen' })) { await api.del(`/api/filing-rules/${r.id}`); reload(); } }, 'Löschen')));
  };

  async function edit(r = {}) {
    const name = input({ value: r.name || '' });
    const area = select(areaOptions('egal'), r.area_id || '');
    const sender = input({ value: r.sender_contains || '', placeholder: 'z. B. gemeinde-hohberg.de, Staffelleiter' });
    const subject = input({ value: r.subject_contains || '', placeholder: 'z. B. Rechnung, Spielverlegung' });
    const fname = input({ value: r.filename_contains || '', placeholder: 'z. B. Ausschreibung, Protokoll' });
    const types = input({ value: r.file_types || '', placeholder: 'z. B. pdf, docx' });
    const target = select(areaOptions('wie der Eingang'), r.target_area_id || '');
    const fo = await folderInput(r.folder || '');
    const cls = select([['gelb', 'Gelb: kann Personendaten enthalten'], ['gruen', 'Grün: unkritisch (z. B. Spielpläne, Firmenrechnungen)']], r.data_class || 'gelb');
    const occ = input({ value: r.occasion || '', placeholder: 'leer = Dateiname; {{betreff}} {{datei}} {{absender}}' });
    const tags = input({ value: r.tags || '', placeholder: 'Schlagwörter für die Suche' });
    const mode = select(Object.entries(modes), r.mode || 'vormerken');
    const tpl = select(templateOptions(null, '— ohne Vorlage —'), r.template_id || '');
    const office = select(officeOptions(target.value || state.me.areas[0].id, '— kein Amt —'), r.office_id || '');
    target.addEventListener('change', () => office.replaceChildren(...select(officeOptions(target.value || state.me.areas[0].id, '— kein Amt —'), '').children));
    const mirror = h('input', { type: 'checkbox', checked: !!r.mirror });
    const dismissMail = h('input', { type: 'checkbox', checked: !!r.dismiss_mail });
    const taskBox = h('div', { class: 'form-grid span-2' }, field('Vorgangsvorlage für die Aufgabe', tpl), field('Amt', office));
    const dismissBox = h('label', { class: 'check span-2' }, dismissMail, h('span', {}, 'Mail danach aus dem Eingang nehmen, wenn alle Anhänge abgelegt sind'));
    const upd = () => { taskBox.hidden = mode.value !== 'aufgabe'; dismissBox.hidden = mode.value !== 'ablegen'; };
    mode.addEventListener('change', upd); upd();
    const ok = await modal({ title: r.id ? `Regel „${r.name}“` : 'Neue Eingangs- und Ablageregel', wide: true, body: h('div', {},
      h('div', { class: 'form-grid' }, h('div', { class: 'span-2' }, field('Name', name))),
      h('h4', {}, 'Wenn … (leere Felder = egal, mehrere Begriffe mit Komma = einer genügt)'),
      h('div', { class: 'form-grid' }, field('Absender (Name oder Domain)', sender, 'Keine vollständige Mailadresse – die App speichert nur Name und Domain.'), field('Betreff enthält', subject),
        field('Dateiname enthält', fname), field('Dateityp', types), field('Nur Eingänge aus Bereich', area)),
      h('h4', {}, 'dann …'),
      h('div', { class: 'form-grid' }, field('Ablegen im Bereich', target), field('Ordner', fo.el, 'Unterordner mit „/“, z. B. Sponsoring/Verträge'),
        field('Datenklasse', cls, 'Enthält die Mail Personendaten, wird trotzdem gelb.'), field('Anlass im Dateinamen', occ), field('Schlagwörter', tags), field('Mit der Mail', mode),
        taskBox, dismissBox,
        h('label', { class: 'check span-2' }, mirror, h('span', {}, `Kopie in die Vereinsablage (SharePoint) vorschlagen – nach Freigabe${autoOn('ablage_spiegeln') ? '' : ' (zurzeit nicht verbunden)'}`))),
      h('p', { class: 'hint' }, 'Auffällige Mails (Zahlungsdruck, Passwortfragen, Gesundheitsangaben) sortiert die App nie automatisch ein. Die erste passende Regel gewinnt.')),
      actions: [{ label: 'Abbrechen', kind: 'ghost' }, { label: 'Speichern', kind: 'primary', onClick: () => {
        const b = { name: name.value, area_id: area.value ? Number(area.value) : null, sender_contains: sender.value, subject_contains: subject.value, filename_contains: fname.value,
          file_types: types.value, target_area_id: target.value ? Number(target.value) : null, folder: fo.input.value, data_class: cls.value, occasion: occ.value, tags: tags.value,
          mode: mode.value, template_id: tpl.value ? Number(tpl.value) : null, office_id: office.value ? Number(office.value) : null, mirror: mirror.checked, dismiss_mail: dismissMail.checked,
          pos: r.pos ?? (rules.length + 1) * 10 };
        return r.id ? api.put(`/api/filing-rules/${r.id}`, b) : api.post('/api/filing-rules', b);
      } }] });
    if (ok) { toast('Gespeichert'); forgetFolders(); reload(); }
  }

  // Probelauf
  const tSender = input({ placeholder: 'z. B. Gemeinde Hohberg <halle@gemeinde-hohberg.de>' });
  const tSubject = input({ placeholder: 'Betreff' });
  const tFiles = textarea({ rows: 2, placeholder: 'Dateinamen, z. B. Hallenplan.pdf, foto.jpg' });
  const tArea = select(areaOptions('Bereich des Postfachs: egal'), '');
  const tOut = h('div', { class: 'small' });
  const runTest = async () => {
    const r = await api.post('/api/filing-rules/test', { sender: tSender.value, subject: tSubject.value, filenames: tFiles.value, area_id: tArea.value ? Number(tArea.value) : null });
    clear(tOut,
      h('p', {}, r.rule ? ['Greifende Regel: ', h('strong', {}, r.rule.name), ` (${MODE_LABEL[r.rule.mode]})`] : 'Keine Regel greift – die Mail bleibt einfach im Eingang.',
        r.mail.domain ? h('span', { class: 'muted' }, ` · erkannte Domain: ${r.mail.domain}`) : null),
      r.files.length ? h('ul', { class: 'mini-list' }, r.files.map(f => h('li', {}, h('span', {}, f.name),
        h('small', { class: f.rule ? '' : 'muted' }, f.rule ? `→ ${f.area || 'Bereich des Eingangs'}${f.folder ? ' / ' + f.folder : ''} (${f.data_class === 'gruen' ? 'grün' : 'gelb'}) · „${f.rule}“` : 'keine Regel')))) : null);
  };

  clear(el,
    h('div', { class: 'toolbar' },
      h('p', { class: 'muted' }, autoOn('ablageregeln') ? 'Neue Mails werden nach diesen Regeln einsortiert – aus dem Postfach und aus .eml-Dateien.' : 'Die Automatisierung „Eingangs- und Ablageregeln anwenden“ ist ausgeschaltet (Adminpanel → Automatisierungen).'),
      h('div', { class: 'btn-row' },
        button('Auf offene Eingänge anwenden', async () => {
          const r = await api.post('/api/filing-rules/apply-inbox');
          toast(r.results.length ? `${r.results.length} Eingang/Eingänge bearbeitet` : 'Keine Regel hat gegriffen', 'ok', 6000);
          forgetFolders();
        }, { kind: 'ghost', iconName: 'play' }),
        button('Mit KI entwerfen', () => { location.hash = '#/automatisierung/ki'; }, { kind: 'ghost', iconName: 'zap' }),
        button('Neue Regel', () => edit(), { kind: 'primary', iconName: 'plus' }))),
    rules.length ? h('section', { class: 'card auto-group' }, rules.map(ruleCard))
      : h('div', { class: 'card pad' }, h('p', {}, 'Noch keine Regeln. Beispiele:'),
        h('ul', { class: 'small' }, h('li', {}, 'Absender „gemeinde-hohberg.de“, Dateityp pdf → Ordner „Hallenbelegung“, grün, nur ablegen'),
          h('li', {}, 'Betreff „Rechnung“ → Ordner „Rechnungen“, Aufgabe mit Vorgang VOR-5'),
          h('li', {}, 'Dateiname „Ausschreibung“ → Ordner „Turniere“, grün, vormerken'))),
    h('section', { class: 'card pad mt' }, h('h2', {}, icon('search', 16), ' Probelauf'),
      h('p', { class: 'small muted' }, 'Ausprobieren, welche Regel bei einer Mail greifen würde – ohne etwas abzulegen.'),
      h('div', { class: 'form-grid' }, field('Absender', tSender), field('Betreff', tSubject), field('Anhänge', tFiles), field('Bereich', tArea)),
      button('Prüfen', () => runTest().catch(errorToast), { kind: 'primary' }), tOut));
}
