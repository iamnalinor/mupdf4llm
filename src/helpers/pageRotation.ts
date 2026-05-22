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
 * Strip rotation from a page (set /Rotate to 0) and return the previous value
 * so the caller can restore it after processing. Mirrors
 * `page.remove_rotation()`.
 */
export function removeRotation(doc: mupdf.PDFDocument, page: mupdf.PDFPage): number {
  const prev = getPageRotation(page);
  if (prev !== 0) setPageRotation(doc, page, 0);
  return prev;
}
