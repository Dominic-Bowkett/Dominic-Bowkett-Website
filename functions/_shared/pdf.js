// Tiny dependency-free PDF writer (A4, Helvetica / Helvetica-Bold, WinAnsi text).
// Enough for invoices: text, right-aligned text, word-wrapped paragraphs, rules, multi-page.

const A4 = { w: 595.28, h: 841.89 };

// Helvetica glyph widths (per 1000 em) for printable ASCII 32..126.
const W = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

export function textWidth(str, size, bold = false) {
  let w = 0;
  for (const ch of String(str)) {
    const c = ch.charCodeAt(0);
    w += c >= 32 && c <= 126 ? W[c - 32] : 556;
  }
  return (w / 1000) * size * (bold ? 1.04 : 1);
}

// Map to WinAnsi: keep ASCII, encode £ and a few Latin-1 marks, replace the rest with '?'.
function pdfString(str) {
  let out = "";
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    if (ch === "\\" || ch === "(" || ch === ")") out += "\\" + ch;
    else if (c >= 32 && c <= 126) out += ch;
    else if (c === 0xa3) out += "\\243"; // £
    else if (c === 0x20ac) out += "\\200"; // €
    else if (c === 0xe9) out += "\\351"; // é
    else if (c === 0x2013 || c === 0x2014) out += "-";
    else if (c === 0x2018 || c === 0x2019) out += "'";
    else if (c === 0x201c || c === 0x201d) out += '"';
    else if (c === 0xa0) out += " ";
    else if (c >= 0xa0 && c <= 0xff) out += "\\" + c.toString(8);
    else out += "?";
  }
  return out;
}

export class PDF {
  constructor({ margin = 48 } = {}) {
    this.margin = margin;
    this.pages = [];
    this.newPage();
  }
  newPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = A4.h - this.margin;
    return this;
  }
  get width() { return A4.w; }
  get contentWidth() { return A4.w - 2 * this.margin; }
  ensure(height) {
    if (this.y - height < this.margin) this.newPage();
  }
  // Draw text with its baseline at absolute y (PDF coordinates, origin bottom-left).
  textAt(x, y, str, { size = 10, bold = false, color = "0 0 0" } = {}) {
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${color} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfString(str)}) Tj ET`);
  }
  textRight(xRight, y, str, opts = {}) {
    this.textAt(xRight - textWidth(str, opts.size || 10, opts.bold), y, str, opts);
  }
  // Flowing text: writes one line at the cursor, then moves down.
  line(str, { size = 10, bold = false, color, x, gap = 4 } = {}) {
    this.ensure(size + gap);
    this.y -= size;
    this.textAt(x ?? this.margin, this.y, str, { size, bold, color });
    this.y -= gap;
    return this;
  }
  wrap(str, maxWidth, size = 10, bold = false) {
    const lines = [];
    for (const para of String(str || "").split(/\r?\n/)) {
      let cur = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const t = cur ? cur + " " + word : word;
        if (textWidth(t, size, bold) <= maxWidth || !cur) cur = t;
        else { lines.push(cur); cur = word; }
      }
      lines.push(cur);
    }
    return lines;
  }
  paragraph(str, { size = 10, bold = false, color, x, maxWidth, gap = 3 } = {}) {
    const left = x ?? this.margin;
    const mw = maxWidth ?? A4.w - this.margin - left;
    for (const l of this.wrap(str, mw, size, bold)) this.line(l, { size, bold, color, x: left, gap });
    return this;
  }
  space(h) { this.y -= h; return this; }
  rule({ color = "0.886 0.875 0.847", width = 0.75, x1, x2, y } = {}) {
    const yy = y ?? this.y;
    this.ops.push(`${color} RG ${width} w ${(x1 ?? this.margin).toFixed(2)} ${yy.toFixed(2)} m ${(x2 ?? A4.w - this.margin).toFixed(2)} ${yy.toFixed(2)} l S`);
    return this;
  }
  rect(x, y, w, h, fill = "0.98 0.98 0.973") {
    this.ops.push(`${fill} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    return this;
  }

  build() {
    const objs = [];
    const add = (s) => { objs.push(s); return objs.length; };
    const fontN = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const fontB = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const pagesIdx = add(""); // placeholder, filled later
    const pageIds = [];
    for (const ops of this.pages) {
      const content = ops.join("\n");
      // Content is pure ASCII (non-ASCII is octal-escaped in pdfString), so length == byte length.
      const cid = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      const pid = add(
        `<< /Type /Page /Parent ${pagesIdx} 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] ` +
          `/Resources << /Font << /F1 ${fontN} 0 R /F2 ${fontB} 0 R >> >> /Contents ${cid} 0 R >>`
      );
      pageIds.push(pid);
    }
    objs[pagesIdx - 1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
    const catalog = add(`<< /Type /Catalog /Pages ${pagesIdx} 0 R >>`);

    let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
    const offsets = [];
    objs.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    // Byte offsets above assume one byte per char: everything we emit is Latin-1.
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }
}
