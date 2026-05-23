import * as mupdf from "mupdf";

/**
 * Read the /Rotate entry on a PDF page. Returns 0 if missing.
 *
 * PyMuPDF exposes `page.rotation` directly; JS mupdf only gives raw access to
 * the page object so we read it ourselves.
 */
export function getPageRotation(page: mupdf.PDFPage): number {
  try {
    const obj = page.getObject();
    const rot = obj.get("Rotate");
    if (rot && !rot.isNull()) {
      const n = rot.asNumber();
      return ((Math.round(n) % 360) + 360) % 360;
    }
  } catch {
    // tolerate
  }
  return 0;
}

/**
 * Set (or clear) the /Rotate entry on a PDF page. Pass 0 to remove rotation.
 *
 * Mirrors `page.set_rotation` / `page.remove_rotation` from PyMuPDF.
 */
export function setPageRotation(
  doc: mupdf.PDFDocument,
  page: mupdf.PDFPage,
  degrees: number,
): void {
  const norm = ((Math.round(degrees) % 360) + 360) % 360;
  try {
    const obj = page.getObject();
    if (norm === 0) {
      obj.delete("Rotate");
    } else {
      obj.put("Rotate", doc.newInteger(norm));
    }
  } catch {
    // tolerate read-only documents
  }
}

/**
 * Strip rotation from a page while preserving its visual appearance, then
 * return the previous rotation value.
 *
 * Faithful port of PyMuPDF's `page.remove_rotation()`: clearing the `/Rotate`
 * entry alone leaves text and vector content in the page's raw (authoring)
 * orientation, which transposes rows/columns of any table on a 90°/270° page.
 * Instead we prepend a derotation matrix to the content stream and swap the
 * MediaBox for 90°/270°, so downstream extraction sees coordinates in the
 * visually-correct (display) frame — matching upstream pymupdf4llm, which
 * calls `remove_rotation()` on every page.
 *
 * The caller must reload the page afterwards (`doc.loadPage`) for the new
 * MediaBox bounds to take effect.
 */
export function removeRotation(doc: mupdf.PDFDocument, page: mupdf.PDFPage): number {
  const rot = getPageRotation(page);
  if (rot !== 90 && rot !== 180 && rot !== 270) return 0;
  try {
    const obj = page.getObject();
    const mb = obj.getInheritable("MediaBox").asJS() as number[];
    const [x0, y0, x1, y1] = mb as [number, number, number, number];

    // Derotation matrix prepended to the content stream (origin-aware closed
    // form derived from PyMuPDF's mat0 * derotation_matrix).
    let cm: [number, number, number, number, number, number];
    if (rot === 90) cm = [0, -1, 1, 0, 0, x0 + x1];
    else if (rot === 270) cm = [0, 1, -1, 0, y0 + y1, 0];
    else cm = [-1, 0, 0, -1, x0 + x1, y0 + y1]; // 180

    const cmStream = doc.addStream(cm.map(fmtNum).join(" ") + " cm\n", null);
    const contents = obj.get("Contents");
    const arr = doc.newArray();
    arr.push(cmStream);
    if (contents.isArray()) contents.forEach((v) => arr.push(v));
    else arr.push(contents);
    obj.put("Contents", arr);

    // Swap MediaBox x/y for quarter turns.
    if (rot === 90 || rot === 270) {
      const swapped = doc.newArray();
      for (const v of [y0, x0, y1, x1]) swapped.push(doc.newReal(v));
      obj.put("MediaBox", swapped);
    }

    obj.delete("Rotate");
  } catch {
    // tolerate read-only documents — fall back to clearing the flag only
    setPageRotation(doc, page, 0);
  }
  return rot;
}

/** Compact number formatting for PDF content operators (no scientific notation). */
function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}
