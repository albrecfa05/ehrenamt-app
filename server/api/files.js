// Gemeinsame Ablage (ABL-1, ABL-2, DAT-1, DAT-6).
// Dateien liegen unter data/ablage/<bereich>/<jahr>/ mit einheitlichem Namen
// „JJJJ-MM-TT - Aussteller - Anlass.ext“. Rote Daten werden abgewiesen.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { del, fileResponse, get, post, put } from '../http.js';
import { q } from '../db.js';
import { config } from '../config.js';
import { areaClause, assertArea, canSeeArea, isAdmin, loadTask } from '../access.js';
import { assertDataClass } from '../guards.js';
import { rank, snippet } from '../search.js';
import { touch } from '../services/tasks.js';
import { audit, bad, dateOrNull, forbidden, int, notFound, nowIso, str, today } from '../util.js';

import { cleanName, standardName, storeFile } from '../services/files.js';
import { isOn, param } from '../services/catalog.js';
import { requestApproval } from '../services/automation.js';
export { standardName };

post('/api/files/suggest-name', ({ body }) => ({ filename: standardName(body) }));

// Upload: Rohdaten im Body, Metadaten im Header X-File-Meta (URL-kodiertes JSON)
post('/api/files', ({ user, body, headers }) => {
  let meta;
  try { meta = JSON.parse(decodeURIComponent(headers['x-file-meta'] || '')); } catch { throw bad('Angaben zur Datei fehlen.'); }
  const areaId = int(meta.area_id, { nullable: false, name: 'Bereich' });
  assertArea(user, areaId);
  const dataClass = assertDataClass(meta.data_class);
  if (!String(meta.original_name || '').trim()) throw bad('Dateiname fehlt.');
  let taskId = int(meta.task_id);
  if (taskId) {
    const t = loadTask(user, taskId);
    if (t.area_id !== areaId) throw bad('Die Aufgabe gehört zu einem anderen Bereich.');
  }
  const docDate = dateOrNull(meta.doc_date, 'Belegdatum') || today();
  const result = storeFile(user, {
    areaId, taskId, buffer: body, originalName: meta.original_name, mime: meta.mime, dataClass, docDate,
    issuer: str(meta.issuer, { max: 120 }), occasion: str(meta.occasion, { max: 160 }), tags: str(meta.tags, { max: 300 }), filename: meta.filename || null,
  });
  // Automatisierung „Ablage nach SharePoint/OneDrive kopieren“ (Stufe 3): Kopie nur nach Freigabe
  if (isOn('ablage_spiegeln') && (dataClass === 'gruen' || !param('ablage_spiegeln', 'nur_gruen'))) {
    requestMirror(user, q.get('SELECT * FROM files WHERE id = ?', result.id));
  }
  return result;
}, { raw: true });

get('/api/files', ({ user, query }) => {
  const ac = areaClause(user, 'f.area_id');
  const where = [ac.sql, 'f.deleted_at IS NULL'];
  const params = [...ac.params];
  if (query.area) { where.push('f.area_id = ?'); params.push(int(query.area)); }
  if (query.task) { where.push('f.task_id = ?'); params.push(int(query.task)); }
  if (query.data_class) { where.push('f.data_class = ?'); params.push(query.data_class === 'gelb' ? 'gelb' : 'gruen'); }
  if (query.year) { where.push('substr(f.doc_date,1,4) = ?'); params.push(String(int(query.year))); }
  const rows = q.all(`SELECT f.id, f.area_id, f.task_id, f.filename, f.original_name, f.mime, f.size, f.doc_date, f.issuer, f.occasion, f.tags,
                        f.data_class, f.created_at, f.text_content, f.remote_url, a.name AS area_name, a.color AS area_color, t.title AS task_title, u.name AS uploaded_by_name
                      FROM files f JOIN areas a ON a.id = f.area_id LEFT JOIN tasks t ON t.id = f.task_id LEFT JOIN users u ON u.id = f.uploaded_by
                      WHERE ${where.join(' AND ')} ORDER BY f.doc_date DESC, f.id DESC LIMIT 2000`, ...params);
  if (query.q) {
    const hits = rank(rows.map(r => ({ id: r.id, text: `${r.filename} ${r.filename} ${r.issuer} ${r.occasion} ${r.tags} ${r.task_title || ''} ${r.original_name} ${r.text_content}` })), query.q, { limit: 200 });
    const byId = new Map(rows.map(r => [r.id, r]));
    return hits.map(h => {
      const r = byId.get(h.id);
      return { ...r, text_content: undefined, snippet: r.text_content ? snippet(r.text_content, query.q, 180) : '', score: h.score };
    });
  }
  return rows.map(r => ({ ...r, text_content: undefined }));
});

function loadFile(user, id) {
  const f = q.get('SELECT * FROM files WHERE id = ? AND deleted_at IS NULL', id);
  if (!f || !canSeeArea(user, f.area_id)) throw notFound('Datei nicht gefunden.');
  return f;
}

get('/api/files/:id/download', ({ user, params, query }) => {
  const f = loadFile(user, int(params.id));
  const full = path.join(config.uploadDir, f.stored_path);
  if (!fs.existsSync(full)) throw notFound('Die Datei fehlt im Speicher.');
  const inlineOk = query.inline === '1' && /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)/.test(f.mime);
  return fileResponse(fs.readFileSync(full), f.filename, inlineOk ? f.mime : 'application/octet-stream', inlineOk);
});

put('/api/files/:id', ({ user, params, body }) => {
  const f = loadFile(user, int(params.id));
  if (!isAdmin(user) && f.uploaded_by !== user.id) throw forbidden('Nur die hochladende Person oder ein Admin ändert die Datei.');
  const d = {
    doc_date: body.doc_date !== undefined ? dateOrNull(body.doc_date) : f.doc_date,
    issuer: body.issuer !== undefined ? str(body.issuer, { max: 120 }) : f.issuer,
    occasion: body.occasion !== undefined ? str(body.occasion, { max: 160 }) : f.occasion,
    tags: body.tags !== undefined ? str(body.tags, { max: 300 }) : f.tags,
    data_class: body.data_class !== undefined ? assertDataClass(body.data_class) : f.data_class,
    task_id: body.task_id !== undefined ? int(body.task_id) : f.task_id,
  };
  if (d.task_id) {
    const t = loadTask(user, d.task_id);
    if (t.area_id !== f.area_id) throw bad('Die Aufgabe gehört zu einem anderen Bereich.');
  }
  const filename = body.rename ? standardName({ ...d, original_name: f.original_name }) : (body.filename ? cleanName(body.filename).slice(0, 200) : f.filename);
  q.run('UPDATE files SET doc_date = ?, issuer = ?, occasion = ?, tags = ?, data_class = ?, task_id = ?, filename = ? WHERE id = ?',
    d.doc_date, d.issuer, d.occasion, d.tags, d.data_class, d.task_id, filename, f.id);
  audit(user, { entity: 'file', entityId: f.id, areaId: f.area_id, action: 'geändert', summary: `Datei „${f.filename}“ geändert${filename !== f.filename ? ` → „${filename}“` : ''}` });
  return { ok: true, filename };
});

// Löschen entfernt die Datei aus dem Speicher; der Protokolleintrag bleibt
del('/api/files/:id', ({ user, params }) => {
  const f = loadFile(user, int(params.id));
  if (!isAdmin(user) && f.uploaded_by !== user.id) throw forbidden('Nur die hochladende Person oder ein Admin löscht die Datei.');
  try { fs.rmSync(path.join(config.uploadDir, f.stored_path), { force: true }); } catch { /* bereits entfernt */ }
  q.run(`UPDATE files SET deleted_at = ?, text_content = '' WHERE id = ?`, nowIso(), f.id);
  audit(user, { entity: f.task_id ? 'task' : 'file', entityId: f.task_id || f.id, areaId: f.area_id, action: 'datei_geloescht', summary: `Datei „${f.filename}“ gelöscht` });
});

// ---------- Kopie nach SharePoint/OneDrive (Stufe 3, nur nach Freigabe) ----------

export function requestMirror(user, f) {
  const area = q.get('SELECT name FROM areas WHERE id = ?', f.area_id);
  const pathRel = `${area.name}/${(f.doc_date || today()).slice(0, 4)}/${f.filename}`;
  return requestApproval({ actionType: 'ablage_hochladen', payload: { kind: 'ablage_hochladen', area_id: f.area_id, file_id: f.id, path: pathRel },
    summary: `Datei „${f.filename}“ nach SharePoint/OneDrive kopieren (${pathRel})`, taskId: f.task_id, user });
}

post('/api/files/:id/mirror', ({ user, params }) => {
  const f = loadFile(user, int(params.id));
  if (!isOn('ablage_spiegeln')) throw bad('Die Automatisierung „Ablage nach SharePoint/OneDrive kopieren“ ist nicht eingeschaltet oder Microsoft 365 ist nicht verbunden.');
  if (f.remote_url) throw bad('Die Datei liegt bereits in der Vereinsablage.');
  return { approvalId: requestMirror(user, f) };
});
