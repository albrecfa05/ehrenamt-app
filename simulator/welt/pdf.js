// Kleiner PDF-Erzeuger ohne Pakete: Text in Helvetica, Linien, Kästchen, automatische Seitenumbrüche.
// Genug für Formulare (Mitgliedsantrag), Satzung, Protokolle und Rechnungen der Vereinswelt.

const W = 595, H = 842, M = 56; // A4 in Punkt, Rand

// WinAnsi: Latin-1 plus die wichtigsten typografischen Zeichen
const MAP = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97 };
function enc(s) {
  const out = [];
  for (const ch of String(s)) {
    const c = MAP[ch] ?? ch.codePointAt(0);
    const b = c <= 0xff ? c : 0x3f;
    if (b === 0x28 || b === 0x29 || b === 0x5c) out.push(0x5c);
    out.push(b);
  }
  return Buffer.from(out).toString('latin1');
}

// Zeichenbreiten Helvetica (1/1000 em) – grob, reicht für den Zeilenumbruch
const narrow = 'iljtfrI.,;:!|\'"() ';
const wide = 'mwMWÄÖÜ@%';
const widthOf = (s, size, bold) => [...s].reduce((w, ch) => w + (narrow.includes(ch) ? 280 : wide.includes(ch) ? 830 : /[A-ZÄÖÜ0-9]/.test(ch) ? 640 : 520), 0) * size / 1000 * (bold ? 1.06 : 1);

function wrap(text, size, bold, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const cand = line ? `${line} ${word}` : word;
      if (widthOf(cand, size, bold) > maxW && line) { lines.push(line); line = word; } else line = cand;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Baut ein PDF. blocks: Liste von
 *   { text, size?, bold?, gap? }        Absatz (wird umbrochen)
 *   { field: 'Name', value: 'Lea' }    Formularfeld mit Linie
 *   { check: 'Text', on: true }        Ankreuzfeld
 *   { rule: true }                     Trennlinie
 *   { space: 12 }                      Abstand
 *   { page: true }                     neue Seite
 */
export function makePdf(blocks, { title = 'Dokument' } = {}) {
  const pages = [];
  let ops = [];
  let y = H - M;
  const newPage = () => { if (ops.length) pages.push(ops.join('\n')); ops = []; y = H - M; };
  const need = (h) => { if (y - h < M) newPage(); };
  const text = (x, yy, s, size, bold) => ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${enc(s)}) Tj ET`);
  const line = (x1, y1, x2, y2, w = 0.6) => ops.push(`${w} w ${x1} ${y1} m ${x2} ${y2} l S`);

  for (const b of blocks) {
    if (b.page) { newPage(); continue; }
    if (b.space) { y -= b.space; continue; }
    if (b.rule) { need(10); y -= 4; line(M, y, W - M, y, 0.8); y -= 8; continue; }
    if (b.field !== undefined) {
      need(26);
      y -= 18;
      text(M, y, b.field, 8, false);
      const vx = M + 150;
      if (b.value) text(vx, y, b.value, 11, false);
      line(vx - 4, y - 3, W - M, y - 3, 0.5);
      y -= 6;
      continue;
    }
    if (b.check !== undefined) {
      need(18);
      y -= 15;
      ops.push(`0.7 w ${M} ${y - 2} 9 9 re S`);
      if (b.on) text(M + 1.2, y - 0.5, 'X', 9, true);
      text(M + 16, y, b.check, 10, false);
      continue;
    }
    const size = b.size || 10.5, bold = !!b.bold;
    const lh = size * 1.35;
    y -= b.gap ?? 4;
    for (const l of wrap(b.text, size, bold, W - 2 * M)) {
      need(lh);
      y -= lh;
      text(M, y, l, size, bold);
    }
  }
  newPage();

  // Objekte zusammensetzen
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add('');
  const pagesObj = add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = [];
  pages.forEach((content, i) => {
    const footer = `BT /F1 8 Tf ${M} 28 Td (${enc(`${title} – Seite ${i + 1} von ${pages.length} – Vorstandsarbeit-Simulator (Fantasiedaten)`)}) Tj ET`;
    const stream = `${content}\n${footer}`;
    const c = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title (${enc(title)}) /Producer (Vorstandsarbeit-Simulator) >>`);

  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Ganz einfacher Fließtext (z. B. Satzung): Zeilen „§ …“ werden fett. */
export function textPdf(title, body) {
  const blocks = [{ text: title, size: 16, bold: true, gap: 0 }, { rule: true }];
  for (const para of body.split(/\n{2,}/)) {
    const [first, ...rest] = para.split('\n');
    if (/^(§|\d+\.|[A-ZÄÖÜ][^.]{0,60}$)/.test(first) && rest.length) {
      blocks.push({ text: first, bold: true, size: 11, gap: 10 }, { text: rest.join('\n'), gap: 2 });
    } else blocks.push({ text: para, gap: 8 });
  }
  return makePdf(blocks, { title });
}

/** Minimales JPEG (1×1 Pixel), als Platzhalter für Fotos. */
export function tinyJpeg() {
  return Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
}
