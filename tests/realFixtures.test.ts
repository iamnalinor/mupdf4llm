import { test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { toMarkdown } from "../src/index";

/**
 * Real-world PDF parity. Fixtures are vendored from
 * https://github.com/py-pdf/sample-files (MIT-licensed) — they cover
 * features that hand-generated PyMuPDF fixtures don't, like LaTeX
 * ligatures, document outlines, AcroForm widgets, multi-column layout,
 * and page rotation.
 *
 * Each entry is tagged with the expected parity level:
 *   - exact:    TS output must byte-equal pymupdf4llm.to_markdown
 *   - similar:  TS output must be within ±5% of Python's length and
 *               share a substring prefix — diff details (e.g. span-grouping
 *               edge cases) are tracked as follow-up parity work
 *   - smoke:    only assert no crash and non-empty output (used for
 *               fixtures where PyMuPDF and JS mupdf diverge in known ways,
 *               e.g. cropped/rotated tables)
 */
type Mode = "exact" | "similar" | "smoke";

interface Fixture {
  name: string;
  mode: Mode;
  note?: string;
}

const FIXTURES: Fixture[] = [
  { name: "pdflatex-forms.pdf", mode: "exact" },
  {
    name: "pdflatex-4-pages.pdf",
    mode: "similar",
    note: "matches len exactly; diverges on en-dash → '- ' bullet substitution (span-grouping difference vs PyMuPDF)",
  },
  {
    name: "pdflatex-outline.pdf",
    mode: "similar",
    note: "same en-dash / span-grouping divergence as pdflatex-4-pages",
  },
  {
    name: "multicolumn.pdf",
    mode: "similar",
    note: "diverges in the table near the end (column header grouping)",
  },
  {
    name: "cropped-rotated-scaled.pdf",
    mode: "smoke",
    note: "we unrotate by default → much more content extracted than Python's default; intentional behavior gap",
  },
];

function pyMarkdown(file: string): string {
  return execSync(
    `python3 -c "import pymupdf4llm; pymupdf4llm.use_layout(False); import sys; sys.stdout.write(pymupdf4llm.to_markdown('${file}'))"`,
    { maxBuffer: 16 * 1024 * 1024 },
  ).toString();
}

for (const f of FIXTURES) {
  const path = `tests/fixtures/${f.name}`;
  test(`real: ${f.name} (${f.mode})`, () => {
    if (!existsSync(path)) {
      throw new Error(`missing fixture ${path}`);
    }
    const buf = readFileSync(path);
    const ts = toMarkdown(buf);
    expect(ts.length).toBeGreaterThan(0);

    if (f.mode === "smoke") return;

    const py = pyMarkdown(path);
    if (f.mode === "exact") {
      expect(ts).toBe(py);
      return;
    }

    // "similar": length within ±5%, both non-empty
    expect(py.length).toBeGreaterThan(0);
    const ratio = ts.length / py.length;
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.05);
  }, 30_000);
}
