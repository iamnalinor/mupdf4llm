# Contributing

## Local development

Prerequisites:

- [Bun](https://bun.sh) ≥ 1.0 (also works on Node ≥ 20, but the test
  runner uses `bun:test`)
- Python 3.10+ with `pymupdf4llm` installed
  (`pip install pymupdf4llm`) — the parity tests spawn `python3 -c "..."`
  to compare byte-for-byte output

Setup:

```sh
bun install
pip install pymupdf4llm
```

Inner loop:

```sh
bun test               # 15 tests across parity, real fixtures, units
bun run lint           # prettier --write . && eslint . && tsc --noEmit
bun run lint:check     # CI-style — fails on style drift instead of fixing it
bun run build          # emits dist/{index,llama}.{js,cjs,d.ts}
```

Docs:

```sh
bun run docs:dev       # hot-reload preview at http://localhost:5173
bun run docs:build     # static build to docs/.vitepress/dist
bun run docs:api       # regenerate docs/reference/api/ from TS types
```

## Project layout

```
src/
  index.ts                  public API entry point
  helpers/
    pymupdfRag.ts           main toMarkdown orchestrator (pymupdf_rag.py)
    types.ts                shared TS interfaces
    constants.ts            WHITE_CHARS, BULLETS, font flag bits
    geometry.ts             Rect / Point primitives
    utils.ts                isWhite, bbox helpers, reading-order helpers
    progress.ts             ProgressBar
    text/                   text-stream extraction
      textPage.ts           StructuredText → blocks/lines/spans
      getTextLines.ts       get_text_lines.py port
      extractWords.ts       per-word coordinates
      identifyHeaders.ts    IdentifyHeaders + TocHeaders
    tables/                 table detection
      tableFinder.ts        4 strategies (lines_strict / lines / text / explicit)
      drawingDevice.ts      custom mupdf.Device used by tables and images
    layout/                 page-level layout
      multiColumn.ts        column box detection
      pageRotation.ts       /Rotate get / set / remove
    images/
      imageExtract.ts       renderPageImage + dedupeImages
    forms/
      formFields.ts         getKeyValues — port of utils.get_key_values
  llama/
    pdfMarkdownReader.ts    LlamaIndex adapter (mupdf4llm/llama subpath)
  ocr/
    README.md               why no OCR + tesseract.js recipe
tests/
  parity.test.ts            synthetic PyMuPDF-generated fixtures, exact parity
  realFixtures.test.ts      real PDFs from py-pdf/sample-files, tiered parity
  units.test.ts             unit tests for utils, geometry, progress, headers
  fixtures/                 vendored real-world PDFs (MIT)
docs/                       VitePress + TypeDoc documentation site
scripts/
  probe.ts / probe.py       manual diff helpers
```

Every public function should keep parity with its Python counterpart;
when in doubt, add a fixture in `tests/parity.test.ts` (synthetic) or
`tests/realFixtures.test.ts` (vendored) and assert strict equality
against `pymupdf4llm.to_markdown`.

## Adding a feature

1. Write the implementation under the appropriate `src/helpers/`
   subdirectory (or add a new one if it doesn't fit existing
   concerns). Keep the file focused — a single feature per module.
2. Export the public surface via `src/index.ts`.
3. Add a unit test in `tests/units.test.ts` if it's small and pure.
   Add a parity fixture in `tests/parity.test.ts` if it touches the
   markdown rendering path and you want byte-for-byte parity.
4. Update the relevant guide page under `docs/guide/` (or add one).
5. Run `bun run lint` to format, `bun test` to verify, `bun run docs:build`
   to confirm the docs site still builds.

## Documentation

Documentation is built with [VitePress](https://vitepress.dev/) +
[`typedoc-plugin-markdown`](https://typedoc-plugin-markdown.org/).

- Hand-written guides live in `docs/guide/`, examples in
  `docs/examples/`, and the landing page is `docs/index.md`.
- The API reference under `docs/reference/api/` is auto-generated from
  `src/` by TypeDoc (configured in `typedoc.json`) and gitignored.
  Regenerate with `bun run docs:api`.
- The deploy workflow `.github/workflows/docs.yml` ships the static
  bundle to GitHub Pages on push to main. The repo's
  **Settings → Pages → Source** must be set to **GitHub Actions** once.

## CI

`.github/workflows/ci.yml` runs on every push and PR. Steps:

1. `bun install --frozen-lockfile`
2. `bun run lint:check` — Prettier + ESLint + tsc
3. `bun run docs:build` — smoke-test the docs site
4. `bun test` — 15 tests
5. `bun run build` — emit dist artifacts
6. `npm pack --dry-run` — verify the published tarball

## Releasing to npm

`release.yml` uses [Trusted Publishing](https://docs.npmjs.com/trusted-publishers)
— GitHub Actions authenticates to npm over OIDC, no long-lived
`NPM_TOKEN` is involved. The package must exist on npm and have
GitHub Actions configured as a trusted publisher before any automated
release can succeed.

### One-time setup

1. **Bootstrap the package on npm.** Trusted Publishing can only be
   attached to a package that already exists, so the very first
   publish is done locally:

   ```sh
   npm login                       # interactive 2FA via browser
   bun run build
   npm publish --access public     # no --provenance — local box has no OIDC
   ```

2. **Wire up Trusted Publishing.** On npmjs.com → the package's page →
   **Settings → Publishing access → Trusted publishers → Add trusted
   publisher → GitHub Actions**, and fill in:
   - Organization or user: `iamnalinor`
   - Repository: `mupdf4llm`
   - Workflow filename: `release.yml`
   - Environment name: _(leave empty unless you also add a GitHub
     Environment with required reviewers — see below)_

3. _(Optional)_ If you want a manual approval gate before each
   publish, create a GitHub Environment named `npm-publish` with
   protection rules and add `environment: npm-publish` to the
   `publish` job in `release.yml`. The npm trusted-publisher
   configuration must list the same environment name.

### Per release

```sh
npm version patch          # or minor / major — commits + creates a tag
git push && git push --tags
```

The `v*.*.*` tag triggers `.github/workflows/release.yml`, which:

1. Installs Bun, Node 24+ (for npm 11), and Python 3.11.
2. Upgrades npm globally to the latest (Trusted Publishing needs
   ≥ 11.5.1).
3. Runs `bun run lint:check && bun test && bun run build`.
4. Calls `npm publish --provenance --access public`. The npm CLI
   detects the OIDC token from GitHub Actions automatically — no env
   variables to set.

If the workflow fails at the publish step with an OIDC error, the
most common cause is the trusted-publisher row on npmjs.com not
matching the GitHub repository / workflow filename / environment.
Re-check those fields verbatim.

## License

By contributing you agree that your contributions are licensed under
the [GNU Affero General Public License v3.0 or later](LICENSE).
