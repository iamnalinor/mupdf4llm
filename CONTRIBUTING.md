# Contributing

## Local development

Prerequisites:

- [Bun](https://bun.sh) ≥ 1.0
- Python 3.10+ with `pymupdf4llm` installed
  (`pip install pymupdf4llm`) — the parity tests spawn it to compare
  byte-for-byte output.

Setup:

```sh
bun install
pip install pymupdf4llm
```

Loop:

```sh
bun run typecheck    # tsc --noEmit
bun test             # bun:test, runs tests/parity.test.ts
bun run build        # emits dist/{index.js,index.cjs,index.d.ts}
```

## Project layout

```
src/
  index.ts            public API
  rag.ts              main toMarkdown loop (pymupdf_rag.py)
  textPage.ts         StructuredText → PyMuPDF-shaped blocks/lines/spans
  getTextLines.ts     get_text_lines.py port
  multiColumn.ts      multi_column.py port
  identifyHeaders.ts  IdentifyHeaders class
  drawingDevice.ts    custom mupdf.Device for paths and images
  tableFinder.ts      lines_strict table detector
  geometry.ts         Rect / Point with PyMuPDF-style operators
  utils.ts            isWhite, bbox helpers, etc.
  constants.ts        WHITE_CHARS, BULLETS, font flag bits
  types.ts            TypeScript interfaces
tests/
  parity.test.ts      bun:test — diffs TS output vs pymupdf4llm
scripts/
  probe.ts / probe.py manual diff helpers
```

Every public function should keep parity with its Python counterpart;
when in doubt, add a fixture in `tests/parity.test.ts` that regenerates
on first run and asserts strict equality with `pymupdf4llm.to_markdown`.

## Releasing to npm

One-time setup:

1. `npm login` from your machine, or generate an npm
   [Automation Token](https://docs.npmjs.com/creating-and-viewing-access-tokens)
   and add it as the `NPM_TOKEN` repository secret on GitHub.
2. On npmjs.com, open the package's settings and enable
   [provenance](https://docs.npmjs.com/generating-provenance-statements)
   for OIDC trust with GitHub Actions.

Per release:

```sh
# bump version (commit + tag)
npm version patch        # or minor / major

# push branch and tag
git push && git push --tags
```

The tag (`v*.*.*`) triggers `.github/workflows/release.yml`, which:

1. Runs `bun run typecheck && bun test && bun run build`.
2. Runs `npm publish --provenance --access public` with `NODE_AUTH_TOKEN`
   set from `NPM_TOKEN`.

If the publish step is skipped (e.g. the secret isn't set yet), the
build artifacts are still produced; you can run `npm publish` manually
from a local checkout after `bun run build`.

## License

By contributing you agree that your contributions are licensed under
the [GNU Affero General Public License v3.0 or later](LICENSE).
