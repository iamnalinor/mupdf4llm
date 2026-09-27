import { grayImage, type OcrEngine, type OcrImage } from "./engine";

/** Model file locations (paths, URLs or buffers), as accepted by `ppu-paddle-ocr`. */
export interface RapidOcrModel {
  detection: string | ArrayBuffer;
  recognition: string | ArrayBuffer;
  charactersDictionary: string | ArrayBuffer;
}

export interface RapidOcrOptions {
  /**
   * Recognition model. A `ppu-paddle-ocr` preset name (`"v5-cyrillic-mobile"`,
   * `"v5-en-mobile"`, `"v5-latin-mobile"`, `"v6-small"`, …) or explicit model
   * files. Default `"v5-cyrillic-mobile"`: PP-OCRv5 for Cyrillic and Latin
   * text; on the test scans it read Russian and English better than the
   * `eslav` and `latin` models.
   */
  model?: string | RapidOcrModel;
}

/** OCR cannot run at all (package missing, bad model); raised instead of failing single cells. */
export class OcrSetupError extends Error {}

export const OCR_INSTALL_HINT = "npm install ppu-paddle-ocr onnxruntime-node";

// Kept out of static analysis so bundlers leave the optional peer alone.
const PACKAGE = "ppu-paddle-ocr";

/**
 * Default OCR engine: the RapidOCR stack (PaddleOCR PP-OCR models on ONNX
 * Runtime) through the optional peer dependencies `ppu-paddle-ocr` and
 * `onnxruntime-node`. Models are downloaded and cached on first use.
 *
 * Create one engine and pass it as `ocr` to reuse the loaded models across
 * documents; call `dispose()` when done.
 */
export async function createRapidOcr(opts: RapidOcrOptions = {}): Promise<OcrEngine> {
  let lib: any;
  try {
    lib = await import(PACKAGE);
  } catch (e) {
    throw new OcrSetupError(
      `OCR needs the optional packages ppu-paddle-ocr and onnxruntime-node: ${OCR_INSTALL_HINT}. ` +
        `Or pass your own engine as the \`ocr\` option.`,
      { cause: e },
    );
  }
  const name = opts.model ?? "v5-cyrillic-mobile";
  const model = typeof name === "string" ? lib.MODEL_PRESETS?.[name] : name;
  if (!model) throw new OcrSetupError(`Unknown ppu-paddle-ocr model preset: ${String(name)}`);
  const service = new lib.PaddleOcrService({ model });
  try {
    await service.initialize();
  } catch (e) {
    throw new OcrSetupError(`Failed to load the OCR models: ${String(e)}`, { cause: e });
  }
  return {
    async recognize(image) {
      // The detector misses lone narrow glyphs ("1", "|") in a small crop;
      // on an empty result, retry at double size.
      for (const img of [image, upscale(image)]) {
        const png = img.png();
        const buf = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
        // The package's result cache keys images by a sparse pixel sample,
        // which similar cell crops can share.
        const res = await service.recognize(buf, { noCache: true });
        const text = String(res.text ?? "").trim();
        if (text) return text;
      }
      return "";
    },
    async dispose() {
      await service.destroy();
    },
  };
}

/**
 * An engine that creates the real one on the first `recognize` call, so
 * documents whose tables need no OCR never load the models. `dispose` is a
 * no-op until then.
 */
export function lazyEngine(create: () => Promise<OcrEngine>): OcrEngine {
  let engine: Promise<OcrEngine> | null = null;
  return {
    async recognize(image) {
      engine ??= create();
      return (await engine).recognize(image);
    },
    async dispose() {
      const e = await engine?.catch(() => null);
      await e?.dispose?.();
    },
  };
}

/** Nearest-neighbour 2x enlargement. */
function upscale(img: OcrImage): OcrImage {
  const w = img.width * 2;
  const h = img.height * 2;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const src = (y >> 1) * img.width;
    for (let x = 0; x < w; x++) data[y * w + x] = img.data[src + (x >> 1)]!;
  }
  return grayImage(data, w, h);
}
