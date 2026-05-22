import * as mupdf from "mupdf";
import { toMarkdown as ragToMarkdown } from "./helpers/pymupdfRag";
import type { MarkdownOptions, PageChunk } from "./helpers/types";

export type { MarkdownOptions, PageChunk, FormField } from "./helpers/types";
export { IdentifyHeaders, TocHeaders } from "./helpers/identifyHeaders";
export { getKeyValues } from "./helpers/formFields";
export { Rect, Point } from "./helpers/geometry";
export { ProgressBar } from "./helpers/progress";

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
