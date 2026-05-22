import * as mupdf from "mupdf";
import { extractTextDict } from "./textPage.ts";
import { isWhite } from "./utils.ts";
import type { Span, PageContext } from "./types.ts";

export interface HeaderIdProvider {
  get_header_id(span: Span, page?: PageContext): string;
}

export class IdentifyHeaders implements HeaderIdProvider {
  body_limit: number;
  header_id: Map<number, string> = new Map();

  constructor(doc: mupdf.PDFDocument, opts: { pages?: number[]; body_limit?: number; max_levels?: number } = {}) {
    const bodyLimit = opts.body_limit ?? 12;
    const maxLevels = opts.max_levels ?? 6;
    if (!(Number.isInteger(maxLevels) && maxLevels >= 1 && maxLevels <= 6)) {
      throw new Error("max_levels must be an integer between 1 and 6");
    }

    const pages = opts.pages ?? Array.from({ length: doc.countPages() }, (_, i) => i);
    const fontsizes = new Map<number, number>();

    for (const pno of pages) {
      const page = doc.loadPage(pno);
      const td = extractTextDict(page, {});
      for (const b of td.blocks) {
        if (b.type !== 0) continue;
        for (const l of b.lines) {
          for (const s of l.spans) {
            if (isWhite(s.text)) continue;
            const sz = Math.round(s.size);
            const len = s.text.trim().length;
            fontsizes.set(sz, (fontsizes.get(sz) ?? 0) + len);
          }
        }
      }
    }

    const items = Array.from(fontsizes.entries()).sort((a, b) => {
      if (a[1] !== b[1]) return a[1] - b[1];
      return a[0] - b[0];
    });
    if (items.length) {
      this.body_limit = Math.max(bodyLimit, items[items.length - 1]![0]);
    } else {
      this.body_limit = bodyLimit;
    }

    const sizes = Array.from(fontsizes.keys())
      .filter((f) => f > this.body_limit)
      .sort((a, b) => b - a)
      .slice(0, maxLevels);

    for (let i = 0; i < sizes.length; i++) {
      this.header_id.set(sizes[i]!, "#".repeat(i + 1) + " ");
    }
    if (this.header_id.size) {
      this.body_limit = Math.min(...this.header_id.keys()) - 1;
    }
  }

  get_header_id(span: Span): string {
    const fontsize = Math.round(span.size);
    if (fontsize <= this.body_limit) return "";
    return this.header_id.get(fontsize) ?? "";
  }
}
