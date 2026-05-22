/**
 * Minimal text progress bar — mirrors `pymupdf4llm.helpers.progress.ProgressBar`.
 *
 * Wraps an iterable so consumers can do `for (const x of new ProgressBar(list))`
 * and see a progress line on stderr. Cosmetic only; the heavy work is in the
 * caller.
 */
export class ProgressBar<T> implements Iterable<T> {
  private items: T[];
  private width: number;
  private prefix: string;
  private stream: { write(s: string): void };

  constructor(items: Iterable<T>, opts: { width?: number; prefix?: string; stream?: { write(s: string): void } } = {}) {
    this.items = Array.isArray(items) ? items : Array.from(items);
    this.width = opts.width ?? 40;
    this.prefix = opts.prefix ?? "";
    this.stream = opts.stream ?? { write: (s: string) => process.stderr.write(s) };
  }

  get length(): number {
    return this.items.length;
  }

  *[Symbol.iterator](): IterableIterator<T> {
    const total = this.items.length;
    if (total === 0) return;
    for (let i = 0; i < total; i++) {
      this.render(i, total);
      yield this.items[i]!;
    }
    this.render(total, total);
    this.stream.write("\n");
  }

  private render(done: number, total: number): void {
    const ratio = total === 0 ? 1 : done / total;
    const filled = Math.round(this.width * ratio);
    const bar = "#".repeat(filled) + "-".repeat(this.width - filled);
    const pct = Math.round(ratio * 100).toString().padStart(3, " ");
    this.stream.write(`\r${this.prefix}[${bar}] ${pct}% (${done}/${total})`);
  }
}
