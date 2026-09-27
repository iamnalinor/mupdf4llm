/**
 * Builds the public-domain scan fixtures in tests/fixtures/ from page images
 * of the Internet Archive: each page is scaled to 150 dpi, turned to grey and
 * stored as one JPEG on a page of the scan's size (scanned at 300 dpi).
 *
 *   bun scripts/make-scan-fixtures.ts [fixtureName ...]
 */
import { writeFileSync } from "node:fs";
import * as mupdf from "mupdf";

const SCANS: Record<string, { id: string; page: number; note: string }> = {
  // Statistical Abstract relating to British India, HMSO, London, 1901.
  "scan-in-abstract-1901-table.pdf": {
    id: "india.history.resource.108757",
    page: 181,
    note: "an upright table with ruled columns",
  },
  // Statistical abstract of foreign countries, Govt. Printing Office, Washington, 1909.
  "scan-us-abstract-1909-sideways.pdf": {
    id: "cu31924030388791",
    page: 208,
    note: "a table printed across the page: the scan lies on its side",
  },
};

async function make(name: string) {
  const { id, page } = SCANS[name]!;
  const res = await fetch(`https://archive.org/download/${id}/page/n${page}.jpg`);
  if (!res.ok) throw new Error(`${id} n${page}: HTTP ${res.status}`);
  const img = new mupdf.Image(new Uint8Array(await res.arrayBuffer()));
  // Page size of a 300 dpi scan; pixels at 150 dpi.
  const W = (img.getWidth() * 72) / 300;
  const H = (img.getHeight() * 72) / 300;
  const src = new mupdf.PDFDocument();
  const r = src.addObject({ XObject: { Im0: src.addImage(img) } });
  src.insertPage(-1, src.addPage([0, 0, W, H], 0, r, `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q\n`));
  const pix = src
    .loadPage(0)
    .toPixmap(mupdf.Matrix.scale(150 / 72, 150 / 72), mupdf.ColorSpace.DeviceGray, false);
  const doc = new mupdf.PDFDocument();
  const small = doc.addImage(new mupdf.Image(pix.asJPEG(60)));
  const res2 = doc.addObject({ XObject: { Im0: small } });
  doc.insertPage(-1, doc.addPage([0, 0, W, H], 0, res2, `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q\n`));
  writeFileSync(`tests/fixtures/${name}`, doc.saveToBuffer("compress").asUint8Array());
  console.log(`wrote tests/fixtures/${name}`);
}

const only = process.argv.slice(2);
for (const name of Object.keys(SCANS)) if (!only.length || only.includes(name)) await make(name);
