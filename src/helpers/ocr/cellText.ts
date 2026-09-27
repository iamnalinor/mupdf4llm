import { Rect } from "../geometry";
import type { TableData, TextSource } from "../types";
import type { OcrEngine, OcrImage, PageRaster } from "./engine";
import { OcrSetupError } from "./rapidOcr";

const BROKEN_CHAR = /[\uFFFD\uE000-\uF8FF\u0000-\u0008\u000E-\u001F]/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const LETTERS = /\p{L}+/gu;
const LOWER = /\p{Ll}/u;
/**
 * Writing systems a letter can belong to. Han, Hiragana and Katakana are one
 * group: Japanese mixes them inside words. Letters of other scripts share
 * the group "other".
 */
const SCRIPTS: [string, RegExp][] = [
  ["Latin", /\p{Script=Latin}/u],
  ["Cyrillic", /\p{Script=Cyrillic}/u],
  ["Greek", /\p{Script=Greek}/u],
  ["Armenian", /\p{Script=Armenian}/u],
  ["Georgian", /\p{Script=Georgian}/u],
  ["Hebrew", /\p{Script=Hebrew}/u],
  ["Arabic", /\p{Script=Arabic}/u],
  ["Devanagari", /\p{Script=Devanagari}/u],
  ["Thai", /\p{Script=Thai}/u],
  ["Hangul", /\p{Script=Hangul}/u],
  ["CJK", /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u],
];
const scriptOf = (ch: string) => SCRIPTS.find(([, re]) => re.test(ch))?.[0] ?? "other";

/**
 * A letter of one writing system slipped into a word of another, as a
 * broken text layer or a look-alike substitution produces: "Иcтория" with a
 * Latin c, "языk". Whole pieces in different scripts ("ITотдел",
 * "iPhoneом") are how people write and do not count.
 */
function strayLetter(word: string): boolean {
  const chars = [...word];
  const runs: { script: string; from: number; to: number }[] = [];
  chars.forEach((ch, i) => {
    const script = scriptOf(ch);
    const last = runs[runs.length - 1];
    if (last && last.script === script) last.to = i;
    else runs.push({ script, from: i, to: i });
  });
  // A piece of another script inside the word.
  if (runs.length >= 3) return true;
  if (runs.length !== 2) return false;
  // Or a single lowercase letter at either end, next to lowercase letters.
  const [a, b] = runs as [(typeof runs)[0], (typeof runs)[0]];
  const single = a.from === a.to ? a.from : b.from === b.to ? b.from : -1;
  if (single < 0 || chars.length < 3) return false;
  const neighbour = single === 0 ? chars[1]! : chars[single - 1]!;
  return LOWER.test(chars[single]!) && LOWER.test(neighbour);
}

/**
 * Does text from the PDF text layer look unusable? True for empty text, for
 * replacement, private-use or control characters (typical of a missing or
 * broken ToUnicode map), for a letter of another script slipped into a
 * word (a Latin "c" in "Иcтория" reads right but breaks search), and for
 * text of four or more characters that is mostly neither letters nor
 * digits.
 */
export function looksBroken(text: string): boolean {
  const t = text.replace(/\s+/g, "");
  if (!t) return true;
  if (BROKEN_CHAR.test(t)) return true;
  // Words split at anything but a letter: "IT-отдел" is two words.
  for (const word of text.match(LETTERS) ?? []) if (strayLetter(word)) return true;
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
        const whole = raster.crop(Rect.from(cell));
        if (!whole) {
          // Nothing to read. Under "auto" the (empty) text layer stands.
          if (source === "ocr") tab.setCellText(r, c, { text: "", source: "ocr" });
          continue;
        }
        const read = async (img: OcrImage) => {
          try {
            return (await engine.recognize(img)).trim();
          } catch (e) {
            // A missing OCR package is a configuration error, not a bad cell.
            if (e instanceof OcrSetupError) throw e;
            if (typeof process !== "undefined" && process.env?.DEBUG_MUPDF4LLM)
              console.error(`[mupdf4llm] OCR failed for cell ${r},${c}:`, e);
            return "";
          }
        };
        let text = await read(whole);
        // A detector can drop a short line from a multi-line cell; then
        // recognise the cell line by line.
        const lines = raster.cropLines(Rect.from(cell));
        if (lines.length > 1 && text.split("\n").filter(Boolean).length < lines.length) {
          // One call at a time: engines may not handle parallel requests.
          const perLine: string[] = [];
          for (const img of lines) {
            const t = await read(img);
            if (t) perLine.push(t);
          }
          if (perLine.length > text.split("\n").filter(Boolean).length) text = perLine.join("\n");
        }
        // Only dots read (an empty value) is a result; nothing read is a
        // failure. Under "auto" a failed cell keeps its text-layer text.
        if (text) tab.setCellText(r, c, { text: stripLeaders(text), source: "ocr" });
        else tab.setCellText(r, c, { text: texts ? texts[r]![c]!.text : "", source: "failed" });
      }
    }
  }
}

/**
 * Remove leader dots, the rows of dots that lead a label to its value
 * ("Total ........ 1900", "машиностроение . . . . ."), and a cell that is
 * only dots (an empty value). Two dots stay ("1900..").
 */
export function stripLeaders(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/\s*(?:[.·…•_]\s*){3,}/gu, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}
