import * as mupdf from "mupdf";
import { toMarkdown as ragToMarkdown } from "./rag";
import type { MarkdownOptions, PageChunk } from "./types";

export type { MarkdownOptions, PageChunk } from "./types";
export { IdentifyHeaders } from "./identifyHeaders";
export { Rect, Point } from "./geometry";

/** Open a PDF from bytes and convert to markdown. */
export function toMarkdown(buf: Uint8Array | ArrayBuffer, opts: MarkdownOptions = {}): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const doc = mupdf.PDFDocument.openDocument(bytes, "application/pdf") as mupdf.PDFDocument;
  try {
    const out = ragToMarkdown(doc, { ...opts, pageChunks: false });
    return out as string;
  } finally {
    doc.destroy();
  }
}

/** Open a PDF from bytes and convert to page-chunk JSON. */
export function toMarkdownPages(buf: Uint8Array | ArrayBuffer, opts: MarkdownOptions = {}): PageChunk[] {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const doc = mupdf.PDFDocument.openDocument(bytes, "application/pdf") as mupdf.PDFDocument;
  try {
    const out = ragToMarkdown(doc, { ...opts, pageChunks: true });
    return out as PageChunk[];
  } finally {
    doc.destroy();
  }
}

export function toJson(): never {
  throw new Error("Function 'toJson' is only available in PyMuPDF-Layout mode");
}

export function toText(): never {
  throw new Error("Function 'toText' is only available in PyMuPDF-Layout mode");
}
