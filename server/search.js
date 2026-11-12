// Einfache Volltextsuche für Deutsch (Wissensbasis, Ablage, Aufgaben).
// Normalisiert Umlaute, entfernt Füllwörter, kürzt Endungen und gewichtet nach BM25.

const STOP = new Set(('der die das den dem des ein eine einer eines einem einen und oder aber wie was wer wann wo warum ' +
  'ist sind war waren wird werden wurde wurden hat haben hatte kann können koennen muss müssen muessen darf dürfen duerfen soll sollen ' +
  'ich du er sie es wir ihr man mich mir uns euch sich mit von zu zum zur im in am an auf aus bei für fuer über ueber unter ' +
  'nach vor bis um als auch nicht noch nur schon so dann denn ob wenn dass da hier dort welche welcher welches gibt es ' +
  'bitte mal gilt gelten').split(' '));

export function normalize(s) {
  return String(s || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/§/g, ' paragraph ');
}

function stem(w) {
  // Sehr leichte Stammformbildung, reicht für Satzungen und Ordnungen
  for (const suf of ['ungen', 'ung', 'heiten', 'heit', 'keiten', 'keit', 'lichen', 'liche', 'lich', 'innen', 'ern', 'en', 'er', 'es', 'e', 'n', 's']) {
    if (w.length - suf.length >= 4 && w.endsWith(suf)) return w.slice(0, -suf.length);
  }
  return w;
}

export function tokens(s) {
  return normalize(s).split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w)).map(stem);
}

/**
 * Durchsucht Dokumente.
 * @param {Array<{id:any, text:string, boost?:number}>} docs
 * @param {string} query
 * @returns {Array<{id, score, matched:string[]}>} absteigend nach Treffergüte
 */
export function rank(docs, query, { limit = 10 } = {}) {
  const qTokens = [...new Set(tokens(query))];
  if (!qTokens.length) return [];
  const prepared = docs.map(d => {
    const t = tokens(d.text);
    const tf = new Map();
    for (const w of t) tf.set(w, (tf.get(w) || 0) + 1);
    return { d, tf, len: t.length || 1 };
  });
  const N = prepared.length || 1;
  const avg = prepared.reduce((a, p) => a + p.len, 0) / N;
  const df = new Map(qTokens.map(w => [w, prepared.filter(p => hasPrefix(p.tf, w)).length]));
  const k1 = 1.4, b = 0.75;
  const out = [];
  for (const p of prepared) {
    let score = 0;
    const matched = [];
    for (const w of qTokens) {
      const f = prefixCount(p.tf, w);
      if (!f) continue;
      matched.push(w);
      const idf = Math.log(1 + (N - df.get(w) + 0.5) / (df.get(w) + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * p.len / avg));
    }
    if (!score) continue;
    // Abdeckung belohnen: Treffer auf mehrere Suchwörter zählen mehr
    score *= 0.5 + matched.length / qTokens.length;
    score *= p.d.boost || 1;
    out.push({ id: p.d.id, score: Math.round(score * 1000) / 1000, matched });
  }
  return out.sort((a, b2) => b2.score - a.score).slice(0, limit);
}

// Präfix-Treffer erlauben (z. B. „mitgliedsbeitrag“ findet „mitgliedsbeitraeg“)
function prefixCount(tf, w) {
  let n = tf.get(w) || 0;
  if (w.length >= 5) for (const [k, v] of tf) if (k !== w && k.startsWith(w)) n += v * 0.7;
  return n;
}
function hasPrefix(tf, w) { return prefixCount(tf, w) > 0; }

/** Kurzer Textausschnitt rund um den ersten Treffer. */
export function snippet(text, query, len = 260) {
  const t = String(text || '');
  // Positionen im Originaltext suchen (gleiche Länge wie das Original, daher nur toLowerCase)
  const lower = t.toLowerCase();
  const words = String(query).toLowerCase().split(/[^\p{L}\d]+/u).filter(w => w.length > 2 && !STOP.has(normalize(w)));
  let pos = -1;
  for (const w of words) { const i = lower.indexOf(w.slice(0, Math.max(4, w.length - 2))); if (i >= 0 && (pos < 0 || i < pos)) pos = i; }
  if (pos < 0) return t.slice(0, len) + (t.length > len ? ' …' : '');
  const start = Math.max(0, pos - Math.floor(len / 3));
  return (start > 0 ? '… ' : '') + t.slice(start, start + len).trim() + (start + len < t.length ? ' …' : '');
}
