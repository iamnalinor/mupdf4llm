import * as mupdf from "mupdf";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { Rect } from "./geometry";
import type { ImageInfo } from "./types";

export interface ImageExtractOpts {
  /** Save image files to this directory. Mutually exclusive with `embedImages`. */
  writeImages?: boolean;
  /** Encode each image as a base64 data URI inline in the markdown. */
  embedImages?: boolean;
  /** Output directory for write_images mode. */
  imagePath?: string;
  /** "png" or "jpg" / "jpeg". */
  imageFormat?: "png" | "jpg" | "jpeg";
  /** Source rendering DPI. */
  dpi?: number;
  /** Skip image regions smaller than this fraction of the page edge. */
  imageSizeLimit?: number;
  /** Filename used to disambiguate written image files. */
  filename?: string;
}

/**
 * Rasterize an image region of a page and either save it to disk or return a
 * `data:` URL. Mirrors the inline `save_image()` helper in
 * `pymupdf4llm.helpers.pymupdf_rag.to_markdown`.
 *
 * Returns the path (write_images) or data URI (embed_images), or "" when the
 * region was rejected (too small / both modes off / pixmap empty).
 */
export function renderPageImage(
  page: mupdf.PDFPage,
  pageNumber: number,
  rect: Rect,
  index: number,
  opts: ImageExtractOpts,
): string {
  const format = (opts.imageFormat ?? "png").toLowerCase();
  const ext = format === "jpeg" ? "jpg" : format;
  const dpi = opts.dpi ?? 150;
  const sizeLimit = opts.imageSizeLimit ?? 0.05;

  const pageBounds = page.getBounds();
  const pageW = pageBounds[2] - pageBounds[0];
  const pageH = pageBounds[3] - pageBounds[1];
  if (rect.width < pageW * sizeLimit || rect.height < pageH * sizeLimit) return "";

  if (!opts.writeImages && !opts.embedImages) return "";

  const scale = dpi / 72;
  const matrix: mupdf.Matrix = [scale, 0, 0, scale, -rect.x0 * scale, -rect.y0 * scale];
  const colorspace = (mupdf as unknown as { ColorSpace: { DeviceRGB: mupdf.ColorSpace } })
    .ColorSpace.DeviceRGB;
  const pix = page.toPixmap(matrix, colorspace, false);
  try {
    if (pix.getWidth() <= 0 || pix.getHeight() <= 0) return "";
    const bytes = ext === "jpg" ? pix.asJPEG(85) : pix.asPNG();

    if (opts.writeImages) {
      const dir = opts.imagePath ?? "";
      if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
      const base = opts.filename ? basename(opts.filename).replace(/ /g, "-") : "page";
      const file = join(dir || ".", `${base}-${pageNumber}-${index}.${ext}`);
      writeFileSync(file, bytes);
      return file.replace(/\\/g, "/");
    }
    // embed_images
    const mime = ext === "jpg" ? "jpeg" : "png";
    const b64 = Buffer.from(bytes).toString("base64");
    return `data:image/${mime};base64,${b64}`;
  } finally {
    pix.destroy();
  }
}

/**
 * Deduplicate image bbox list — drop any image fully contained inside a larger
 * one. Mirrors `extract_images_on_page_simple` in pymupdf_rag.py.
 */
export function dedupeImages(images: ImageInfo[]): ImageInfo[] {
  const sorted = [...images]
    .map((img) => ({ ...img, bbox: Rect.from(img.bbox as unknown as readonly number[]) }))
    .sort((a, b) => b.bbox.width * b.bbox.height - a.bbox.width * a.bbox.height);
  const kept: typeof sorted = [];
  for (const img of sorted) {
    if (img.bbox.isEmpty) continue;
    let contained = false;
    for (const bigger of kept) {
      if (bigger.bbox.contains(img.bbox)) {
        contained = true;
        break;
      }
    }
    if (!contained) kept.push(img);
  }
  return kept as ImageInfo[];
}
