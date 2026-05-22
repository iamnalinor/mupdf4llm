import type { Rect, BBox } from "./geometry";

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

export interface ImageInfo {
  bbox: Rect;
  width: number;
  height: number;
  number: number;
  /** Set when writeImages/embedImages emitted a file path or data URI. */
  ref?: string;
}

export interface TableData {
  bbox: BBox;
  header: { bbox: BBox; cells: (BBox | null)[]; external: boolean };
  cells: (BBox | null)[][];
  row_count: number;
  col_count: number;
  to_markdown(clean?: boolean): string;
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
  ignoreImages?: boolean;
  ignoreGraphics?: boolean;
  detectBgColor?: boolean;
  imagePath?: string;
  imageFormat?: "png" | "jpeg";
  imageSizeLimit?: number;
  filename?: string | null;
  forceText?: boolean;
  pageChunks?: boolean;
  pageSeparators?: boolean;
  margins?: number | [number, number] | [number, number, number, number];
  dpi?: number;
  pageWidth?: number;
  pageHeight?: number;
  tableStrategy?: "lines_strict" | "lines" | "text" | "explicit" | null;
  /** Explicit grid coordinates for `tableStrategy: "explicit"`. */
  explicitTableGrids?: { hLines: number[]; vLines: number[] }[];
  graphicsLimit?: number | null;
  fontsizeLimit?: number;
  ignoreCode?: boolean;
  extractWords?: boolean;
  showProgress?: boolean;
  useGlyphs?: boolean;
  ignoreAlpha?: boolean;
  removeRotation?: boolean;
}

export interface PageContext {
  number: number;
  rect: Rect;
}

export interface PageChunk {
  metadata: Record<string, unknown>;
  toc_items: [number, string, number][];
  tables: { bbox: BBox; rows: number; columns: number }[];
  images: ImageInfo[];
  graphics: DrawingPath[];
  text: string;
  words: unknown[];
}
