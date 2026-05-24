import * as mupdf from "mupdf";
import { Rect } from "./geometry";
import { REPLACEMENT_CHARACTER } from "./constants";
import { startswithBullet, areDisjoint } from "./utils";
import { extractTextDict } from "./text/textPage";
import { getRawLines } from "./text/getTextLines";
import { IdentifyHeaders, type HeaderIdProvider } from "./text/identifyHeaders";
import { columnBoxes } from "./layout/multiColumn";
import { extractDrawings } from "./tables/drawingDevice";
import { findTables } from "./tables/tableFinder";
import { removeRotation } from "./layout/pageRotation";
import { ProgressBar } from "./progress";
import { renderPageImage, dedupeImages } from "./images/imageExtract";
import { extractWords } from "./text/extractWords";
import type {
  MarkdownOptions,
  MarkdownElement,
  CellStyle,
  PageContext,
  PageChunk,
  Span,
  LinkInfo,
  TableData,
} from "./types";

interface PageParams {
  page: mupdf.PDFPage;
  pageNumber: number;
  filename: string;
  md_string: string;
  clip: Rect;
  accept_invisible: boolean;
  links: LinkInfo[];
  tab_rects: Map<number, Rect>;
  tab_rects0: Rect[];
  img_rects: Rect[];
  written_tables: Set<number>;
  written_images: Set<number>;
  line_rects: Rect[];
  blocks: ReturnType<typeof extractTextDict>["blocks"];
  tabs: TableData[];
  fontsizeLimit?: number;
}

function resolveLinks(links: LinkInfo[], span: Span): string | null {
  const bbox = span.bbox;
  for (const link of links) {
    const hot = link.from;
    const mx = (hot.x0 + hot.x1) / 2;
    const my = (hot.y0 + hot.y1) / 2;
    if (mx >= bbox.x0 && mx <= bbox.x1 && my >= bbox.y0 && my <= bbox.y1) {
      return `[${span.text.trim()}](${link.uri})`;
    }
  }
  return null;
}

function outsideAllBboxes(rect: Rect, list: Rect[]): boolean {
  for (const r of list) if (!areDisjoint(rect, r)) return false;
  return true;
}

function maxHeaderId(
  spans: Span[],
  getId: (s: Span, p: PageContext) => string,
  pageCtx: PageContext,
): string {
  const lens = new Set<number>();
  for (const s of spans) {
    const id = getId(s, pageCtx);
    if (id) lens.add(id.length);
  }
  const sorted = Array.from(lens)
    .filter((l) => l > 0)
    .sort((a, b) => a - b);
  if (!sorted.length) return "";
  return "#".repeat(sorted[0]! - 1) + " ";
}

function writeText(
  parms: PageParams,
  clip: Rect,
  getHeaderId: (s: Span, p: PageContext) => string,
  pageCtx: PageContext,
  opts: {
    ignoreCode: boolean;
    forceText: boolean;
    tables: boolean;
    isEl: (e: MarkdownElement) => boolean;
    cellStyle: CellStyle;
  },
): string {
  let out = "";
  let nlines = getRawLines(
    { blocks: parms.blocks },
    {
      clip,
      tolerance: 3,
      ignoreInvisible: !parms.accept_invisible,
      fontsizeLimit: parms.fontsizeLimit,
    },
  );
  nlines = nlines.filter((l) => outsideAllBboxes(l.rect, parms.tab_rects0));

  for (const l of nlines) parms.line_rects.push(l.rect);

  let prev_lrect: Rect | null = null;
  let prev_bno = -1;
  let code = false;
  let prev_hdr_string: string | null = null;

  for (const { rect: lrect, spans } of nlines) {
    if (!outsideAllBboxes(lrect, parms.img_rects)) continue;

    // Emit any tables that sit above this text line and overlap horizontally.
    if (opts.tables) {
      const tabCandidates: number[] = [];
      for (const [i, tab_rect] of parms.tab_rects) {
        if (parms.written_tables.has(i)) continue;
        if (tab_rect.y1 > lrect.y0) continue;
        const horizOverlap =
          (lrect.x0 <= tab_rect.x0 && tab_rect.x0 < lrect.x1) ||
          (lrect.x0 < tab_rect.x1 && tab_rect.x1 <= lrect.x1) ||
          (tab_rect.x0 <= lrect.x0 && lrect.x1 <= tab_rect.x1);
        if (horizOverlap) tabCandidates.push(i);
      }
      for (const i of tabCandidates) {
        out += "\n" + parms.tabs[i]!.to_markdown(false, opts.cellStyle) + "\n";
        parms.written_tables.add(i);
        prev_hdr_string = null;
      }
    }

    parms.line_rects.push(lrect);
    if (parms.line_rects.length > 1) {
      const prev = parms.line_rects[parms.line_rects.length - 2]!;
      if (lrect.y1 - prev.y1 > lrect.height * 1.5) {
        out += "\n";
      }
    }

    const text_full = spans
      .map((s) => s.text)
      .join(" ")
      .trim();

    // Strikeout intentionally not detected: mupdf.js's walker doesn't expose
    // per-char flags, so we can't read FZ_STEXT_STRIKEOUT. See docs/guide/
    // parity-and-limits.md.
    const all_italic = spans.every((s) => s.flags & 2);
    const all_bold = spans.every((s) => s.flags & 16 || s.char_flags & 8);
    const all_mono = spans.every((s) => s.flags & 8);

    const hdr_string = opts.isEl("header") ? maxHeaderId(spans, getHeaderId, pageCtx) : "";

    if (hdr_string) {
      let text = text_full;
      if (all_mono && opts.isEl("inlineCode")) text = "`" + text + "`";
      if (all_italic && opts.isEl("italic")) text = "_" + text + "_";
      if (all_bold && opts.isEl("bold")) text = "**" + text + "**";
      if (hdr_string !== prev_hdr_string) {
        out += hdr_string + text + "\n";
      } else {
        while (out.endsWith("\n")) out = out.slice(0, -1);
        out += " " + text + "\n";
      }
      prev_hdr_string = hdr_string;
      continue;
    }
    prev_hdr_string = hdr_string;

    if (all_mono && !opts.ignoreCode && opts.isEl("codeBlock")) {
      if (!code) {
        out += "```\n";
        code = true;
      }
      const first = spans[0]!;
      const delta = Math.floor((lrect.x0 - clip.x0) / (first.size * 0.5));
      out += " ".repeat(Math.max(0, delta)) + text_full + "\n";
      continue;
    }

    if (code && !all_mono) {
      out += "```\n";
      code = false;
    }

    const span0 = spans[0]!;
    const bno = span0.block ?? -1;
    if (bno !== prev_bno) {
      out += "\n";
      prev_bno = bno;
    }

    if (
      (prev_lrect && lrect.y1 - prev_lrect.y1 > lrect.height * 1.5) ||
      span0.text.startsWith("[") ||
      startswithBullet(span0.text) ||
      span0.flags & 1
    ) {
      out += "\n";
    }
    prev_lrect = lrect;

    if (code) {
      out += "```\n";
      code = false;
    }

    for (const s of spans) {
      const mono = s.flags & 8;
      const bold = s.flags & 16 || s.char_flags & 8;
      const italic = s.flags & 2;
      let prefix = "";
      let suffix = "";
      if (mono && opts.isEl("inlineCode")) {
        prefix = "`" + prefix;
        suffix += "`";
      }
      if (bold && opts.isEl("bold")) {
        prefix = "**" + prefix;
        suffix += "**";
      }
      if (italic && opts.isEl("italic")) {
        prefix = "_" + prefix;
        suffix += "_";
      }

      const ltext = opts.isEl("link") ? resolveLinks(parms.links, s) : "";
      let text: string;
      if (ltext) {
        text = `${hdr_string}${prefix}${ltext}${suffix} `;
      } else {
        text = `${hdr_string}${prefix}${s.text.trim()}${suffix} `;
      }
      if (opts.isEl("bulletList") && startswithBullet(text)) {
        text = "- " + text.slice(1);
        text = text.replace(/  /g, " ");
        const dist = span0.bbox.x0 - clip.x0;
        let cwidth = (span0.bbox.x1 - span0.bbox.x0) / span0.text.length;
        if (cwidth === 0) cwidth = span0.size * 0.5;
        text = " ".repeat(Math.max(0, Math.round(dist / cwidth))) + text;
      }
      out += text;
    }
    if (!code) out += "\n";
  }
  out += "\n";
  if (code) {
    out += "```\n";
    code = false;
  }
  out += "\n\n";
  return out
    .replace(/ \n/g, "\n")
    .replace(/ {2}/g, " ")
    .replace(/\n\n\n/g, "\n\n");
}

function getLinks(page: mupdf.PDFPage): LinkInfo[] {
  const out: LinkInfo[] = [];
  for (const link of page.getLinks()) {
    const uri = link.getURI();
    if (!uri) continue;
    if (!link.isExternal()) continue;
    const b = link.getBounds();
    out.push({
      kind: "uri",
      uri,
      from: new Rect(b[0], b[1], b[2], b[3]),
    });
  }
  return out;
}

function getMetadata(
  doc: mupdf.PDFDocument,
  filename: string,
  pno: number,
): Record<string, unknown> {
  const keys: [string, string][] = [
    ["format", "format"],
    ["title", "info:Title"],
    ["author", "info:Author"],
    ["subject", "info:Subject"],
    ["keywords", "info:Keywords"],
    ["creator", "info:Creator"],
    ["producer", "info:Producer"],
    ["creationDate", "info:CreationDate"],
    ["modDate", "info:ModDate"],
    ["encryption", "encryption"],
  ];
  const meta: Record<string, unknown> = {};
  for (const [key, mupdfKey] of keys) {
    try {
      meta[key] = doc.getMetaData(mupdfKey) ?? "";
    } catch {
      meta[key] = "";
    }
  }
  meta.file_path = filename;
  meta.page_count = doc.countPages();
  meta.page = pno + 1;
  return meta;
}

function getToc(doc: mupdf.PDFDocument): [number, string, number][] {
  const out: [number, string, number][] = [];
  const outline = doc.loadOutline();
  if (!outline) return out;
  // mupdf.js does not export the OutlineItem interface name; structural typing.
  function walk(items: Array<{ title?: string; page?: number; down?: any[] }>, level: number) {
    for (const item of items) {
      const title = item.title ?? "";
      const page = (item.page ?? -1) + 1;
      out.push([level, title, page]);
      if (item.down) walk(item.down, level + 1);
    }
  }
  walk(outline, 1);
  return out;
}

/** Internal-only flag: callers from index.ts pick which entry point they need. */
type RunMode = { pageChunks?: boolean };

export function toMarkdown(
  doc: mupdf.PDFDocument,
  opts: MarkdownOptions & RunMode = {},
): string | PageChunk[] {
  const {
    pages: pageList,
    writeImages = false,
    embedImages = false,
    forceText = true,
    pageChunks = false,
    pageSeparators = false,
    ignoreCode = false,
    showProgress = false,
    fontsizeLimit,
    removeRotation: shouldRemoveRotation = true,
  } = opts;

  const elementSet = opts.elements ? new Set(opts.elements) : null;
  const isEl = (e: MarkdownElement) => elementSet === null || elementSet.has(e);
  const cellStyle: CellStyle = {
    bold: isEl("bold"),
    italic: isEl("italic"),
    inlineCode: isEl("inlineCode"),
    lineBreak: isEl("lineBreak"),
  };
  // When tables aren't whitelisted we skip detection entirely (like
  // `tableStrategy: null`), so the cell text flows back into the normal
  // paragraph stream instead of being dropped.
  const detectTables = opts.tableStrategy !== null && isEl("table");

  if (!writeImages && !embedImages && !forceText) {
    throw new Error("Images and text on images cannot both be suppressed.");
  }

  // Bake form fields / annotations (mirrors pymupdf_rag.py:409-410)
  try {
    if (doc.isPDF()) doc.bake();
  } catch {
    // tolerate older versions
  }

  const pages = pageList ?? Array.from({ length: doc.countPages() }, (_, i) => i);
  const filename = opts.filename ?? "";

  // Header info
  let hdrProvider: HeaderIdProvider | ((s: Span) => string) | false;
  if (opts.hdrInfo === false) {
    hdrProvider = false;
  } else if (typeof opts.hdrInfo === "function") {
    hdrProvider = opts.hdrInfo;
  } else if (opts.hdrInfo && typeof opts.hdrInfo.get_header_id === "function") {
    hdrProvider = opts.hdrInfo;
  } else {
    hdrProvider = new IdentifyHeaders(doc);
  }
  const getHeaderId = (s: Span, _p: PageContext): string => {
    if (hdrProvider === false) return "";
    if (typeof hdrProvider === "function") return hdrProvider(s);
    return hdrProvider.get_header_id(s, _p);
  };

  const document_output: string[] = [];
  const chunk_output: PageChunk[] = [];

  const margins: [number, number, number, number] = (() => {
    const m = opts.margins;
    if (m == null) return [0, 0, 0, 0];
    if (typeof m === "number") return [m, m, m, m];
    if (m.length === 2) return [0, m[0], 0, m[1]];
    return m;
  })();

  const pageIter: Iterable<number> = showProgress
    ? new ProgressBar(pages, { prefix: "pages " })
    : pages;

  for (const pno of pageIter) {
    let page = doc.loadPage(pno) as mupdf.PDFPage;
    const prevRotation = shouldRemoveRotation ? removeRotation(doc, page) : 0;
    // remove_rotation bakes a derotation matrix into the content stream and
    // swaps the MediaBox; reload so getBounds() reflects the new page box.
    if (prevRotation !== 0) page = doc.loadPage(pno) as mupdf.PDFPage;
    {
      const rectBounds = page.getBounds();
      const pageRect = new Rect(rectBounds[0], rectBounds[1], rectBounds[2], rectBounds[3]);
      const [left, top, right, bottom] = margins;
      const clip = new Rect(
        pageRect.x0 + left,
        pageRect.y0 + top,
        pageRect.x1 - right,
        pageRect.y1 - bottom,
      );

      const links = getLinks(page);
      const td = extractTextDict(page, {});

      // Drawings + images via custom Device (lines_strict tables + image regions)
      let tabs: TableData[] = [];
      const tab_rects = new Map<number, Rect>();
      const tab_rects0: Rect[] = [];
      const pageImages: { bbox: Rect; ref: string; width: number; height: number }[] = [];
      if (detectTables || opts.writeImages || opts.embedImages) {
        try {
          const { paths, images } = extractDrawings(page);
          if (detectTables) {
            tabs = findTables(td.blocks, paths, clip, {
              strategy: opts.tableStrategy ?? "lines_strict",
              explicitGrid: opts.explicitTableGrids,
            });
            tabs.forEach((t, i) => {
              const r = Rect.from(t.bbox).union(t.header.bbox);
              tab_rects.set(i, r);
              tab_rects0.push(r);
            });
          }
          if (opts.writeImages || opts.embedImages) {
            const deduped = dedupeImages(images);
            deduped.forEach((img, i) => {
              const rect = Rect.from(img.bbox as unknown as readonly number[]);
              if (rect.isEmpty || !rect.isValid) return;
              const ref = renderPageImage(page, pno, rect.intersect(clip), i, {
                writeImages: opts.writeImages,
                embedImages: opts.embedImages,
                imagePath: opts.imagePath,
                imageFormat: opts.imageFormat === "jpeg" ? "jpg" : opts.imageFormat,
                dpi: opts.dpi,
                imageSizeLimit: opts.imageSizeLimit,
                filename,
              });
              if (ref) {
                pageImages.push({ bbox: rect, ref, width: img.width, height: img.height });
              }
            });
          }
        } catch (e) {
          // tolerate per-page detection failures; surface only with DEBUG_MUPDF4LLM=1
          if (process.env.DEBUG_MUPDF4LLM) console.error("[mupdf4llm] drawings/tables:", e);
        }
      }

      const parms: PageParams = {
        page,
        pageNumber: pno,
        filename,
        md_string: "",
        clip,
        accept_invisible: opts.ignoreAlpha ?? false,
        links,
        tab_rects,
        tab_rects0,
        img_rects: pageImages.map((p) => p.bbox),
        written_tables: new Set(),
        written_images: new Set(),
        line_rects: [],
        blocks: td.blocks,
        tabs,
        fontsizeLimit,
      };

      const pageCtx: PageContext = { number: pno, rect: pageRect };

      // Determine text rectangles via columnBoxes. avoid + noImageText mirror
      // upstream pymupdf_rag.py:1140 (without these the multi-column heuristic
      // doesn't know to skip table regions, and the early-page-of-spans pass
      // doesn't suppress text on top of images).
      const text_rects = columnBoxes(td.blocks, {
        clip,
        avoid: tab_rects0,
        noImageText: !forceText,
        ignoreImages: opts.writeImages || opts.embedImages,
        footerMargin: margins[3],
        headerMargin: margins[1],
      });
      const rects = text_rects.length ? text_rects : [clip];

      for (const tr of rects) {
        parms.md_string += writeText(parms, tr, getHeaderId, pageCtx, {
          ignoreCode,
          forceText,
          tables: detectTables,
          isEl,
          cellStyle,
        });
      }

      parms.md_string = parms.md_string.replace(/ ,/g, ",").replace(/-\n/g, "");

      // emit any remaining tables (those not picked up above a text block)
      // tab_rects is only populated when detectTables is true.
      for (const [i] of parms.tab_rects) {
        if (parms.written_tables.has(i)) continue;
        parms.md_string += parms.tabs[i]!.to_markdown(false, cellStyle) + "\n";
        parms.written_tables.add(i);
      }

      // Emit images after text + tables. `ref` is either a relative file path
      // (write_images) or a data: URL (embed_images). Alt text is empty to
      // match upstream's `GRAPHICS_TEXT = "\n![](%s)\n"`.
      if (isEl("image")) {
        for (const p of pageImages) {
          if (!p.ref) continue;
          parms.md_string += `\n![](${p.ref})\n`;
        }
      }

      while (parms.md_string.startsWith("\n")) parms.md_string = parms.md_string.slice(1);
      parms.md_string = parms.md_string.replaceAll("\x00", REPLACEMENT_CHARACTER);

      if (pageSeparators) {
        parms.md_string += `\n\n--- end of page=${pno} ---\n\n`;
      }

      if (pageChunks) {
        const metadata = getMetadata(doc, filename, pno);
        const toc = getToc(doc);
        const page_tocs = toc.filter((t) => t[2] === pno + 1);
        const words = opts.extractWords ? extractWords(page) : [];
        chunk_output.push({
          metadata,
          toc_items: page_tocs,
          tables: parms.tabs.map((t) => ({
            bbox: t.bbox,
            rows: t.row_count,
            columns: t.col_count,
          })),
          images: pageImages.map((p, i) => ({
            bbox: p.bbox,
            width: p.width,
            height: p.height,
            number: i,
            ref: p.ref,
          })),
          text: parms.md_string,
          words,
        });
      } else {
        document_output.push(parms.md_string);
      }
    }
    // No rotation restore: remove_rotation bakes the derotation into the
    // content stream, so re-adding /Rotate would double-rotate. The document
    // is loaded from an in-memory buffer and never written back, so the input
    // file on disk is untouched regardless.
  }

  if (pageChunks) return chunk_output;
  return document_output.join("");
}
