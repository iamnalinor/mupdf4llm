import * as mupdf from "mupdf";
import { PageRaster, grayImage, type OcrEngine, type OcrImage } from "../ocr/engine";
import { getPageRotation, removeRotation } from "./pageRotation";

export type InkAxis = "upright" | "sideways" | "unknown";

/** One direction must win this many times more neighbour votes to decide. */
const AXIS_VOTES = 3;
/** Fewer glyph-sized pieces of ink than this do not tell. */
const MIN_GLYPHS = 200;

/**
 * Which way the lines of a scanned page run. Letters stand closer to the
 * letters beside them in a word, and words to the words beside them in a
 * line, than to anything in the lines above and below. So each glyph- or
 * word-sized piece of ink (a connected component no bigger than 5% of the
 * page side) votes for the direction of its nearest neighbour: across the
 * page for upright lines, down the page for lines turned sideways. Rules,
 * borders, a book's edge or the dark surround of a photographed page are
 * too large to vote, and slight skew or curl does not matter. `"unknown"`
 * when neither direction wins clearly or there is too little text.
 */
export function inkAxis(raster: PageRaster): InkAxis {
  const { width: w, height: h } = raster;
  const ink = raster.ink;
  const maxSide = 0.05 * Math.max(w, h);
  // Connected pieces of ink, as boxes.
  const seen = new Uint8Array(w * h);
  const boxes: [number, number, number, number][] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!ink[start] || seen[start]) continue;
    let [x0, y0, x1, y1] = [w, h, 0, 0];
    let n = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const k of next) {
        if (k >= 0 && k < w * h && ink[k] && !seen[k]) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (n >= 4 && bw >= 2 && bh >= 2 && bw <= maxSide && bh <= maxSide)
      boxes.push([x0, y0, x1, y1]);
  }
  if (boxes.length < MIN_GLYPHS) return "unknown";

  // Nearest neighbour by the gap between boxes, looked up in a grid of cells.
  const cell = Math.ceil(12 * raster.scale);
  const grid = new Map<number, number[]>();
  const key = (gx: number, gy: number) => gy * 65536 + gx;
  const cx = boxes.map((b) => (b[0] + b[2]) / 2);
  const cy = boxes.map((b) => (b[1] + b[3]) / 2);
  boxes.forEach((_, i) => {
    const k = key(Math.floor(cx[i]! / cell), Math.floor(cy[i]! / cell));
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  let across = 0;
  let down = 0;
  boxes.forEach((b, i) => {
    const gx = Math.floor(cx[i]! / cell);
    const gy = Math.floor(cy[i]! / cell);
    let best = Infinity;
    let dx = 0;
    let dy = 0;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (const j of grid.get(key(gx + ox, gy + oy)) ?? []) {
          if (j === i) continue;
          const o = boxes[j]!;
          const gapX = Math.max(0, o[0] - b[2], b[0] - o[2]);
          const gapY = Math.max(0, o[1] - b[3], b[1] - o[3]);
          const d = Math.hypot(gapX, gapY);
          if (d < best) {
            best = d;
            dx = Math.abs(cx[j]! - cx[i]!);
            dy = Math.abs(cy[j]! - cy[i]!);
          }
        }
      }
    }
    if (best === Infinity) return;
    if (dx > 2 * dy) across++;
    else if (dy > 2 * dx) down++;
  });
  if (across >= AXIS_VOTES * down) return "upright";
  if (down >= AXIS_VOTES * across) return "sideways";
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
 * Turn page `pno` clockwise by `deg` from how it is shown now, for good: add
 * `deg` to its /Rotate and bake that into the content with
 * {@link removeRotation}, so text, drawings and the page box come out as
 * shown. Returns the reloaded page.
 */
export function applyQuarterTurn(
  doc: mupdf.PDFDocument,
  pno: number,
  deg: 90 | 180 | 270,
): mupdf.PDFPage {
  const page = doc.loadPage(pno) as mupdf.PDFPage;
  page.getObject().put("Rotate", (getPageRotation(page) + deg) % 360);
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
