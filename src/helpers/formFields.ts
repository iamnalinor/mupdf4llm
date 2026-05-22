import * as mupdf from "mupdf";
import type { FormField } from "./types";

/**
 * Extract every form field from a PDF as a flat list, one entry per widget.
 *
 * Ports `pymupdf4llm.helpers.utils.get_key_values`. Each returned record
 * carries the field's name, current value, type (text / checkbox / radio /
 * choice / signature), the page number it appears on, and its bounding box.
 */
export function getKeyValues(doc: mupdf.PDFDocument): FormField[] {
  const out: FormField[] = [];
  const total = doc.countPages();
  for (let pno = 0; pno < total; pno++) {
    const page = doc.loadPage(pno) as mupdf.PDFPage;
    let widgets: mupdf.PDFWidget[] = [];
    try {
      widgets = page.getWidgets() ?? [];
    } catch {
      continue;
    }
    for (const w of widgets) {
      try {
        const name = w.getName?.() ?? "";
        const value = w.getValue?.() ?? "";
        const label = w.getLabel?.() ?? "";
        const type = readWidgetType(w);
        const bounds = w.getBounds?.() ?? [0, 0, 0, 0];
        const [x0, y0, x1, y1] = bounds as [number, number, number, number];
        out.push({
          page: pno,
          name,
          label,
          value,
          type,
          bbox: [x0, y0, x1, y1],
        });
      } catch {
        // skip malformed widget
      }
    }
  }
  return out;
}

function readWidgetType(w: mupdf.PDFWidget): FormField["type"] {
  try {
    if ((w as any).isCheckbox?.()) return "checkbox";
    if ((w as any).isRadioButton?.()) return "radio";
    if ((w as any).isText?.()) return "text";
    if ((w as any).isComboBox?.() || (w as any).isListBox?.()) return "choice";
    if ((w as any).isSignature?.()) return "signature";
    const t = (w as any).getFieldType?.();
    if (typeof t === "string") {
      const lower = t.toLowerCase();
      if (lower.includes("check")) return "checkbox";
      if (lower.includes("radio")) return "radio";
      if (lower.includes("combo") || lower.includes("list")) return "choice";
      if (lower.includes("sig")) return "signature";
      if (lower.includes("text")) return "text";
    }
  } catch {
    // fall through
  }
  return "unknown";
}
