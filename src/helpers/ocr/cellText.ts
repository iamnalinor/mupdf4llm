import { Rect } from "../geometry";
import type { Block, TableData, TextSource } from "../types";
import type { OcrEngine, OcrImage, PageRaster } from "./engine";
import { OcrSetupError } from "./rapidOcr";

const BROKEN_CHAR = /[\uFFFD\uE000-\uF8FF\u0000-\u0008\u000E-\u001F]/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const LETTERS = /\p{L}+/gu;
const LOWER = /\p{Ll}/u;
/** Scripts with upper and lower case, where look-alike letters occur. */
const CASED_SCRIPTS: [string, RegExp][] = [
  ["Latin", /\p{Script=Latin}/u],
  ["Cyrillic", /\p{Script=Cyrillic}/u],
  ["Greek", /\p{Script=Greek}/u],
  ["Armenian", /\p{Script=Armenian}/u],
];
const scriptOf = (ch: string) => CASED_SCRIPTS.find(([, re]) => re.test(ch))?.[0] ?? "other";

/**
 * A single lowercase letter of another script slipped into a word of cased
 * letters, as a broken text layer or a look-alike substitution produces:
 * "Иcтория" with a Latin c inside, "языk" with a Latin k at the end.
 *
 * Deliberately narrow, as a needless OCR can replace correct text with a
 * misread: whole pieces written together ("ITотдел", "iPhoneом"), scripts
 * without case (Chinese, Japanese, Korean, Thai — they carry Latin words
 * without spaces), and a letter at the start ("µmol", "λmax") do not count.
 */
function strayLetter(word: string): boolean {
  const chars = [...word];
  if (chars.length < 3) return false;
  const lower = chars.map((ch) => LOWER.test(ch));
  const script = chars.map(scriptOf);
  for (let i = 1; i < chars.length; i++) {
    if (!lower[i] || script[i] === "other") continue;
    const prev = script[i - 1];
    const next = i + 1 < chars.length ? script[i + 1] : undefined;
    // One letter whose neighbours share another cased script.
    const inside = next !== undefined && prev === next && prev !== script[i] && lower[i + 1];
    const atEnd = next === undefined && prev !== script[i] && lower[i - 1];
    if ((inside || atEnd) && prev !== "other") return true;
  }
  return false;
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
 * Fonts whose text cannot be trusted: a font with broken characters (see
 * {@link looksBroken}) in some of its text. A font embedded without a
 * ToUnicode map and with glyphs numbered in order of use yields control
 * characters for its first glyphs and printable ASCII gibberish for the
 * rest, which on its own passes for text.
 */
export function brokenFonts(blocks: Block[]): Set<string> {
  const count = new Map<string, number>();
  for (const b of blocks) {
    if (b.type !== 0) continue;
    for (const l of b.lines) {
      for (const s of l.spans) {
        for (const ch of s.chars) {
          if (!BROKEN_CHAR.test(ch.c)) continue;
          const f = fontKey(s.font, ch.fontId);
          count.set(f, (count.get(f) ?? 0) + 1);
        }
      }
    }
  }
  return new Set([...count].filter(([, n]) => n >= 2).map(([f]) => f));
}

const fontKey = (name: string, id?: number) => (id === undefined ? name : `${name}#${id}`);

/** Fonts of the characters whose center lies in `cell`. */
function fontsIn(blocks: Block[], cell: Rect): Set<string> {
  const out = new Set<string>();
  for (const b of blocks) {
    if (b.type !== 0) continue;
    for (const l of b.lines) {
      for (const s of l.spans) {
        for (const ch of s.chars) {
          const cx = (ch.bbox[0] + ch.bbox[2]) / 2;
          const cy = (ch.bbox[1] + ch.bbox[3]) / 2;
          if (cx >= cell.x0 && cx < cell.x1 && cy >= cell.y0 && cy < cell.y1)
            out.add(fontKey(s.font, ch.fontId));
        }
      }
    }
  }
  return out;
}

export interface OcrCellsOptions {
  /** The page's text blocks: under `"auto"`, text in a {@link brokenFonts} font is OCRed too. */
  blocks?: Block[];
  /** On an {@link OcrSetupError}, keep the text layer instead of raising it. */
  keepLayer?: boolean;
}

/**
 * Fill table cells from OCR according to `source`. `"ocr"` recognises every
 * cell; `"auto"` only cells whose text layer {@link looksBroken} or is set in
 * one of the {@link brokenFonts}. A cell without ink is empty and not sent to
 * the engine. When the engine throws or returns nothing for a cell with ink,
 * the cell is left empty with source `"failed"` and processing continues. An
 * {@link OcrSetupError} is raised, unless `keepLayer` is set: then the text
 * layer stays as it is.
 */
export async function ocrTableCells(
  tables: TableData[],
  source: TextSource,
  raster: PageRaster,
  engine: OcrEngine,
  { blocks = [], keepLayer = false }: OcrCellsOptions = {},
): Promise<void> {
  if (source === "pdf") return;
  try {
    await ocrCells(tables, source, raster, engine, blocks);
  } catch (e) {
    if (!(keepLayer && e instanceof OcrSetupError)) throw e;
    if (typeof process !== "undefined" && process.env?.DEBUG_MUPDF4LLM)
      console.warn("[mupdf4llm] OCR unavailable, keeping the text layer:", e.message);
  }
}

async function ocrCells(
  tables: TableData[],
  source: TextSource,
  raster: PageRaster,
  engine: OcrEngine,
  blocks: Block[],
): Promise<void> {
  const badFonts = source === "auto" ? brokenFonts(blocks) : new Set<string>();
  const trusted = (text: string, cell: Rect) => {
    if (looksBroken(text)) return false;
    if (!badFonts.size) return true;
    for (const f of fontsIn(blocks, cell)) if (badFonts.has(f)) return false;
    return true;
  };
  for (const tab of tables) {
    const texts = source === "auto" ? tab.cellTexts() : null;
    for (let r = 0; r < tab.row_count; r++) {
      for (let c = 0; c < tab.col_count; c++) {
        const cell = tab.cells[r]?.[c];
        if (!cell) continue;
        if (texts && trusted(texts[r]![c]!.text, Rect.from(cell))) continue;
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
