import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { toMarkdown as ragToMarkdown } from "../helpers/pymupdfRag";
import { IdentifyHeaders } from "../helpers/text/identifyHeaders";
import type { MarkdownOptions } from "../helpers/types";

type MetaFilter = (m: Record<string, unknown>) => Record<string, unknown>;

/**
 * Returned record shape. With `llamaindex` installed each item is a real
 * `Document` (same prototype as `import { Document } from "llamaindex"`);
 * without it, a plain object with the same field name. Either way the
 * metadata field is `metadata` — never `extra_info`.
 */
export interface LlamaIndexDocumentLike {
  text: string;
  metadata: Record<string, unknown>;
}

/**
 * LlamaIndex adapter — ports `pymupdf4llm.llama.PDFMarkdownReader`.
 *
 * `llamaindex` is an optional peer dependency. When it's installed, the
 * returned per-page records are instances of `Document` from
 * `llamaindex/core`; otherwise we fall back to a plain object with the
 * same shape (`{ text, extra_info }`).
 */
export class PDFMarkdownReader {
  metaFilter?: MetaFilter;

  constructor(opts: { metaFilter?: MetaFilter } = {}) {
    this.metaFilter = opts.metaFilter;
  }

  async loadData(
    filePath: string,
    extraInfo: Record<string, unknown> = {},
    loadOptions: MarkdownOptions = {},
  ): Promise<LlamaIndexDocumentLike[]> {
    if (typeof filePath !== "string") {
      throw new TypeError("file_path must be a string.");
    }
    const bytes = readFileSync(filePath);
    const doc = mupdf.PDFDocument.openDocument(
      new Uint8Array(bytes),
      "application/pdf",
    ) as mupdf.PDFDocument;
    try {
      const hdrInfo = new IdentifyHeaders(doc);
      const pageCount = doc.countPages();
      const Doc = await loadLlamaDocumentClass();
      const out: LlamaIndexDocumentLike[] = [];
      for (let pno = 0; pno < pageCount; pno++) {
        let meta = this.docMeta(doc, filePath, pno, extraInfo);
        if (this.metaFilter) meta = this.metaFilter(meta);
        const text = ragToMarkdown(doc, {
          ...loadOptions,
          pages: [pno],
          hdrInfo: hdrInfo,
          pageChunks: false,
        }) as string;
        out.push(Doc ? new Doc({ text, metadata: meta }) : { text, metadata: meta });
      }
      return out;
    } finally {
      doc.destroy();
    }
  }

  private docMeta(
    doc: mupdf.PDFDocument,
    filePath: string,
    pageNumber: number,
    extra: Record<string, unknown>,
  ): Record<string, unknown> {
    const meta: Record<string, unknown> = { ...extra };
    const keys: [string, string][] = [
      ["title", "info:Title"],
      ["author", "info:Author"],
      ["subject", "info:Subject"],
      ["keywords", "info:Keywords"],
      ["creator", "info:Creator"],
      ["producer", "info:Producer"],
      ["creationDate", "info:CreationDate"],
      ["modDate", "info:ModDate"],
    ];
    for (const [k, src] of keys) {
      try {
        meta[k] = doc.getMetaData(src) ?? "";
      } catch {
        meta[k] = "";
      }
    }
    meta.page = pageNumber + 1;
    meta.total_pages = doc.countPages();
    meta.file_path = filePath;
    return meta;
  }
}

async function loadLlamaDocumentClass(): Promise<
  (new (init: { text: string; metadata: Record<string, unknown> }) => LlamaIndexDocumentLike) | null
> {
  try {
    // Optional peer dependency — only resolved at runtime when the user
    // has installed `llamaindex` separately. The dynamic specifier keeps
    // the bundler from emitting a static import.
    const spec = "llamaindex";
    const mod: unknown = await import(/* @vite-ignore */ spec);
    const Doc = (mod as { Document?: unknown }).Document;
    return typeof Doc === "function" ? (Doc as never) : null;
  } catch {
    return null;
  }
}
