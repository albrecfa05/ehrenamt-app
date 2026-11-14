// Startet die App mit einem frischen, temporären Datenverzeichnis auf einem freien Port.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function startApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tte-test-'));
  process.env.DATA_DIR = dir;
  process.env.DISABLE_SCHEDULER = '1';
  const { config } = await import('../server/config.js');
  // Schutz: Tests dürfen nie mit dem echten Datenordner laufen (z. B. wenn die Konfiguration zu früh geladen wurde)
  if (!path.resolve(config.dataDir).startsWith(path.resolve(os.tmpdir()))) throw new Error(`Test würde den Datenordner ${config.dataDir} benutzen – DATA_DIR vor dem ersten Import setzen.`);
  const { createServer } = await import('../server/index.js');
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, dir,
    async close() { await new Promise(r => server.close(r)); },
    client() { return new Client(base); },
  };
}

export class Client {
  constructor(base) { this.base = base; this.cookie = ''; }
  async req(method, url, body, { raw = false, headers = {} } = {}) {
    const res = await fetch(this.base + url, {
      method,
      headers: {
        'X-Requested-With': 'tte',
        ...(raw ? {} : { 'Content-Type': 'application/json' }),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  }
  get(u) { return this.req('GET', u); }
  post(u, b = {}) { return this.req('POST', u, b); }
  put(u, b = {}) { return this.req('PUT', u, b); }
  del(u) { return this.req('DELETE', u); }
}

export const STRONG_PW = 'Kelle-Schupf-2026!';
