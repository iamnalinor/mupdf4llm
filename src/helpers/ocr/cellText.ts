import { Rect } from "../geometry";
import type { TableData, TextSource } from "../types";
import type { OcrEngine, PageRaster } from "./engine";
import { OcrSetupError } from "./rapidOcr";

const BROKEN_CHAR = /[\uFFFD\uE000-\uF8FF\u0000-\u0008\u000E-\u001F]/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Does text from the PDF text layer look unusable? True for empty text, for
 * replacement, private-use or control characters (typical of a missing or
 * broken ToUnicode map), and for text of four or more characters that is
 * mostly neither letters nor digits.
 */
export function looksBroken(text: string): boolean {
  const t = text.replace(/\s+/g, "");
  if (!t) return true;
  if (BROKEN_CHAR.test(t)) return true;
  if (t.length < 4) return false;
  let word = 0;
  for (const ch of t) if (WORD_CHAR.test(ch)) word++;
  return word < t.length / 2;
}

/**
 * Fill table cells from OCR according to `source`. `"ocr"` recognises every
 * cell; `"auto"` only cells whose text layer {@link looksBroken}. A cell
 * without ink is empty and not sent to the engine. When the engine throws or
 * returns nothing for a cell with ink, the cell is left empty with source
 * `"failed"` and processing continues.
 */
export async function ocrTableCells(
  tables: TableData[],
  source: TextSource,
  raster: PageRaster,
  engine: OcrEngine,
): Promise<void> {
  if (source === "pdf") return;
  for (const tab of tables) {
    const texts = source === "auto" ? tab.cellTexts() : null;
    for (let r = 0; r < tab.row_count; r++) {
      for (let c = 0; c < tab.col_count; c++) {
        const cell = tab.cells[r]?.[c];
        if (!cell) continue;
        if (texts && !looksBroken(texts[r]![c]!.text)) continue;
        const img = raster.crop(Rect.from(cell));
        if (!img) {
          // Nothing to read. Under "auto" the (empty) text layer stands.
          if (source === "ocr") tab.setCellText(r, c, { text: "", source: "ocr" });
          continue;
        }
        let text = "";
        try {
          text = (await engine.recognize(img)).trim();
        } catch (e) {
          // A missing OCR package is a configuration error, not a bad cell.
          if (e instanceof OcrSetupError) throw e;
          if (typeof process !== "undefined" && process.env?.DEBUG_MUPDF4LLM)
            console.error(`[mupdf4llm] OCR failed for cell ${r},${c}:`, e);
        }
        tab.setCellText(r, c, { text, source: text ? "ocr" : "failed" });
      }
    }
  }
}
