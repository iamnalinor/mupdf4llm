import * as mupdf from "mupdf";
import { toMarkdown as ragToMarkdown } from "./helpers/pymupdfRag";
import type { MarkdownOptions, PageChunk } from "./helpers/types";

export type {
  MarkdownOptions,
  MarkdownElement,
  PageChunk,
  FormField,
  ImageInfo,
  TextSource,
  CellSource,
  CellText,
} from "./helpers/types";
export type { OcrEngine, OcrImage, OcrResult } from "./helpers/ocr/engine";
export {
  createRapidOcr,
  OcrSetupError,
  type RapidOcrOptions,
  type RapidOcrModel,
} from "./helpers/ocr/rapidOcr";
export { IdentifyHeaders, TocHeaders } from "./helpers/text/identifyHeaders";
export { getKeyValues } from "./helpers/forms/formFields";
export { extractWords, type Word } from "./helpers/text/extractWords";
export { Rect, Point } from "./helpers/geometry";
export { ProgressBar } from "./helpers/progress";
export { clusterStripes, computeReadingOrder } from "./helpers/utils";
export { getPageRotation, setPageRotation, removeRotation } from "./helpers/layout/pageRotation";

/** Open a PDF from bytes and convert to markdown. */
export async function toMarkdown(
  buf: Uint8Array | ArrayBuffer,
  opts: MarkdownOptions = {},
): Promise<string> {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const doc = mupdf.PDFDocument.openDocument(bytes, "application/pdf") as mupdf.PDFDocument;
  try {
    const out = await ragToMarkdown(doc, { ...opts, pageChunks: false });
    return out as string;
  } finally {
    doc.destroy();
  }
}

/** Open a PDF from bytes and convert to page-chunk JSON. */
export async function toMarkdownPages(
  buf: Uint8Array | ArrayBuffer,
  opts: MarkdownOptions = {},
): Promise<PageChunk[]> {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const doc = mupdf.PDFDocument.openDocument(bytes, "application/pdf") as mupdf.PDFDocument;
  try {
    const out = await ragToMarkdown(doc, { ...opts, pageChunks: true });
    return out as PageChunk[];
  } finally {
    doc.destroy();
  }
}
