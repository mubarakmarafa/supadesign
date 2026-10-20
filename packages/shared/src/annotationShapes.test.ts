import { describe, expect, it } from "vite-plus/test";

import {
  arrowPoints,
  ellipsePoints,
  isDeliberateShape,
  normalizeRect,
  polylinePath,
  unionRects,
} from "./annotationShapes.ts";

describe("ellipsePoints", () => {
  it("traces a closed ellipse inside the dragged box", () => {
    const points = ellipsePoints({ x: 0, y: 0 }, { x: 100, y: 50 });
    expect(points[0]).toEqual(points.at(-1));
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(-1e-9);
      expect(point.x).toBeLessThanOrEqual(100 + 1e-9);
      expect(point.y).toBeGreaterThanOrEqual(-1e-9);
      expect(point.y).toBeLessThanOrEqual(50 + 1e-9);
    }
  });
});

describe("arrowPoints", () => {
  it("draws the shaft, then both head sides from the tip", () => {
    const points = arrowPoints({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(points.slice(0, 2)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(points[3]).toEqual({ x: 100, y: 0 });
    // The head sides sit behind the tip, one on each side of the shaft.
    expect(points[2]!.x).toBeLessThan(100);
    expect(points[4]!.x).toBeLessThan(100);
    expect(Math.sign(points[2]!.y)).toBe(-Math.sign(points[4]!.y));
  });

  it("degrades to a point for a zero-length drag", () => {
    expect(arrowPoints({ x: 5, y: 5 }, { x: 5, y: 5 })).toHaveLength(2);
  });
});

describe("shape helpers", () => {
  it("joins points with straight segments", () => {
    expect(
      polylinePath([
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ]),
    ).toBe("M 0 0 L 10 5");
  });

  it("ignores stray clicks", () => {
    expect(isDeliberateShape({ x: 0, y: 0 }, { x: 3, y: 2 })).toBe(false);
    expect(isDeliberateShape({ x: 0, y: 0 }, { x: 0, y: 12 })).toBe(true);
  });
});

describe("unionRects", () => {
  it("pads the marks and keeps the box inside the frame", () => {
    expect(
      unionRects(
        [
          { x: 10, y: 30, width: 20, height: 10 },
          { x: 70, y: 60, width: 20, height: 30 },
        ],
        { width: 100, height: 100 },
      ),
    ).toEqual({ x: 0, y: 10, width: 100, height: 90 });
  });

  it("has no box without marks", () => {
    expect(unionRects([], { width: 100, height: 100 })).toBeNull();
  });

  it("spans a drag in any direction", () => {
    expect(normalizeRect({ x: 40, y: 10 }, { x: 10, y: 30 })).toEqual({
      x: 10,
      y: 10,
      width: 30,
      height: 20,
    });
  });
});
