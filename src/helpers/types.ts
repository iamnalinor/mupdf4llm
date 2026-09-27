import type { Rect, BBox } from "./geometry";
import type { Word } from "./text/extractWords";
import type { OcrEngine } from "./ocr/engine";

export interface CharBBox {
  c: string;
  bbox: BBox;
  /**
   * The font instance on the page. Two embedded fonts can share a name (a
   * good and a broken copy of Helvetica); this tells them apart.
   */
  fontId?: number;
}

export interface Span {
  bbox: Rect;
  text: string;
  font: string;
  size: number;
  color: number;
  flags: number;
  char_flags: number;
  alpha: number;
  ascender: number;
  descender: number;
  origin: [number, number];
  /** Per-character bboxes; used by table cell extraction for >50% area-overlap filtering. */
  chars: CharBBox[];
  // injected by getRawLines
  line?: number;
  block?: number;
  dir?: [number, number];
}

export interface Line {
  bbox: BBox;
  dir: [number, number];
  wmode: number;
  spans: Span[];
}

export interface Block {
  type: 0 | 1 | 3;
  bbox: BBox;
  number?: number;
  lines: Line[];
  isrect?: boolean;
}

export interface TextDict {
  blocks: Block[];
}

export interface LinkInfo {
  kind: "uri" | "goto" | "other";
  uri: string;
  from: Rect;
}

export interface DrawingPath {
  type: "f" | "s" | "fs";
  rect: Rect;
  fill: [number, number, number] | null;
  color: [number, number, number] | null;
  width: number | null;
  stroked: boolean;
  filled: boolean;
}

/**
 * A ruling line recovered from vector graphics, stored as its centerline in
 * page coordinates. `width` is the visual line thickness.
 */
export type DrawingEdge =
  | { kind: "h"; x0: number; x1: number; y: number; width: number }
  | { kind: "v"; x: number; y0: number; y1: number; width: number };

export interface ImageInfo {
  bbox: Rect;
  width: number;
  height: number;
  number: number;
  /** Set when writeImages/embedImages emitted a file path or data URI. */
  ref?: string;
}

/** Inline styling toggles applied when rendering table cells. */
export interface CellStyle {
  bold: boolean;
  italic: boolean;
  inlineCode: boolean;
  lineBreak: boolean;
}

/** Where a table cell's text came from: the PDF text layer, OCR, or OCR that failed. */
export type CellSource = "pdf" | "ocr" | "failed";

export interface CellText {
  text: string;
  source: CellSource;
}

/** Where table cell text is taken from. See {@link MarkdownOptions.textSource}. */
export type TextSource = "pdf" | "ocr" | "auto";

export interface TableData {
  bbox: BBox;
  header: { bbox: BBox; cells: (BBox | null)[]; external: boolean };
  cells: (BBox | null)[][];
  row_count: number;
  col_count: number;
  to_markdown(clean?: boolean, style?: CellStyle): string;
  /** Plain text and source of every cell; `null` where a merged cell continues. */
  cellTexts(): (CellText | null)[][];
  /** Replace a cell's text (used for OCR results). */
  setCellText(row: number, col: number, text: CellText): void;
}

export interface FormField {
  page: number;
  name: string;
  label: string;
  value: string;
  type: "text" | "checkbox" | "radio" | "choice" | "signature" | "unknown";
  bbox: BBox;
}

export interface MarkdownOptions {
  pages?: number[];
  hdrInfo?:
    | { get_header_id(span: Span, page?: PageContext): string }
    | ((s: Span) => string)
    | false;
  writeImages?: boolean;
  embedImages?: boolean;
  imagePath?: string;
  imageFormat?: "png" | "jpg" | "jpeg";
  imageSizeLimit?: number;
  filename?: string | null;
  forceText?: boolean;
  pageSeparators?: boolean;
  margins?: number | [number, number] | [number, number, number, number];
  dpi?: number;
  /**
   * How tables are found. `"pixels"` finds ruling lines on the rendered page
   * instead of in the PDF drawings, so it works on scans.
   */
  tableStrategy?: "lines_strict" | "lines" | "text" | "explicit" | "pixels" | null;
  /**
   * Where table cell text comes from, independent of how the table was found:
   * - `"pdf"`: the PDF text layer.
   * - `"ocr"`: OCR of every cell; the text layer is ignored.
   * - `"auto"` (default): the text layer, and OCR for cells whose text is
   *   empty or looks broken (replacement or private-use characters, a letter
   *   of another script slipped into a word, mostly symbols). On a page
   *   without a text layer that is every cell. Left at the default, a page
   *   with a text layer keeps it when no OCR engine can be set up.
   *
   * The source of each cell is reported in `PageChunk.tables[].cells`.
   */
  textSource?: TextSource;
  /**
   * OCR engine for table cells. Defaults to RapidOCR (PP-OCRv5 via the
   * optional peer dependencies `ppu-paddle-ocr` + `onnxruntime-node`), which
   * is loaded on first use. Any object with `recognize(image)` works.
   */
  ocr?: OcrEngine;
  /**
   * With `tableStrategy: "pixels"`, turn a page without a text layer whose
   * lines run vertically (a sheet scanned sideways, /Rotate not set) before
   * its tables are read. Default `true`.
   */
  detectOrientation?: boolean;
  /** Resolution the page is rendered at for `"pixels"` and OCR. Default 300. */
  ocrDpi?: number;
  /** Explicit grid coordinates for `tableStrategy: "explicit"`. */
  explicitTableGrids?: { hLines: number[]; vLines: number[] }[];
  /** Skip spans whose font size is below this threshold (in pt). Mirrors upstream FONTSIZE_LIMIT. */
  fontsizeLimit?: number;
  ignoreCode?: boolean;
  extractWords?: boolean;
  showProgress?: boolean;
  /** Accept invisible (alpha=0) text. Currently a no-op — mupdf.js's walker does not expose alpha. */
  ignoreAlpha?: boolean;
  removeRotation?: boolean;
  /**
   * Whitelist of markdown elements to emit. When omitted, ALL elements are
   * emitted (backwards-compatible default). When provided, only the listed
   * elements are produced; everything else falls back to plain text.
   *
   * Combines with the legacy toggles (`ignoreCode`, `hdrInfo: false`,
   * `tableStrategy: null`, `writeImages`/`embedImages`): an element is emitted
   * only if BOTH the whitelist allows it AND no legacy option disabled it.
   */
  elements?: MarkdownElement[];
}

export type MarkdownElement =
  | "bold" // **...**
  | "italic" // _..._
  | "inlineCode" // `...` (monospaced span outside a code block)
  | "codeBlock" // ``` ... ``` (monospaced lines)
  | "header" // # ...
  | "bulletList" // - ...
  | "link" // [text](url)
  | "table" // markdown tables
  | "image" // ![](...)
  | "lineBreak"; // <br> inside table cells

export interface PageContext {
  number: number;
  rect: Rect;
}

export interface PageChunk {
  metadata: Record<string, unknown>;
  toc_items: [number, string, number][];
  tables: {
    bbox: BBox;
    rows: number;
    columns: number;
    /** Plain text and source of every cell; `null` where a merged cell continues. */
    cells: (CellText | null)[][];
  }[];
  images: ImageInfo[];
  text: string;
  /** Populated when MarkdownOptions.extractWords is true. */
  words: Word[];
}
