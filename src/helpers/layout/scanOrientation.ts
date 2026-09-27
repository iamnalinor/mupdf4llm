import * as mupdf from "mupdf";
import { PageRaster } from "../ocr/engine";
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
