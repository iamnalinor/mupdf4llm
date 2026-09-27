import * as mupdf from "mupdf";
import { Rect } from "../geometry";

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
/** A pixel is ink when darker than this fraction of its local background. */
const INK_RATIO = 0.7;
/** Side of the tiles the background is estimated on (pt). */
const BG_TILE = 24;

/** A page rendered to grayscale, with the mapping between page and pixel coordinates. */
export class PageRaster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  /** Pixels per point. */
  readonly scale: number;
  private readonly ox: number;
  private readonly oy: number;
  private inkMap: Uint8Array | null = null;
  /** Pixels the despeckling removed from the ink (noise, specks). */
  private specks: Uint8Array | null = null;

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

  /**
   * 1 where a pixel is ink. The threshold follows the local paper tone
   * (tinted or grey paper, a shadow at the binding): the background of each
   * tile of BG_TILE points is its 90th brightness percentile, and a pixel is
   * ink when darker than INK_RATIO of that. Tiles filled with dark content
   * borrow the page's typical background. Isolated pixels are dropped.
   */
  get ink(): Uint8Array {
    if (this.inkMap) return this.inkMap;
    const { width: w, height: h, data } = this;
    const t = Math.max(8, Math.round(BG_TILE * this.scale));
    const tw = Math.ceil(w / t);
    const th = Math.ceil(h / t);
    const bg = new Float64Array(tw * th);
    const hist = new Uint32Array(256);
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        hist.fill(0);
        let n = 0;
        for (let y = ty * t; y < Math.min(h, (ty + 1) * t); y++) {
          for (let x = tx * t; x < Math.min(w, (tx + 1) * t); x++) {
            hist[data[y * w + x]!]!++;
            n++;
          }
        }
        let acc = 0;
        let v = 255;
        for (; v > 0; v--) {
          acc += hist[v]!;
          if (acc >= n * 0.1) break;
        }
        bg[ty * tw + tx] = v;
      }
    }
    const sorted = Array.from(bg).sort((a, b) => a - b);
    const typical = sorted[sorted.length >> 1] ?? 255;
    const map = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const b = Math.max(bg[Math.floor(y / t) * tw + Math.floor(x / t)]!, 0.8 * typical);
        if (data[y * w + x]! < b * INK_RATIO) map[y * w + x] = 1;
      }
    }
    // Scan noise and specks: an ink pixel with at most one inked neighbour
    // is dropped. Strokes of text and rules are several pixels wide at the
    // working resolution; on a coarse raster a pixel may be a whole stroke.
    if (this.scale < 3) {
      this.inkMap = map;
      return map;
    }
    const clean = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!map[i]) continue;
        const n =
          map[i - w - 1]! +
          map[i - w]! +
          map[i - w + 1]! +
          map[i - 1]! +
          map[i + 1]! +
          map[i + w - 1]! +
          map[i + w]! +
          map[i + w + 1]!;
        if (n >= 2) clean[i] = 1;
      }
    }
    const specks = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (map[i] && !clean[i]) specks[i] = 1;
    this.specks = specks;
    this.inkMap = clean;
    return clean;
  }

  /**
   * The page turned upright, when it was scanned askew (0.1° to 3°): the
   * angle is the one whose horizontal projection of the ink is sharpest, as
   * text lines and rules then fall into the fewest pixel rows. Pixel
   * coordinates of the result are those of the upright page, so grid and
   * crops must both come from it.
   */
  deskewed(): PageRaster {
    const angle = this.skew();
    if (Math.abs(angle) < 0.1) return this;
    const { width: w, height: h, data } = this;
    const a = (angle * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const out = new Uint8Array(w * h);
    const cx = w / 2;
    const cy = h / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Source position of the upright pixel (x, y); bilinear sampling.
        const dx = x - cx;
        const dy = y - cy;
        const sx = c * dx - s * dy + cx;
        const sy = s * dx + c * dy + cy;
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) {
          out[y * w + x] = 255;
          continue;
        }
        const fx = sx - x0;
        const fy = sy - y0;
        const i = y0 * w + x0;
        const top = data[i]! * (1 - fx) + data[i + 1]! * fx;
        const bot = data[i + w]! * (1 - fx) + data[i + w + 1]! * fx;
        out[y * w + x] = Math.round(top * (1 - fy) + bot * fy);
      }
    }
    return new PageRaster(out, w, h, this.scale, this.ox, this.oy);
  }

  /** Skew of the page content in degrees (clockwise positive), within ±3°. */
  skew(): number {
    const { width: w, height: h } = this;
    const ink = this.ink;
    // A sample of the ink is enough to find the angle.
    const step = Math.max(1, Math.round(this.scale / 2));
    const xs: number[] = [];
    const ys: number[] = [];
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        if (ink[y * w + x]) {
          xs.push(x - w / 2);
          ys.push(y);
        }
      }
    }
    if (xs.length < 100) return 0;
    const bins = new Float64Array(h + w);
    const score = (deg: number) => {
      const t = Math.tan((deg * Math.PI) / 180);
      bins.fill(0);
      for (let i = 0; i < xs.length; i++) {
        const r = Math.round((ys[i]! - xs[i]! * t) / step) + (w >> 1);
        if (r >= 0 && r < bins.length) bins[r]!++;
      }
      let sum = 0;
      for (const b of bins) sum += b * b;
      return sum;
    };
    let best = 0;
    let bestScore = score(0);
    for (let d = -3; d <= 3.0001; d += 0.2) {
      const v = score(d);
      if (v > bestScore) [best, bestScore] = [d, v];
    }
    const coarse = best;
    for (let d = coarse - 0.2; d <= coarse + 0.2001; d += 0.025) {
      const v = score(d);
      if (v > bestScore) [best, bestScore] = [d, v];
    }
    return best;
  }

  /** Page x of the center of pixel column `px`. */
  pageX(px: number): number {
    return (px + this.ox + 0.5) / this.scale;
  }

  /** Page y of the center of pixel row `py`. */
  pageY(py: number): number {
    return (py + this.oy + 0.5) / this.scale;
  }

  /** Pixel column containing page x, clamped to the raster. */
  pixelX(x: number): number {
    return Math.max(0, Math.min(this.width - 1, Math.floor(x * this.scale - this.ox)));
  }

  /** Pixel row containing page y, clamped to the raster. */
  pixelY(y: number): number {
    return Math.max(0, Math.min(this.height - 1, Math.floor(y * this.scale - this.oy)));
  }

  /** The rendered area in page coordinates. */
  get bounds(): Rect {
    return new Rect(
      this.ox / this.scale,
      this.oy / this.scale,
      (this.ox + this.width) / this.scale,
      (this.oy + this.height) / this.scale,
    );
  }

  /**
   * Crop `rect` (page coordinates) for OCR. Ruling lines left on the crop
   * border are trimmed. Returns null when the area holds no ink.
   */
  crop(rect: Rect): OcrImage | null {
    const box = this.inkBox(rect);
    return box && this.image(...box);
  }

  /**
   * The text lines inside `rect` (page coordinates), each cropped for OCR on
   * its own. Recognising line by line keeps short lines ("гия", "lex") that a
   * text detector drops from a multi-line crop. Empty when there is no ink.
   */
  cropLines(rect: Rect): OcrImage[] {
    const box = this.inkBox(rect);
    if (!box) return [];
    const [x0, y0, x1, y1] = box;
    const inkMap = this.ink;
    const rowInk = (y: number) => {
      let n = 0;
      for (let x = x0; x < x1; x++) n += inkMap[y * this.width + x]!;
      return n;
    };
    const bridge = Math.max(1, Math.round(this.scale));
    const minH = Math.max(3, this.scale * 3);
    const spans: [number, number][] = [];
    let a = -1;
    let b = -1;
    for (let y = y0; y < y1; y++) {
      if (!rowInk(y)) continue;
      if (a >= 0 && y - b - 1 <= bridge) b = y;
      else {
        if (a >= 0) spans.push([a, b + 1]);
        a = b = y;
      }
    }
    if (a >= 0) spans.push([a, b + 1]);
    // Leader dots, specks and stains are lower than a text line; stains are
    // also compact and faint next to the cell's text.
    const tallest = Math.max(0, ...spans.map(([ya, yb]) => yb - ya));
    const found: { box: [number, number, number, number]; ink: number }[] = [];
    for (const [ya, yb] of spans) {
      if (yb - ya < Math.max(minH, 0.5 * tallest)) continue;
      let xa = x1;
      let xb = x0;
      let ink = 0;
      for (let y = ya; y < yb; y++) {
        for (let x = x0; x < x1; x++) {
          if (inkMap[y * this.width + x]) {
            ink++;
            if (x < xa) xa = x;
            if (x + 1 > xb) xb = x + 1;
          }
        }
      }
      if (xb - xa >= 1.5 * (yb - ya)) found.push({ box: [xa, ya, xb, yb], ink });
    }
    const most = Math.max(0, ...found.map((f) => f.ink));
    // A text detector needs background around a line: a margin of about one
    // line height.
    const out = found
      .filter((f) => f.ink >= 0.08 * most)
      .map(({ box: [xa, ya, xb, yb] }) => this.image(xa, ya, xb, yb, PAD + (yb - ya)));
    // A single crop when nothing looked like a line (large glyphs, noise).
    if (!out.length) out.push(this.image(...box));
    return out;
  }

  /** Pixel box of the ink inside `rect`, off its ruling lines; null when blank. */
  private inkBox(rect: Rect): [number, number, number, number] | null {
    const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, Math.round(v)));
    // Stay one point inside the cell, off the ruling lines.
    let x0 = clamp((rect.x0 + 1) * this.scale - this.ox, this.width);
    let x1 = clamp((rect.x1 - 1) * this.scale - this.ox, this.width);
    let y0 = clamp((rect.y0 + 1) * this.scale - this.oy, this.height);
    let y1 = clamp((rect.y1 - 1) * this.scale - this.oy, this.height);
    const inkMap = this.ink;
    const ink = (i: number) => inkMap[i] === 1;
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
    // A thin rule fed askew runs along the edge from top to bottom, a pixel
    // column further in every few rows, so no single column is mostly ink.
    // Its track — the first ink from the edge in each row — is present in
    // nearly every row and nearly straight; text has blank rows between its
    // lines and above and below them.
    const reach = Math.ceil(this.scale * 3);
    const track = (
      from: number,
      dir: 1 | -1,
      lines: [number, number],
      along: (l: number, i: number) => boolean,
    ) => {
      const pos: number[] = [];
      for (let l = lines[0]; l < lines[1]; l++) {
        for (let d = 0; d < reach; d++) {
          if (along(l, from + dir * d)) {
            pos.push(d);
            break;
          }
        }
      }
      const n = lines[1] - lines[0];
      if (pos.length < 0.9 * n || n < 3 * reach) return 0;
      // Nearly straight: consecutive rows differ by at most a pixel or two.
      for (let i = 1; i < pos.length; i++) if (Math.abs(pos[i]! - pos[i - 1]!) > 2) return 0;
      return Math.max(...pos) + Math.ceil(this.scale);
    };
    const inkAt = (y: number, x: number) => ink(y * this.width + x);
    const inkAtT = (x: number, y: number) => ink(y * this.width + x);
    x0 += track(x0, 1, [y0, y1], inkAt);
    x1 -= track(x1 - 1, -1, [y0, y1], inkAt);
    y0 += track(y0, 1, [x0, x1], inkAtT);
    y1 -= track(y1 - 1, -1, [x0, x1], inkAtT);
    if (x1 - x0 < 2 || y1 - y0 < 2) return null;

    let dark = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (ink(y * this.width + x)) dark++;
    // A few specks of scan noise are not text.
    if (dark < Math.max(4, this.scale * this.scale)) return null;
    return [x0, y0, x1, y1];
  }

  /** The grey pixels of a box, with a white margin. */
  private image(x0: number, y0: number, x1: number, y1: number, pad = PAD): OcrImage {
    const w = x1 - x0 + 2 * pad;
    const h = y1 - y0 + 2 * pad;
    const data = new Uint8Array(w * h).fill(255);
    for (let y = y0; y < y1; y++) {
      data.set(
        this.data.subarray(y * this.width + x0, y * this.width + x1),
        (y - y0 + pad) * w + pad,
      );
    }
    // The OCR engine gets the page without the specks the ink map dropped.
    this.ink;
    const specks = this.specks;
    if (specks) {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (specks[y * this.width + x]) data[(y - y0 + pad) * w + (x - x0 + pad)] = 255;
        }
      }
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
