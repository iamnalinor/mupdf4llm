import * as mupdf from "mupdf";
import { Rect } from "./geometry";
import type { DrawingPath, ImageInfo } from "./types";

function colorToRGB(color: number[] | null | undefined): [number, number, number] | null {
  if (!color) return null;
  if (color.length === 1) return [color[0]!, color[0]!, color[0]!];
  if (color.length >= 3) return [color[0]!, color[1]!, color[2]!];
  return null;
}

function transformBounds(ctm: mupdf.Matrix, bounds: number[]): Rect {
  // Apply ctm to the 4 corners of the bounds and take the axis-aligned envelope.
  // bounds = [x0,y0,x1,y1]
  const [a, b, c, d, e, f] = ctm;
  const corners: [number, number][] = [
    [bounds[0]!, bounds[1]!],
    [bounds[2]!, bounds[1]!],
    [bounds[0]!, bounds[3]!],
    [bounds[2]!, bounds[3]!],
  ];
  const xs = corners.map(([x, y]) => a * x + c * y + e);
  const ys = corners.map(([x, y]) => b * x + d * y + f);
  return new Rect(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
}

export interface PageDrawings {
  paths: DrawingPath[];
  images: ImageInfo[];
}

/** Run a custom Device against a page to recover drawings and image-info. */
export function extractDrawings(page: mupdf.Page): PageDrawings {
  const paths: DrawingPath[] = [];
  const images: ImageInfo[] = [];
  let imageCounter = 0;

  const dev = new mupdf.Device({
    fillPath(path, _evenOdd, ctm, _cs, color, _alpha) {
      const b = path.getBounds(null as unknown as mupdf.StrokeState, ctm);
      const rect = new Rect(b[0], b[1], b[2], b[3]);
      if (!rect.isValid) return;
      paths.push({
        type: "f",
        rect,
        fill: colorToRGB(color as unknown as number[]),
        color: null,
        width: null,
        stroked: false,
        filled: true,
      });
    },
    strokePath(path, stroke, ctm, _cs, color, _alpha) {
      const b = path.getBounds(stroke, ctm);
      const rect = new Rect(b[0], b[1], b[2], b[3]);
      if (!rect.isValid) return;
      paths.push({
        type: "s",
        rect,
        fill: null,
        color: colorToRGB(color as unknown as number[]),
        width: stroke.getLineWidth(),
        stroked: true,
        filled: false,
      });
    },
    fillImage(image, ctm, _alpha) {
      const rect = transformBounds(ctm, [0, 0, 1, 1]);
      images.push({
        bbox: rect,
        width: image.getWidth(),
        height: image.getHeight(),
        number: imageCounter++,
      });
    },
    fillImageMask(image, ctm) {
      const rect = transformBounds(ctm, [0, 0, 1, 1]);
      images.push({
        bbox: rect,
        width: image.getWidth(),
        height: image.getHeight(),
        number: imageCounter++,
      });
    },
  });

  try {
    page.run(dev, mupdf.Matrix.identity);
  } finally {
    dev.close();
    dev.destroy();
  }
  return { paths, images };
}
