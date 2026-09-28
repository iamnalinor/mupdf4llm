import { Rect } from "../geometry";
import type { Block, TableData, TextSource } from "../types";
import type { OcrEngine, OcrImage, OcrResult, PageRaster } from "./engine";
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

/** A font is broken with at least this many broken characters... */
const BROKEN_FONT_MIN = 3;
/** ...making up at least this share of its text... */
const BROKEN_FONT_SHARE = 0.05;
/** ...or with at least this many different control characters, whatever their share. */
const BROKEN_FONT_CODES = 4;
/**
 * A glyph's code: tab, line feed and the other C0 controls. A real space
 * comes out as U+0020, so a control character from a font is a glyph
 * number, not white space.
 */
const CONTROL_CHAR = /[\u0000-\u001F]/u;

/**
 * Fonts whose text cannot be trusted. A font embedded without a ToUnicode
 * map and with glyphs numbered in order of use yields control characters
 * for its first glyphs and printable ASCII gibberish for the rest, which on
 * its own passes for text. Such a font is told by a fair share of broken
 * characters (see {@link looksBroken}), or, on a long table where its first
 * glyphs are a small part of the text, by many different control
 * characters. A healthy font with a few glyphs that do not map (a footnote
 * mark, a bullet, ligatures in the Private Use Area) is not broken: only
 * those cells are.
 */
export function brokenFonts(blocks: Block[]): Set<string> {
  const bad = new Map<string, number>();
  const codes = new Map<string, Set<string>>();
  const all = new Map<string, number>();
  for (const b of blocks) {
    if (b.type !== 0) continue;
    for (const l of b.lines) {
      for (const s of l.spans) {
        for (const ch of s.chars) {
          const broken = BROKEN_CHAR.test(ch.c) || CONTROL_CHAR.test(ch.c);
          if (!broken && /\s/.test(ch.c)) continue;
          const f = fontKey(s.font, ch.fontId);
          all.set(f, (all.get(f) ?? 0) + 1);
          if (!broken) continue;
          bad.set(f, (bad.get(f) ?? 0) + 1);
          if (!CONTROL_CHAR.test(ch.c)) continue;
          if (!codes.has(f)) codes.set(f, new Set());
          codes.get(f)!.add(ch.c);
        }
      }
    }
  }
  return new Set(
    [...bad]
      .filter(
        ([f, n]) =>
          (n >= BROKEN_FONT_MIN && n >= BROKEN_FONT_SHARE * all.get(f)!) ||
          (codes.get(f)?.size ?? 0) >= BROKEN_FONT_CODES,
      )
      .map(([f]) => f),
  );
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
  raster: PageRaster | (() => PageRaster),
  engine: OcrEngine,
  { blocks = [], keepLayer = false }: OcrCellsOptions = {},
): Promise<void> {
  if (source === "pdf") return;
  try {
    await ocrCells(
      tables,
      source,
      typeof raster === "function" ? raster : () => raster,
      engine,
      blocks,
    );
  } catch (e) {
    if (!(keepLayer && e instanceof OcrSetupError)) throw e;
    if (typeof process !== "undefined" && process.env?.DEBUG_MUPDF4LLM)
      console.warn("[mupdf4llm] OCR unavailable, keeping the text layer:", e.message);
  }
}

async function ocrCells(
  tables: TableData[],
  source: TextSource,
  getRaster: () => PageRaster,
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
        const whole = getRaster().crop(Rect.from(cell));
        if (!whole) {
          // Nothing to read: the cell is empty on the page. Under "auto" an
          // empty text layer stands; untrusted text there is invisible (white,
          // hidden, clipped) and goes.
          if (source === "ocr" || texts![r]![c]!.text.trim())
            tab.setCellText(r, c, { text: "", source: "ocr" });
          continue;
        }
        const read = async (img: OcrImage): Promise<OcrResult> => {
          try {
            const res = checked(await engine.recognize(img));
            return { ...res, text: res.text.trim() };
          } catch (e) {
            // A missing OCR package is a configuration error, not a bad cell.
            if (e instanceof OcrSetupError) throw e;
            if (typeof process !== "undefined" && process.env?.DEBUG_MUPDF4LLM)
              console.error(`[mupdf4llm] OCR failed for cell ${r},${c}:`, e);
            return { text: "" };
          }
        };
        let res = await read(whole);
        const count = (text: string) => text.split("\n").filter(Boolean).length;
        // A detector can drop a short line from a multi-line cell; then
        // recognise the cell line by line.
        const lines = getRaster().cropLines(Rect.from(cell));
        if (lines.length > 1 && count(res.text) < lines.length) {
          // One call at a time: engines may not handle parallel requests.
          const perLine: OcrResult[] = [];
          for (const img of lines) {
            const line = await read(img);
            if (line.text) perLine.push(line);
          }
          if (perLine.length > count(res.text)) res = joinLines(perLine);
        }
        // Only dots read (an empty value) is a result; nothing read is a
        // failure. Under "auto" a failed cell keeps its text-layer text.
        if (res.text) {
          const text = fixHomoglyphs(stripLeaders(res.text));
          const { confidence } = res;
          tab.setCellText(r, c, {
            text,
            source: "ocr",
            ...(confidence !== undefined && { confidence }),
          });
        } else tab.setCellText(r, c, { text: texts ? texts[r]![c]!.text : "", source: "failed" });
      }
    }
  }
}

/**
 * An engine's result, checked against the {@link OcrResult} contract. A
 * broken one is an engine that cannot work (a string, as engines returned
 * before 0.4; a percentage for a confidence), not a bad cell: it stops the
 * conversion instead of leaving every cell failed.
 */
function checked(res: OcrResult): OcrResult {
  if (typeof res?.text !== "string")
    throw new OcrSetupError("OcrEngine.recognize must return { text, confidence? } (since 0.4)");
  const { confidence: c } = res;
  if (c !== undefined && !(typeof c === "number" && c >= 0 && c <= 1))
    throw new OcrSetupError(`OCR confidence must be a number from 0 to 1, got ${String(c)}`);
  return res;
}

/** Lines read one by one, as one result: the least sure line sets the confidence. */
function joinLines(lines: OcrResult[]): OcrResult {
  const known = lines.flatMap((l) => (l.confidence === undefined ? [] : [l.confidence]));
  const text = lines.map((l) => l.text).join("\n");
  return known.length ? { text, confidence: Math.min(...known) } : { text };
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

/** Latin letters and the Cyrillic letters they look like. */
const TWINS: Record<string, string> = {
  A: "А",
  B: "В",
  C: "С",
  E: "Е",
  H: "Н",
  K: "К",
  M: "М",
  O: "О",
  P: "Р",
  T: "Т",
  X: "Х",
  Y: "У",
  a: "а",
  c: "с",
  e: "е",
  k: "к",
  o: "о",
  p: "р",
  x: "х",
  y: "у",
};
const LATIN = /\p{Script=Latin}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;

/**
 * Put Cyrillic letters in place of the Latin look-alikes an OCR engine mixes
 * into Cyrillic text ("Мосkвa", "Kлaсс"). A word of both scripts is fixed
 * when each of its Latin letters has a Cyrillic twin; a word all of twins
 * ("CaBBa") only when the text around it is Cyrillic. A capital put in
 * inside a word that ends in small letters ("АHHа") becomes small. Real
 * Latin words, and words with Latin letters that have no twin ("IT-отдел",
 * "Archiaров"), are left alone.
 */
export function fixHomoglyphs(text: string): string {
  const words = text.match(/\p{L}+/gu) ?? [];
  const cyrillic = words.filter((w) => CYRILLIC.test(w) && !LATIN.test(w)).length;
  const latin = words.filter((w) => LATIN.test(w) && !CYRILLIC.test(w)).length;
  return text.replace(/\p{L}+/gu, (word) => {
    const chars = [...word];
    const lat = chars.filter((ch) => LATIN.test(ch));
    if (!lat.length || !lat.every((ch) => ch in TWINS)) return word;
    const mixed = lat.length < chars.length;
    // A word all of twins: Cyrillic only when it has small letters (capitals
    // alone are an abbreviation, "HP", "ABC") and Cyrillic words outnumber
    // the other Latin ones.
    if (!mixed && (!/\p{Ll}/u.test(word) || cyrillic <= latin - 1)) return word;
    const endsSmall = /\p{Ll}/u.test(chars[chars.length - 1]!);
    return chars
      .map((ch, i) => {
        if (!(ch in TWINS)) return ch;
        const twin = TWINS[ch]!;
        return i > 0 && endsSmall ? twin.toLowerCase() : twin;
      })
      .join("");
  });
}
