import * as mupdf from "mupdf";
import type { Rect } from "../geometry";

/** An 8-bit grayscale image handed to an {@link OcrEngine}. */
export interface OcrImage {
  width: number;
  height: number;
  /** One byte per pixel, row-major, 0 = black, 255 = white. */
  data: Uint8Array;
  /** The same image encoded as PNG. */
  png(): Uint8Array;
}

/**
 * Pluggable OCR backend. The library calls `recognize` once per table cell
 * and uses the returned text as the cell content (lines separated by `\n`).
 * An exception or an empty string marks the cell as `"failed"`.
 */
export interface OcrEngine {
  recognize(image: OcrImage): Promise<string>;
  /** Release models and native resources. Called only for engines the library created itself. */
  dispose?(): Promise<void> | void;
}

/** White margin (px) added around a crop; text detectors expect some background. */
const PAD = 8;
/** Pixel value below which a pixel counts as ink. */
export const INK = 160;

/** A page rendered to grayscale, with the mapping between page and pixel coordinates. */
export class PageRaster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  /** Pixels per point. */
  readonly scale: number;
  private readonly ox: number;
  private readonly oy: number;

  constructor(data: Uint8Array, width: number, height: number, scale: number, ox = 0, oy = 0) {
    this.data = data;
    this.width = width;
    this.height = height;
    this.scale = scale;
    this.ox = ox;
    this.oy = oy;
  }

  static render(page: mupdf.Page, dpi: number): PageRaster {
    const scale = dpi / 72;
    const pm = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceGray, false);
    try {
      const w = pm.getWidth();
      const h = pm.getHeight();
      const stride = pm.getStride();
      const src = pm.getPixels();
      const data = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) data.set(src.subarray(y * stride, y * stride + w), y * w);
      return new PageRaster(data, w, h, scale, pm.getX(), pm.getY());
    } finally {
      pm.destroy();
    }
  }

  /** Page x of the center of pixel column `px`. */
  pageX(px: number): number {
    return (px + this.ox + 0.5) / this.scale;
  }

  /** Page y of the center of pixel row `py`. */
  pageY(py: number): number {
    return (py + this.oy + 0.5) / this.scale;
  }

  /**
   * Crop `rect` (page coordinates) for OCR. Ruling lines left on the crop
   * border are trimmed. Returns null when the area holds no ink.
   */
  crop(rect: Rect): OcrImage | null {
    const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, Math.round(v)));
    // Stay one point inside the cell, off the ruling lines.
    let x0 = clamp((rect.x0 + 1) * this.scale - this.ox, this.width);
    let x1 = clamp((rect.x1 - 1) * this.scale - this.ox, this.width);
    let y0 = clamp((rect.y0 + 1) * this.scale - this.oy, this.height);
    let y1 = clamp((rect.y1 - 1) * this.scale - this.oy, this.height);
    const ink = (i: number) => this.data[i]! < INK;
    const rowInk = (y: number) => {
      let n = 0;
      for (let x = x0; x < x1; x++) if (ink(y * this.width + x)) n++;
      return n / Math.max(1, x1 - x0);
    };
    const colInk = (x: number) => {
      let n = 0;
      for (let y = y0; y < y1; y++) if (ink(y * this.width + x)) n++;
      return n / Math.max(1, y1 - y0);
    };
    // Remaining pieces of thick or slightly skewed rules: mostly-dark border rows/columns.
    const maxTrim = Math.ceil(this.scale * 2);
    for (let i = 0; i < maxTrim && y1 - y0 > 2 && rowInk(y0) > 0.5; i++) y0++;
    for (let i = 0; i < maxTrim && y1 - y0 > 2 && rowInk(y1 - 1) > 0.5; i++) y1--;
    for (let i = 0; i < maxTrim && x1 - x0 > 2 && colInk(x0) > 0.5; i++) x0++;
    for (let i = 0; i < maxTrim && x1 - x0 > 2 && colInk(x1 - 1) > 0.5; i++) x1--;
    if (x1 - x0 < 2 || y1 - y0 < 2) return null;

    let dark = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (ink(y * this.width + x)) dark++;
    // A few specks of scan noise are not text.
    if (dark < Math.max(4, this.scale * this.scale)) return null;

    const w = x1 - x0 + 2 * PAD;
    const h = y1 - y0 + 2 * PAD;
    const data = new Uint8Array(w * h).fill(255);
    for (let y = y0; y < y1; y++) {
      data.set(
        this.data.subarray(y * this.width + x0, y * this.width + x1),
        (y - y0 + PAD) * w + PAD,
      );
    }
    return grayImage(data, w, h);
  }
}

/** Wrap a grayscale buffer as an {@link OcrImage}. */
export function grayImage(data: Uint8Array, width: number, height: number): OcrImage {
  let png: Uint8Array | null = null;
  return {
    width,
    height,
    data,
    png() {
      if (png) return png;
      const pm = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, width, height], false);
      try {
        const px = pm.getPixels();
        const stride = pm.getStride();
        for (let y = 0; y < height; y++)
          px.set(data.subarray(y * width, (y + 1) * width), y * stride);
        png = pm.asPNG().slice();
      } finally {
        pm.destroy();
      }
      return png;
    },
  };
}
