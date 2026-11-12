// Zugriff auf die Server-Schnittstelle. Alle Aufrufe senden den Herkunfts-Header (Schutz vor Cross-Site-Anfragen).

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || `Fehler ${status}`);
    this.status = status;
    this.data = data || {};
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

async function request(method, url, body, opts = {}) {
  const headers = { 'X-Requested-With': 'tte', ...(opts.headers || {}) };
  let payload;
  if (body instanceof Blob || body instanceof ArrayBuffer) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  if (res.status === 204) return null;
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/')) onUnauthorized();
    throw new ApiError(res.status, typeof data === 'string' ? { error: data } : data);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
  upload: (url, file, meta) => request('POST', url, file, {
    headers: { 'X-File-Meta': encodeURIComponent(JSON.stringify(meta)), 'Content-Type': file.type || 'application/octet-stream' },
  }),
  raw: (url, blob) => request('POST', url, blob, { headers: { 'Content-Type': 'application/octet-stream' } }),
};

/** Baut einen Query-String aus einem Objekt; leere Werte werden weggelassen. */
export function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}
