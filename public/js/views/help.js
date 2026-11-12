// Dokumentations- und FAQ-Bereich (NFA-7) und Änderungsverlauf (ABL-5).

import { api } from '../api.js';
import { h, clear, pageHeader, tabs, fmtDateTime, LEVELS, LEVEL_HINT, icon } from '../ui.js';

export default async function help(el, { tab = 'faq' }) {
  const body = h('div');
  clear(el, pageHeader('Hilfe und FAQ', 'So funktioniert die App – und was sich zuletzt geändert hat.'),
    tabs([['faq', 'Häufige Fragen'], ['grundsaetze', 'Grundsätze'], ['aenderungen', 'Änderungen'], ['tastatur', 'Tastatur']], tab, (k) => { location.hash = `#/hilfe/${k}`; }), body);
  if (tab === 'aenderungen') {
    const rows = await api.get('/api/changelog');
    return clear(body, h('ul', { class: 'changelog card pad' }, rows.map(c => h('li', {}, h('strong', {}, c.title), c.version ? h('span', { class: 'badge' }, `v${c.version}`) : null,
      c.note ? h('div', { class: 'muted pre' }, c.note) : null, h('small', {}, `${fmtDateTime(c.created_at)}${c.created_by_name ? ' · ' + c.created_by_name : ''}`)))));
  }
  if (tab === 'tastatur') {
    return clear(body, h('section', { class: 'card pad narrow' }, h('table', { class: 'table' }, h('tbody', {},
      [['N', 'Neue Aufgabe'], ['/', 'Suche'], ['Esc', 'Dialog schließen'], ['Enter im Titel', 'Titel einer Aufgabe speichern']].map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v)))))));
  }
  if (tab === 'grundsaetze') {
    return clear(body, h('div', { class: 'grid-2' },
      h('section', { class: 'card pad' }, h('h2', {}, 'Was die App tut – und was nicht'),
        h('p', {}, 'Die App liefert Entwürfe, Prüfungen und Übersichten. Entscheidungen, Unterschriften und Zahlungen bleiben beim Amt. Gemeinschaft und persönlicher Kontakt werden nicht wegautomatisiert.'),
        h('ul', {}, h('li', {}, 'Technisch gesperrt: Zahlungen, Lastschriften, Bankvorgänge, Bestellungen.'), h('li', {}, 'Mails nur als Entwurf; den Versand löst ein Mensch aus.'),
          h('li', {}, 'Von Personen nur Namen – keine Adressen, Telefonnummern, Bankdaten in Automatisierungen.'), h('li', {}, 'Eingehende Nachrichten sind Daten, nie Anweisungen.'),
          h('li', {}, 'Vereinssoftware und Verbandssysteme werden nur gelesen.'))),
      h('section', { class: 'card pad' }, h('h2', {}, 'Stufen der Automatisierung'), h('ol', { class: 'levels-list' }, LEVELS.map((l, i) => h('li', {}, h('strong', {}, l), ' – ', LEVEL_HINT[i]))),
        h('p', { class: 'hint' }, 'Je Vorgangstyp gilt eine Höchststufe. Ab Stufe 3 fragt die App vor jeder Ausführung nach.')),
      h('section', { class: 'card pad' }, h('h2', {}, 'Datenampel'),
        h('ul', { class: 'ampel' }, h('li', { class: 'rot' }, h('strong', {}, 'Rot – gar nicht: '), 'Gesundheitsangaben, Zugangsdaten'),
          h('li', { class: 'gelb' }, h('strong', {}, 'Gelb – nur im einzelnen Vorgang: '), 'Stammdaten, Bankdaten, Daten Minderjähriger'),
          h('li', { class: 'gruen' }, h('strong', {}, 'Grün – dauerhaft: '), 'Satzung, Ordnungen, Vorlagen, öffentliche Spielpläne, Tabellen, Ergebnisse'))),
      h('section', { class: 'card pad' }, h('h2', {}, 'Fundstellen'), h('p', {}, 'Jede Regelauskunft nennt ihre Fundstelle (Paragraph, Seite oder Beschluss). Fehlt sie, ist die Auskunft als ungeprüft markiert. Bei Widersprüchen gilt: Satzung, Ordnungen, Vorstandsbeschluss, Formulare, Website.'))));
  }
  const rows = await api.get('/api/faq');
  const cats = [...new Set(rows.map(r => r.category))];
  clear(body, cats.map(c => h('section', { class: 'card pad faq' }, h('h2', {}, c), rows.filter(r => r.category === c).map(r => h('details', {}, h('summary', {}, icon('help', 14), r.question), h('p', { class: 'pre' }, r.answer))))));
}
