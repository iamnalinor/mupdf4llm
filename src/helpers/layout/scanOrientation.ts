import * as mupdf from "mupdf";
import { PageRaster, grayImage, type OcrEngine, type OcrImage } from "../ocr/engine";
import { removeRotation } from "./pageRotation";

export type InkAxis = "upright" | "sideways" | "unknown";

/** One axis must be this much sharper than the other to decide. */
const AXIS_RATIO = 1.5;

/**
 * Which way the lines of a scanned page run. Text lines and table rows put
 * many ink edges (paper to ink) into the pixel rows they cross and almost
 * none into the gaps between them, so the count of edges per pixel row
 * jumps from line to gap; per pixel column it varies smoothly. The axis
 * whose edge profile is sharper — the larger sum of squared steps between
 * neighbours, relative to the profile's own size — runs across the lines.
 * `"unknown"` when neither is clearly sharper or there is too little ink.
 */
export function inkAxis(raster: PageRaster): InkAxis {
  const { width: w, height: h } = raster;
  const ink = raster.ink;
  const rows = new Float64Array(h);
  const cols = new Float64Array(w);
  let edges = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!ink[i]) continue;
      if (x > 0 && !ink[i - 1]) rows[y]!++;
      if (y > 0 && !ink[i - w]) cols[x]!++;
      edges++;
    }
  }
  if (edges < 1000) return "unknown";
  const sharp = (p: Float64Array) => {
    let d = 0;
    let s = 0;
    for (let i = 1; i < p.length; i++) {
      d += (p[i]! - p[i - 1]!) ** 2;
      s += p[i]! ** 2;
    }
    return s ? d / s : 0;
  };
  const across = sharp(rows);
  const along = sharp(cols);
  if (across >= AXIS_RATIO * along) return "upright";
  if (along >= AXIS_RATIO * across) return "sideways";
  return "unknown";
}

/** Does the page have any text in its text layer? */
export function pageHasText(page: mupdf.Page): boolean {
  const st = page.toStructuredText();
  try {
    return st.asText().trim().length > 0;
  } finally {
    st.destroy();
  }
}

/**
 * How far a page without a text layer must be turned clockwise so that its
 * lines run across: 90 for a sheet scanned sideways, 0 when it is upright or
 * the ink does not tell.
 */
export function scanTurn(page: mupdf.Page): 0 | 90 {
  if (pageHasText(page)) return 0;
  return inkAxis(PageRaster.render(page, 100)) === "sideways" ? 90 : 0;
}

/**
 * Turn page `pno` clockwise by `deg` for good: set /Rotate and bake it into
 * the content with {@link removeRotation}, so text, drawings and the page box
 * all come out upright. Returns the reloaded page.
 */
export function applyQuarterTurn(
  doc: mupdf.PDFDocument,
  pno: number,
  deg: 90 | 180 | 270,
): mupdf.PDFPage {
  const page = doc.loadPage(pno) as mupdf.PDFPage;
  page.getObject().put("Rotate", deg);
  removeRotation(doc, page);
  return doc.loadPage(pno) as mupdf.PDFPage;
}

/** Letters of the common alphabets: Latin (with Latin-1 and Extended-A), Greek, Cyrillic. */
const LETTER = /[A-Za-zÀ-ÖØ-öø-ſͰ-ϿЀ-ӿ]/u;

/**
 * How much of `text` reads as words and numbers, from -0.5 to 1: the share
 * of characters in runs of two or more letters of the common alphabets or
 * in numbers ("12,50"), less half the share of all other characters. Text
 * read off an upside-down line is mostly lone marks, punctuation and
 * look-alike symbols ("uoᴉʇɐlndod"), and scores low. Empty text scores 0.
 */
export function textPlausibility(text: string): number {
  let score = 0;
  let total = 0;
  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    let good = 0;
    for (const m of token.matchAll(/\d+(?:[.,]\d+)*/gu)) good += m[0].length;
    let run = 0;
    const flush = () => {
      if (run >= 2) good += run;
      run = 0;
    };
    for (const ch of token) {
      if (LETTER.test(ch)) run++;
      else flush();
    }
    flush();
    const n = [...token].length;
    score += good - 0.5 * (n - good);
    total += n;
  }
  return total ? score / total : 0;
}

/** The upside-down reading must win by this factor to turn the page. */
const FLIP_MARGIN = 1.2;
/** Lines recognised to decide. */
const SAMPLE_LINES = 4;

/**
 * Is the page upside down? The longest lines of text are recognised as
 * they are and turned by 180°; the page is upside down when the turned
 * readings are clearly more {@link textPlausibility plausible}. An engine
 * error or a tie keeps the page as it is.
 */
export async function upsideDown(raster: PageRaster, engine: OcrEngine): Promise<boolean> {
  const lines = sampleLines(raster);
  if (!lines.length) return false;
  let asIs = 0;
  let turned = 0;
  try {
    for (const img of lines) {
      asIs += textPlausibility(await engine.recognize(img));
      turned += textPlausibility(await engine.recognize(rotate180(img)));
    }
  } catch {
    return false;
  }
  return turned > 0 && turned > FLIP_MARGIN * Math.max(0, asIs);
}

/**
 * Crops of the widest pieces of text lines: runs of inked pixel rows of a
 * text line's height, split where a gap wider than the line is blank.
 * Rules (mostly ink) are left out.
 */
function sampleLines(raster: PageRaster): OcrImage[] {
  const { width: w, height: h, scale } = raster;
  const ink = raster.ink;
  const minH = Math.max(4, Math.round(4 * scale));
  const maxH = Math.round(40 * scale);
  const rowInk = new Uint32Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rowInk[y]! += ink[y * w + x]!;
  const found: { box: [number, number, number, number]; width: number }[] = [];
  for (let y = 0; y < h; ) {
    if (!rowInk[y]) {
      y++;
      continue;
    }
    const y0 = y;
    while (y < h && rowInk[y]) y++;
    const y1 = y;
    const lh = y1 - y0;
    if (lh < minH || lh > maxH) continue;
    // Pieces of the line, split at blank gaps wider than the line height.
    let x0 = -1;
    let last = -1;
    const flush = () => {
      if (x0 < 0) return;
      const pw = last - x0 + 1;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) for (let x = x0; x <= last; x++) n += ink[yy * w + x]!;
      if (pw >= 3 * lh && n < 0.5 * pw * lh) found.push({ box: [x0, y0, last + 1, y1], width: pw });
      x0 = -1;
    };
    for (let x = 0; x < w; x++) {
      let any = false;
      for (let yy = y0; yy < y1 && !any; yy++) any = ink[yy * w + x] === 1;
      if (!any) continue;
      if (x0 >= 0 && x - last - 1 > lh) flush();
      if (x0 < 0) x0 = x;
      last = x;
    }
    flush();
  }
  return found
    .sort((a, b) => b.width - a.width)
    .slice(0, SAMPLE_LINES)
    .map(({ box: [x0, y0, x1, y1] }) => {
      const pad = y1 - y0;
      const cw = x1 - x0 + 2 * pad;
      const ch = y1 - y0 + 2 * pad;
      const data = new Uint8Array(cw * ch).fill(255);
      for (let y = y0; y < y1; y++)
        data.set(raster.data.subarray(y * w + x0, y * w + x1), (y - y0 + pad) * cw + pad);
      return grayImage(data, cw, ch);
    });
}

function rotate180(img: OcrImage): OcrImage {
  return grayImage(img.data.slice().reverse(), img.width, img.height);
}
