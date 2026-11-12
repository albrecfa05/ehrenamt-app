// Auskunftsbereich (VOR-11, AUT-11, NFA-11): Antworten nur aus hinterlegten Dokumenten,
// immer mit Fundstelle. Ohne Fundstelle ist die Auskunft als ungeprüft markiert.
// Bei Widersprüchen gilt die Rangfolge Satzung > Ordnungen > Vorstandsbeschluss > Formulare > Website.
// In die Wissensbasis kommen nur grüne Daten (DAT-2).

import { del, get, post, put } from '../http.js';
import { q, tx } from '../db.js';
import { areaClause, canSeeArea, requireAdmin } from '../access.js';
import { assertKnowledgeSafe } from '../guards.js';
import { rank, snippet } from '../search.js';
import { audit, bad, int, notFound, nowIso, oneOf, parseJson, str } from '../util.js';
import { newVersion } from './templates.js';

export const SOURCE_RANK = { satzung: 1, ordnung: 2, beschluss: 3, formular: 4, website: 5, sonstiges: 6 };
export const SOURCE_LABEL = { satzung: 'Satzung', ordnung: 'Ordnung', beschluss: 'Vorstandsbeschluss', formular: 'Formular', website: 'Website', sonstiges: 'Sonstiges' };

/**
 * Zerlegt einen eingefügten Text in Abschnitte. Erkennt Überschriften wie
 * „§ 5 Mitgliedschaft“, „## Abschnitt“, „5.2 Frist“ oder „Seite 3“.
 */
export function splitSections(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let cur = null;
  let page = null;
  const push = () => { if (cur && cur.body.trim()) sections.push({ ...cur, body: cur.body.trim() }); };
  for (const line of lines) {
    const pageM = line.match(/^\s*(?:-+\s*)?Seite\s+(\d+)\s*(?:-+)?\s*$/i);
    if (pageM) { page = pageM[1]; continue; }
    const para = line.match(/^\s*(§\s*\d+[a-z]?)\s*(.*)$/);
    const md = line.match(/^\s*#{1,4}\s+(.+)$/);
    const num = line.match(/^\s*((?:\d+\.){1,3}\d*)\s+([A-ZÄÖÜ].{2,80})$/);
    if (para || md || num) {
      push();
      const ref = para ? para[1].replace(/\s+/, ' ') : num ? num[1].replace(/\.$/, '') : md[1].match(/^(§\s*\d+[a-z]?|(?:\d+\.)*\d+)/)?.[0] || md[1].slice(0, 60);
      const heading = para ? para[2] : num ? num[2] : md[1];
      cur = { reference: page ? `${ref}, S. ${page}` : ref, heading: heading.trim(), body: '' };
      continue;
    }
    if (!cur) cur = { reference: page ? `S. ${page}` : '', heading: '', body: '' };
    cur.body += line + '\n';
  }
  push();
  return sections.map((s, i) => ({ ...s, pos: i + 1 }));
}

get('/api/kb/documents', ({ user }) => q.all(`SELECT d.*, a.name AS area_name, (SELECT COUNT(*) FROM kb_sections s WHERE s.document_id = d.id) AS sections
    FROM kb_documents d LEFT JOIN areas a ON a.id = d.area_id ORDER BY d.active DESC, d.source_type, d.title`)
  .filter(d => canSeeArea(user, d.area_id)));

get('/api/kb/documents/:id', ({ user, params }) => {
  const d = q.get('SELECT d.*, a.name AS area_name FROM kb_documents d LEFT JOIN areas a ON a.id = d.area_id WHERE d.id = ?', int(params.id));
  if (!d || !canSeeArea(user, d.area_id)) throw notFound();
  const sections = q.all('SELECT * FROM kb_sections WHERE document_id = ? ORDER BY pos', d.id);
  const versions = q.all('SELECT v.id, v.version, v.note, v.created_at, u.name AS created_by_name FROM versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.entity = ? AND v.entity_id = ? ORDER BY v.version DESC', 'kb_document', d.id);
  return { document: d, sections, versions };
});

function cleanDoc(b) {
  const d = {
    title: str(b.title, { required: true, max: 200, name: 'Titel' }),
    source_type: oneOf(b.source_type, Object.keys(SOURCE_RANK), { name: 'Art der Quelle' }),
    area_id: int(b.area_id),
    valid_from: b.valid_from || null,
    notes: str(b.notes, { max: 2000 }),
  };
  let sections = Array.isArray(b.sections) ? b.sections : splitSections(b.text);
  sections = sections.map((s, i) => ({
    pos: i + 1,
    reference: str(s.reference, { max: 120 }),
    heading: str(s.heading, { max: 300 }),
    body: str(s.body, { required: true, max: 50_000, name: `Abschnitt ${i + 1}` }),
    assumption: s.assumption ? 1 : 0,
  }));
  if (!sections.length) throw bad('Das Dokument enthält keinen Text.');
  assertKnowledgeSafe(sections.map(s => `${s.heading}\n${s.body}`).join('\n'));
  return { ...d, sections };
}

function writeSections(docId, sections) {
  q.run('DELETE FROM kb_sections WHERE document_id = ?', docId);
  for (const s of sections) q.run('INSERT INTO kb_sections (document_id, pos, reference, heading, body, assumption) VALUES (?, ?, ?, ?, ?, ?)', docId, s.pos, s.reference, s.heading, s.body, s.assumption);
}

// Nur Admins ändern die Wissensbasis (ROL-2)
post('/api/kb/documents/preview', ({ user, body }) => { requireAdmin(user); return splitSections(body.text); });

post('/api/kb/documents', ({ user, body }) => tx(() => {
  requireAdmin(user);
  const d = cleanDoc(body);
  const now = nowIso();
  const r = q.run('INSERT INTO kb_documents (area_id, title, source_type, valid_from, notes, created_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    d.area_id, d.title, d.source_type, d.valid_from, d.notes, now, user.id, now);
  const id = Number(r.lastInsertRowid);
  writeSections(id, d.sections);
  q.run('INSERT INTO changelog (entity, entity_id, title, note, version, created_at, created_by) VALUES (?, ?, ?, ?, 1, ?, ?)', 'kb_document', id, `Wissensbasis: „${d.title}“ aufgenommen`, `${d.sections.length} Abschnitte`, now, user.id);
  audit(user, { entity: 'kb_document', entityId: id, areaId: d.area_id, action: 'angelegt', summary: `Wissensbasis: „${d.title}“ (${SOURCE_LABEL[d.source_type]}, ${d.sections.length} Abschnitte) aufgenommen` });
  return { id };
}));

put('/api/kb/documents/:id', ({ user, params, body }) => tx(() => {
  requireAdmin(user);
  const doc = q.get('SELECT * FROM kb_documents WHERE id = ?', int(params.id));
  if (!doc) throw notFound();
  if (body.active !== undefined && Object.keys(body).length <= 2) {
    q.run('UPDATE kb_documents SET active = ? WHERE id = ?', body.active ? 1 : 0, doc.id);
    audit(user, { entity: 'kb_document', entityId: doc.id, areaId: doc.area_id, action: body.active ? 'aktiviert' : 'archiviert', summary: `Wissensbasis: „${doc.title}“ ${body.active ? 'aktiviert' : 'archiviert'}` });
    return { ok: true };
  }
  const note = str(body.note, { required: true, max: 1000, name: 'Änderungsnotiz' });
  const d = cleanDoc(body);
  const snapshot = { ...doc, sections: q.all('SELECT * FROM kb_sections WHERE document_id = ? ORDER BY pos', doc.id) };
  const version = newVersion(user, 'kb_document', snapshot, note, `Wissensbasis: „${d.title}“ geändert`);
  q.run('UPDATE kb_documents SET area_id = ?, title = ?, source_type = ?, valid_from = ?, notes = ?, version = ?, updated_at = ? WHERE id = ?',
    d.area_id, d.title, d.source_type, d.valid_from, d.notes, version, nowIso(), doc.id);
  writeSections(doc.id, d.sections);
  audit(user, { entity: 'kb_document', entityId: doc.id, areaId: d.area_id, action: 'version', summary: `Wissensbasis: „${d.title}“ → Version ${version}: ${note}` });
  return { ok: true, version };
}));

// Frage stellen: Treffer mit Fundstelle, sortiert nach Treffergüte und Rangfolge der Quelle
post('/api/kb/ask', ({ user, body }) => {
  const question = str(body.question, { required: true, max: 1000, name: 'Frage' });
  const areaId = int(body.area_id);
  if (areaId && !canSeeArea(user, areaId)) throw bad('Kein Zugriff auf diesen Bereich.');
  const ac = areaClause(user, 'd.area_id');
  const rows = q.all(`SELECT s.*, d.title AS doc_title, d.source_type, d.area_id, d.version AS doc_version, d.valid_from, a.name AS area_name
                      FROM kb_sections s JOIN kb_documents d ON d.id = s.document_id LEFT JOIN areas a ON a.id = d.area_id
                      WHERE d.active = 1 AND (d.area_id IS NULL OR ${ac.sql})${areaId ? ' AND (d.area_id IS NULL OR d.area_id = ?)' : ''}`,
    ...ac.params, ...(areaId ? [areaId] : []));
  // Höherrangige Quellen leicht bevorzugen; Bereichs-Dokumente vor allgemeinen
  const hits = rank(rows.map(r => ({ id: r.id, text: `${r.heading} ${r.heading} ${r.doc_title} ${r.body}`,
    boost: (1.25 - SOURCE_RANK[r.source_type] * 0.04) * (areaId && r.area_id === areaId ? 1.1 : 1) })), question, { limit: 6 });
  const byId = new Map(rows.map(r => [r.id, r]));
  const top = hits.length ? hits[0].score : 0;
  const results = hits.filter(h => h.score >= top * 0.35).map(h => {
    const r = byId.get(h.id);
    const hasRef = !!r.reference && !r.assumption;
    return {
      section_id: r.id, document_id: r.document_id, document: r.doc_title, source_type: r.source_type, source_label: SOURCE_LABEL[r.source_type],
      source_rank: SOURCE_RANK[r.source_type], area: r.area_name || 'alle Bereiche', reference: r.reference, heading: r.heading,
      excerpt: snippet(r.body, question, 420), full: r.body, verified: hasRef, assumption: !!r.assumption, score: h.score,
      citation: hasRef ? `${SOURCE_LABEL[r.source_type]} „${r.doc_title}“ (v${r.doc_version}), ${r.reference}` : null,
    };
  });
  // Widerspruchshinweis: Treffer aus verschiedenen Quellenarten
  const types = [...new Set(results.map(r => r.source_type))];
  const note = types.length > 1 ? `Treffer aus mehreren Quellen. Bei Widersprüchen gilt: ${types.sort((a, b) => SOURCE_RANK[a] - SOURCE_RANK[b]).map(t => SOURCE_LABEL[t]).join(' vor ')}.` : null;
  const verified = results.length > 0 && results[0].verified;
  q.run('INSERT INTO kb_questions (user_id, area_id, question, answer_refs, verified, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    user.id, areaId, question, JSON.stringify(results.map(r => r.citation || `ungeprüft: ${r.document}`)), verified ? 1 : 0, nowIso());
  return { question, results, verified, note, empty: !results.length };
});

get('/api/kb/questions', ({ user }) => q.all(`SELECT k.*, u.name AS user_name FROM kb_questions k LEFT JOIN users u ON u.id = k.user_id ORDER BY k.id DESC LIMIT 100`)
  .filter(k => canSeeArea(user, k.area_id)).map(k => ({ ...k, answer_refs: parseJson(k.answer_refs, []) })));

// ---------- Lernprotokoll (AUT-15) ----------

get('/api/learnings', ({ user }) => q.all(`SELECT l.*, p.name AS template_name, a.name AS area_name, u.name AS created_by_name FROM learnings l
    LEFT JOIN process_templates p ON p.id = l.template_id LEFT JOIN areas a ON a.id = l.area_id LEFT JOIN users u ON u.id = l.created_by
    ORDER BY l.active DESC, l.date DESC, l.id DESC`).filter(l => canSeeArea(user, l.area_id)));

post('/api/learnings', ({ user, body }) => {
  const d = {
    date: body.date || nowIso().slice(0, 10),
    topic: str(body.topic, { required: true, max: 200, name: 'Thema' }),
    rule: str(body.rule, { required: true, max: 2000, name: 'Regel' }),
    origin: str(body.origin, { max: 300 }),
    template_id: int(body.template_id),
    area_id: int(body.area_id),
  };
  const r = q.run('INSERT INTO learnings (date, topic, rule, origin, template_id, area_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    d.date, d.topic, d.rule, d.origin, d.template_id, d.area_id, user.id, nowIso());
  audit(user, { entity: 'learning', entityId: Number(r.lastInsertRowid), areaId: d.area_id, action: 'angelegt', summary: `Lernprotokoll: ${d.topic} – ${d.rule.slice(0, 120)}` });
  return { id: Number(r.lastInsertRowid) };
});

put('/api/learnings/:id', ({ user, params, body }) => {
  requireAdmin(user);
  const l = q.get('SELECT * FROM learnings WHERE id = ?', int(params.id));
  if (!l) throw notFound();
  q.run('UPDATE learnings SET topic = ?, rule = ?, active = ?, template_id = ?, area_id = ? WHERE id = ?',
    str(body.topic ?? l.topic, { required: true, max: 200 }), str(body.rule ?? l.rule, { required: true, max: 2000 }),
    body.active === undefined ? l.active : (body.active ? 1 : 0), body.template_id !== undefined ? int(body.template_id) : l.template_id,
    body.area_id !== undefined ? int(body.area_id) : l.area_id, l.id);
  audit(user, { entity: 'learning', entityId: l.id, areaId: l.area_id, action: 'geändert', summary: `Lernprotokoll-Eintrag „${l.topic}“ geändert` });
  return { ok: true };
});

// ---------- Hilfe und FAQ (NFA-7) ----------

get('/api/faq', () => q.all('SELECT * FROM faq ORDER BY category, pos, id'));

post('/api/faq', ({ user, body }) => {
  requireAdmin(user);
  const r = q.run('INSERT INTO faq (category, question, answer, pos, updated_at) VALUES (?, ?, ?, ?, ?)',
    str(body.category, { max: 80 }) || 'Allgemein', str(body.question, { required: true, max: 300, name: 'Frage' }), str(body.answer, { required: true, max: 10_000, name: 'Antwort' }), int(body.pos) || 0, nowIso());
  audit(user, { entity: 'faq', entityId: Number(r.lastInsertRowid), action: 'angelegt', summary: `FAQ: „${body.question}“ angelegt` });
  return { id: Number(r.lastInsertRowid) };
});

put('/api/faq/:id', ({ user, params, body }) => {
  requireAdmin(user);
  const f = q.get('SELECT * FROM faq WHERE id = ?', int(params.id));
  if (!f) throw notFound();
  q.run('UPDATE faq SET category = ?, question = ?, answer = ?, pos = ?, updated_at = ? WHERE id = ?',
    str(body.category ?? f.category, { max: 80 }), str(body.question ?? f.question, { required: true, max: 300 }), str(body.answer ?? f.answer, { required: true, max: 10_000 }), int(body.pos) ?? f.pos, nowIso(), f.id);
  audit(user, { entity: 'faq', entityId: f.id, action: 'geändert', summary: `FAQ: „${f.question}“ geändert` });
  return { ok: true };
});

del('/api/faq/:id', ({ user, params }) => {
  requireAdmin(user);
  const f = q.get('SELECT * FROM faq WHERE id = ?', int(params.id));
  if (!f) throw notFound();
  q.run('DELETE FROM faq WHERE id = ?', f.id);
  audit(user, { entity: 'faq', entityId: f.id, action: 'geloescht', summary: `FAQ: „${f.question}“ gelöscht` });
});

// ---------- Systemlandkarte (DAT-7) ----------

get('/api/systems', () => q.all('SELECT * FROM systems ORDER BY pos, name'));

post('/api/systems', ({ user, body }) => {
  requireAdmin(user);
  const r = q.run('INSERT INTO systems (name, purpose, leading_data, access, export_path, account, notes, pos) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    str(body.name, { required: true, max: 120, name: 'Name' }), str(body.purpose, { max: 1000 }), str(body.leading_data, { max: 1000 }), str(body.access, { max: 1000 }),
    str(body.export_path, { max: 1000 }), str(body.account, { max: 300 }), str(body.notes, { max: 2000 }), int(body.pos) || 99);
  audit(user, { entity: 'system', entityId: Number(r.lastInsertRowid), action: 'angelegt', summary: `Systemlandkarte: „${body.name}“ ergänzt` });
  return { id: Number(r.lastInsertRowid) };
});

put('/api/systems/:id', ({ user, params, body }) => {
  requireAdmin(user);
  const s = q.get('SELECT * FROM systems WHERE id = ?', int(params.id));
  if (!s) throw notFound();
  const v = (k, max = 1000) => str(body[k] ?? s[k], { max });
  q.run('UPDATE systems SET name = ?, purpose = ?, leading_data = ?, access = ?, export_path = ?, account = ?, notes = ? WHERE id = ?',
    v('name', 120), v('purpose'), v('leading_data'), v('access'), v('export_path'), v('account', 300), v('notes', 2000), s.id);
  audit(user, { entity: 'system', entityId: s.id, action: 'geändert', summary: `Systemlandkarte: „${s.name}“ geändert` });
  return { ok: true };
});

del('/api/systems/:id', ({ user, params }) => {
  requireAdmin(user);
  const s = q.get('SELECT * FROM systems WHERE id = ?', int(params.id));
  if (!s) throw notFound();
  q.run('DELETE FROM systems WHERE id = ?', s.id);
  audit(user, { entity: 'system', entityId: s.id, action: 'geloescht', summary: `Systemlandkarte: „${s.name}“ entfernt` });
});
