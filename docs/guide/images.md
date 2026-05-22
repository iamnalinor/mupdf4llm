# Images

Two image-handling modes, mutually exclusive: write to disk
(`writeImages`) or inline as base64 (`embedImages`).

## Write to disk

```ts
toMarkdown(buf, {
  writeImages: true,
  imagePath: "out/images", // created if missing
  imageFormat: "png",
  dpi: 150,
  filename: "paper.pdf", // affects the generated filename prefix
});
```

Files are written as
`<imagePath>/<filename-basename>-<pageIndex>-<imageIndex>.<ext>` and
referenced from the Markdown as `![image-N-I](path)`.

## Inline as base64

```ts
toMarkdown(buf, { embedImages: true });
```

Each image becomes a `![image-N-I](data:image/png;base64,…)` link.
Useful when downstream consumers (LLMs, blob stores) can ingest the
markdown without filesystem access. Watch the size — embedding all
images in a PDF can blow up the markdown buffer by 10×+.

## Size threshold

`imageSizeLimit` (default `0.05`) skips images smaller than this
fraction of the corresponding page edge. Bump it to `0.1` if you want
only large figures, drop to `0.01` to keep everything.

```ts
toMarkdown(buf, { embedImages: true, imageSizeLimit: 0.1 });
```

## DPI

`dpi` (default `150`) controls how the bounding region is rasterized.
Lower = smaller files. Higher = sharper but bigger.

## Format

`imageFormat: "png" | "jpg" | "jpeg"`. JPEG uses quality `85`.

## Inspecting

```ts
const chunks = toMarkdownPages(buf, { writeImages: true, imagePath: "out" });
for (const c of chunks) {
  for (const img of c.images) {
    console.log(img.bbox, img.ref); // ref is the saved file path
  }
}
```

## Caveats

The bounding region is rasterized via `page.toPixmap` — what gets
embedded is the **page region**, not the original image stream. This
means surrounding text or vector overlays in that region also end up
in the snapshot. Pass a tighter `imageSizeLimit` to skip incidental
glyphs that happen to live next to figures.
