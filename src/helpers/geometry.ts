export type BBox = [number, number, number, number];
export type Pt = [number, number];

export class Rect {
  constructor(public x0: number, public y0: number, public x1: number, public y1: number) {}

  static from(a: BBox | Rect | readonly number[]): Rect {
    if (a instanceof Rect) return new Rect(a.x0, a.y0, a.x1, a.y1);
    return new Rect(a[0] as number, a[1] as number, a[2] as number, a[3] as number);
  }

  static empty(): Rect {
    return new Rect(0, 0, -1, -1);
  }

  get width(): number {
    return this.x1 - this.x0;
  }
  get height(): number {
    return this.y1 - this.y0;
  }
  get isEmpty(): boolean {
    return this.x0 >= this.x1 || this.y0 >= this.y1;
  }
  get isValid(): boolean {
    return this.x0 <= this.x1 && this.y0 <= this.y1;
  }
  get tl(): Point {
    return new Point(this.x0, this.y0);
  }
  get br(): Point {
    return new Point(this.x1, this.y1);
  }
  get irect(): Rect {
    return new Rect(Math.floor(this.x0), Math.floor(this.y0), Math.ceil(this.x1), Math.ceil(this.y1));
  }
  // |r| in pymupdf — area
  get area(): number {
    return Math.max(0, this.width) * Math.max(0, this.height);
  }

  contains(o: Rect | BBox | Point | Pt | readonly number[]): boolean {
    if (o instanceof Point) {
      return o.x >= this.x0 && o.x <= this.x1 && o.y >= this.y0 && o.y <= this.y1;
    }
    if (o instanceof Rect) {
      return this.x0 <= o.x0 && this.y0 <= o.y0 && this.x1 >= o.x1 && this.y1 >= o.y1;
    }
    if (o.length === 2) {
      return (o[0] as number) >= this.x0 && (o[0] as number) <= this.x1 && (o[1] as number) >= this.y0 && (o[1] as number) <= this.y1;
    }
    return this.x0 <= (o[0] as number) && this.y0 <= (o[1] as number) && this.x1 >= (o[2] as number) && this.y1 >= (o[3] as number);
  }

  intersects(o: Rect | BBox | readonly number[]): boolean {
    const [x0, y0, x1, y1] = o instanceof Rect ? [o.x0, o.y0, o.x1, o.y1] : (o as readonly number[]);
    return !(this.x0 >= x1! || x0! >= this.x1 || this.y0 >= y1! || y0! >= this.y1);
  }

  intersect(o: Rect | BBox | readonly number[]): Rect {
    const [x0, y0, x1, y1] = o instanceof Rect ? [o.x0, o.y0, o.x1, o.y1] : (o as readonly number[]);
    return new Rect(Math.max(this.x0, x0!), Math.max(this.y0, y0!), Math.min(this.x1, x1!), Math.min(this.y1, y1!));
  }

  union(o: Rect | BBox | readonly number[]): Rect {
    const [x0, y0, x1, y1] = o instanceof Rect ? [o.x0, o.y0, o.x1, o.y1] : (o as readonly number[]);
    return new Rect(Math.min(this.x0, x0!), Math.min(this.y0, y0!), Math.max(this.x1, x1!), Math.max(this.y1, y1!));
  }

  // mutating union (Python `r |= s`)
  unionInPlace(o: Rect | BBox | readonly number[]): this {
    const [x0, y0, x1, y1] = o instanceof Rect ? [o.x0, o.y0, o.x1, o.y1] : (o as readonly number[]);
    this.x0 = Math.min(this.x0, x0!);
    this.y0 = Math.min(this.y0, y0!);
    this.x1 = Math.max(this.x1, x1!);
    this.y1 = Math.max(this.y1, y1!);
    return this;
  }

  inflate(d: number): Rect {
    return new Rect(this.x0 - d, this.y0 - d, this.x1 + d, this.y1 + d);
  }

  addDelta(dx0: number, dy0: number, dx1: number, dy1: number): Rect {
    return new Rect(this.x0 + dx0, this.y0 + dy0, this.x1 + dx1, this.y1 + dy1);
  }

  normalize(): Rect {
    return new Rect(
      Math.min(this.x0, this.x1),
      Math.min(this.y0, this.y1),
      Math.max(this.x0, this.x1),
      Math.max(this.y0, this.y1),
    );
  }

  equals(o: Rect | BBox): boolean {
    const [x0, y0, x1, y1] = o instanceof Rect ? [o.x0, o.y0, o.x1, o.y1] : o;
    return this.x0 === x0 && this.y0 === y0 && this.x1 === x1 && this.y1 === y1;
  }

  clone(): Rect {
    return new Rect(this.x0, this.y0, this.x1, this.y1);
  }

  toTuple(): BBox {
    return [this.x0, this.y0, this.x1, this.y1];
  }

  toString(): string {
    return `Rect(${this.x0}, ${this.y0}, ${this.x1}, ${this.y1})`;
  }
}

export class Point {
  constructor(public x: number, public y: number) {}
  add(o: Point | Pt): Point {
    const [x, y] = o instanceof Point ? [o.x, o.y] : o;
    return new Point(this.x + x, this.y + y);
  }
  div(s: number): Point {
    return new Point(this.x / s, this.y / s);
  }
}
