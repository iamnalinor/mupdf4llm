import * as mupdf from "mupdf";
import { Rect, type BBox } from "../geometry";
import {
  FLAG_BOLD,
  FLAG_ITALIC,
  FLAG_MONOSPACED,
  FLAG_SERIF,
  CHAR_BOLD,
  CHAR_FILLED,
} from "../constants";
import type { Block, Line, Span, TextDict } from "../types";

/** Pack mupdf.js Color [r,g,b] (0..1) into a PyMuPDF-style packed sRGB int. */
function packColor(color: number[] | null | undefined): number {
  if (!color) return 0;
  const c = color;
  if (c.length === 1) {
    const g = Math.round((c[0] as number) * 255);
    return (g << 16) | (g << 8) | g;
  }
  if (c.length >= 3) {
    const r = Math.round((c[0] as number) * 255);
    const g = Math.round((c[1] as number) * 255);
    const b = Math.round((c[2] as number) * 255);
    return (r << 16) | (g << 8) | b;
  }
  return 0;
}

function fontFlags(font: mupdf.Font): number {
  let f = 0;
  if (font.isItalic()) f |= FLAG_ITALIC;
  if (font.isSerif()) f |= FLAG_SERIF;
  if (font.isMono()) f |= FLAG_MONOSPACED;
  if (font.isBold()) f |= FLAG_BOLD;
  return f;
}

function fontCharFlags(font: mupdf.Font): number {
  // We treat every char as "filled" by default (FZ_STEXT_FILLED = 16).
  let f = CHAR_FILLED;
  if (font.isBold()) f |= CHAR_BOLD;
  return f;
}

interface CharData {
  c: string;
  origin: [number, number];
  bbox: BBox;
  font: mupdf.Font;
  size: number;
  color: number[];
}

/** Quad in mupdf.js is [ulx,uly,urx,ury,llx,lly,lrx,lry]; produce axis-aligned bbox. */
function quadToBBox(q: number[]): BBox {
  return [
    Math.min(q[0]!, q[2]!, q[4]!, q[6]!),
    Math.min(q[1]!, q[3]!, q[5]!, q[7]!),
    Math.max(q[0]!, q[2]!, q[4]!, q[6]!),
    Math.max(q[1]!, q[3]!, q[5]!, q[7]!),
  ];
}

/** Group chars into spans (PyMuPDF semantics): break on font/size/color change. */
function charsToSpans(chars: CharData[]): Span[] {
  if (!chars.length) return [];
  const spans: Span[] = [];
  let cur: CharData[] = [chars[0]!];
  const sameSpan = (a: CharData, b: CharData) =>
    a.font.getName() === b.font.getName() &&
    a.size === b.size &&
    a.color.length === b.color.length &&
    a.color.every((v, i) => v === b.color[i]);

  for (let i = 1; i < chars.length; i++) {
    const c = chars[i]!;
    if (sameSpan(cur[cur.length - 1]!, c)) {
      cur.push(c);
    } else {
      spans.push(buildSpan(cur));
      cur = [c];
    }
  }
  spans.push(buildSpan(cur));
  return spans;
}

function buildSpan(chars: CharData[]): Span {
  const first = chars[0]!;
  const text = chars.map((c) => c.c).join("");
  let x0 = first.bbox[0],
    y0 = first.bbox[1],
    x1 = first.bbox[2],
    y1 = first.bbox[3];
  for (let i = 1; i < chars.length; i++) {
    const b = chars[i]!.bbox;
    if (b[0] < x0) x0 = b[0];
    if (b[1] < y0) y0 = b[1];
    if (b[2] > x1) x1 = b[2];
    if (b[3] > y1) y1 = b[3];
  }
  return {
    bbox: new Rect(x0, y0, x1, y1),
    text,
    font: first.font.getName(),
    size: first.size,
    color: packColor(first.color),
    flags: fontFlags(first.font),
    char_flags: fontCharFlags(first.font),
    alpha: 255,
    ascender: 0.8,
    descender: -0.2,
    origin: first.origin,
  };
}

export interface TextPageOpts {
  preserveImages?: boolean;
  preserveLigatures?: boolean;
  preserveWhitespace?: boolean;
  collectStyles?: boolean;
  collectVectors?: boolean;
  collectFlags?: boolean;
  accurateBboxes?: boolean;
  dehyphenate?: boolean;
  mediaboxClip?: boolean;
}

function buildOptString(opts: TextPageOpts): string {
  // Defaults match PyMuPDF's `page.get_text("rawdict")` — most notably
  // ligatures are decomposed (ﬁ → fi) unless the caller opts in.
  const parts: string[] = [];
  if (opts.preserveImages !== false) parts.push("preserve-images");
  if (opts.preserveLigatures === true) parts.push("preserve-ligatures");
  if (opts.preserveWhitespace !== false) parts.push("preserve-whitespace");
  if (opts.collectStyles !== false) parts.push("collect-styles");
  if (opts.collectVectors) parts.push("collect-vectors");
  if (opts.collectFlags) parts.push("collect-flags");
  if (opts.accurateBboxes) parts.push("accurate-bboxes");
  if (opts.dehyphenate) parts.push("dehyphenate");
  if (opts.mediaboxClip !== false) parts.push("clip");
  return parts.join(",");
}

/** Build a PyMuPDF-shaped TextDict from a page. */
export function extractTextDict(page: mupdf.Page, opts: TextPageOpts = {}): TextDict {
  const stext = page.toStructuredText(buildOptString(opts));
  const blocks: Block[] = [];
  let blockIndex = 0;
  let curBlock: { bbox: BBox; lines: Line[] } | null = null;
  let curLineChars: CharData[] | null = null;
  let curLine: { bbox: BBox; dir: [number, number]; wmode: number } | null = null;

  stext.walk({
    beginTextBlock(bbox) {
      curBlock = { bbox: [...bbox] as BBox, lines: [] };
    },
    endTextBlock() {
      if (curBlock) {
        blocks.push({ type: 0, bbox: curBlock.bbox, number: blockIndex++, lines: curBlock.lines });
        curBlock = null;
      }
    },
    beginLine(bbox, wmode, dir) {
      curLine = { bbox: [...bbox] as BBox, dir: [dir[0]!, dir[1]!], wmode };
      curLineChars = [];
    },
    endLine() {
      if (curBlock && curLine && curLineChars) {
        const spans = charsToSpans(curLineChars);
        curBlock.lines.push({
          bbox: curLine.bbox,
          dir: curLine.dir,
          wmode: curLine.wmode,
          spans,
        });
      }
      curLine = null;
      curLineChars = null;
    },
    onChar(c, origin, font, size, quad, color) {
      if (curLineChars) {
        curLineChars.push({
          c,
          origin: [origin[0]!, origin[1]!],
          bbox: quadToBBox(quad as unknown as number[]),
          font,
          size,
          color: [...(color as unknown as number[])],
        });
      }
    },
    onImageBlock(bbox) {
      blocks.push({ type: 1, bbox: [...bbox] as BBox, number: blockIndex++, lines: [] });
    },
    onVector(bbox) {
      blocks.push({
        type: 3,
        bbox: [...bbox] as BBox,
        number: blockIndex++,
        lines: [],
        isrect: true,
      });
    },
  });

  return { blocks };
}
