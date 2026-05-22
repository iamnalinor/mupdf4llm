import * as mupdf from "mupdf";
import { Rect } from "./geometry";

/**
 * Per-word record produced by {@link extractWords}, matching the structure
 * of `page.get_text("words")` in PyMuPDF: `(x0, y0, x1, y1, text, block, line, word)`.
 */
export interface Word {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  text: string;
  block: number;
  line: number;
  word: number;
}

/** Convert a mupdf.Quad ([8 numbers]) to an axis-aligned bbox. */
function quadToRect(q: number[]): Rect {
  return new Rect(
    Math.min(q[0]!, q[2]!, q[4]!, q[6]!),
    Math.min(q[1]!, q[3]!, q[5]!, q[7]!),
    Math.max(q[0]!, q[2]!, q[4]!, q[6]!),
    Math.max(q[1]!, q[3]!, q[5]!, q[7]!),
  );
}

const WHITESPACE = /\s/;

/**
 * Extract every word from a page, grouped on whitespace boundaries. Ports the
 * `page.get_text("words")` extraction PyMuPDF uses for chunk-mode markdown.
 */
export function extractWords(page: mupdf.Page): Word[] {
  const out: Word[] = [];
  const stext = page.toStructuredText("preserve-whitespace,preserve-images");

  let blockIdx = -1;
  let lineIdx = -1;
  let wordIdx = -1;
  let curText = "";
  let curBox: Rect | null = null;

  const flush = () => {
    if (curBox && curText) {
      out.push({
        x0: curBox.x0,
        y0: curBox.y0,
        x1: curBox.x1,
        y1: curBox.y1,
        text: curText,
        block: blockIdx,
        line: lineIdx,
        word: ++wordIdx,
      });
    }
    curBox = null;
    curText = "";
  };

  stext.walk({
    beginTextBlock() {
      blockIdx++;
      lineIdx = -1;
    },
    beginLine() {
      lineIdx++;
      flush();
    },
    endLine() {
      flush();
    },
    onChar(c, _origin, _font, _size, quad) {
      if (WHITESPACE.test(c)) {
        flush();
        return;
      }
      const r = quadToRect(quad as unknown as number[]);
      if (!curBox) {
        curBox = r;
        curText = c;
      } else {
        curBox = curBox.union(r);
        curText += c;
      }
    },
  });
  flush();
  return out;
}
