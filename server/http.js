// Schlanker HTTP-Rahmen ohne externe Pakete: Routing, JSON, Dateien, Fehlerbehandlung.

import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './util.js';
import { userFromRequest } from './auth.js';
import { config } from './config.js';

const routes = [];

/**
 * Registriert eine Route.
 * @param {string} method  GET, POST, PUT, DELETE
 * @param {string} pattern z. B. "/api/tasks/:id"
 * @param {Function} handler (ctx) => Antwortobjekt | undefined
 * @param {object} opts { auth: 'public'|'user'|'admin', raw: true für Rohdaten im Body }
 */
export function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, auth: opts.auth || 'user', raw: !!opts.raw });
}

export const get = (p, h, o) => route('GET', p, h, o);
export const post = (p, h, o) => route('POST', p, h, o);
export const put = (p, h, o) => route('PUT', p, h, o);
export const del = (p, h, o) => route('DELETE', p, h, o);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

export function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body) || typeof body === 'string';
  const payload = isBuf ? body : JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': isBuf ? (headers['Content-Type'] || 'text/plain; charset=utf-8') : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, `Die Datei ist zu groß (höchstens ${Math.round(limit / 1024 / 1024)} MB).`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html'; // SPA: alle Seiten laden index.html
  const file = path.normalize(path.join(config.publicDir, rel));
  if (!file.startsWith(config.publicDir)) return send(res, 403, 'Verboten');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Nicht gefunden');
    // Immer neu prüfen lassen (no-cache), unveränderte Dateien kommen per 304 aus dem Browser-Cache.
    // So sehen alle nach einem Update sofort den neuen Stand.
    const lastModified = st.mtime.toUTCString();
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Last-Modified': lastModified };
    const since = req.headers['if-modified-since'];
    if (since && Math.floor(st.mtimeMs / 1000) <= Math.floor(Date.parse(since) / 1000)) {
      res.writeHead(304, { ...SECURITY_HEADERS, ...headers });
      return res.end();
    }
    fs.readFile(file, (err2, data) => {
      if (err2) return send(res, 404, 'Nicht gefunden');
      send(res, 200, data, headers);
    });
  });
}

export async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const method = req.method === 'HEAD' ? 'GET' : req.method;

  if (!url.pathname.startsWith('/api/')) {
    if (method !== 'GET') return send(res, 405, 'Nicht erlaubt');
    return serveStatic(req, res, url.pathname);
  }

  let match = null;
  let params = {};
  let pathMatched = false;
  for (const r of routes) {
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    match = r;
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    break;
  }
  try {
    if (!match) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Methode nicht erlaubt.' : 'Unbekannte Schnittstelle.');

    // Schutz vor Cross-Site-Anfragen: Schreibende Aufrufe brauchen den eigenen Header
    // (zusätzlich zum SameSite=Strict-Cookie).
    if (method !== 'GET' && req.headers['x-requested-with'] !== 'tte') {
      throw new HttpError(403, 'Anfrage ohne gültige Herkunft abgelehnt.');
    }

    const user = userFromRequest(req);
    if (match.auth !== 'public' && !user) throw new HttpError(401, 'Bitte anmelden.');
    if (match.auth === 'admin' && user.role !== 'admin') throw new HttpError(403, 'Nur Admins dürfen das.');
    if (match.auth !== 'public' && user.must_change_pw && !url.pathname.startsWith('/api/auth/') && url.pathname !== '/api/me') {
      throw new HttpError(403, 'Bitte zuerst ein eigenes Passwort festlegen.', { mustChangePassword: true });
    }

    let body = {};
    if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
      const buf = await readBody(req, match.raw ? config.maxUploadBytes : 2 * 1024 * 1024);
      if (match.raw) body = buf;
      else if (buf.length) {
        try { body = JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'Ungültige Daten (kein JSON).'); }
      }
    }

    const ctx = { req, res, url, params, query: Object.fromEntries(url.searchParams), body, user, headers: req.headers };
    const result = await match.handler(ctx);
    if (res.writableEnded) return;
    if (result === undefined) return send(res, 204, '');
    if (result && result.__file) {
      return send(res, 200, result.data, {
        'Content-Type': result.mime,
        'Content-Disposition': `${result.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
      });
    }
    send(res, 200, result);
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message, ...err.extra });
    if (/UNIQUE constraint failed/.test(err.message)) return send(res, 409, { error: 'Ein Eintrag mit diesem Namen existiert bereits.' });
    if (/Das Protokoll ist unveränderlich/.test(err.message)) return send(res, 409, { error: 'Das Protokoll ist unveränderlich.' });
    console.error(`[Fehler] ${method} ${url.pathname}:`, err);
    send(res, 500, { error: 'Interner Fehler. Details stehen im Server-Log.' });
  }
}

export function fileResponse(data, filename, mime, inline = false) {
  return { __file: true, data, filename, mime, inline };
}
