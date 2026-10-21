import { describe, expect, it } from "vite-plus/test";

import {
  commitDraft,
  eraseMarkAt,
  hasMarks,
  type MarkStyle,
  markupToolForKey,
  NO_MARKS,
  progressImageAnnotation,
} from "./progressMarkup.logic";

const update = {
  url: "http://localhost:5173/settings",
  createdAt: "2026-10-21T10:00:00.000Z",
  note: "Settings page with the new sidebar",
  width: 1000,
  height: 600,
};

/** An image shown at half size: two image pixels per screen pixel. */
const style = (id: string): MarkStyle => ({ id, color: "rgb(37, 99, 235)", width: 8, scale: 2 });

describe("commitDraft", () => {
  it("keeps a dragged box as a region in image pixels, in the color it was drawn in", () => {
    const marks = commitDraft(
      NO_MARKS,
      { tool: "box", start: { x: 300, y: 200 }, end: { x: 100, y: 100 } },
      style("box"),
    );
    expect(marks.regions).toEqual([
      { id: "box", color: "rgb(37, 99, 235)", rect: { x: 100, y: 100, width: 200, height: 100 } },
    ]);
    expect(marks.strokes).toEqual([]);
  });

  it("drops clicks too small to be marks on screen", () => {
    // Ten image pixels is five on screen: a deliberate box, but not a deliberate arrow.
    const tiny = { start: { x: 100, y: 100 }, end: { x: 110, y: 104 } };
    expect(commitDraft(NO_MARKS, { tool: "box", ...tiny }, style("box")).regions).toEqual([]);
    expect(commitDraft(NO_MARKS, { tool: "arrow", ...tiny }, style("arrow"))).toBe(NO_MARKS);
    expect(commitDraft(NO_MARKS, { tool: "pen", points: [{ x: 1, y: 1 }] }, style("pen"))).toBe(
      NO_MARKS,
    );
  });

  it("draws circles and arrows with corners and smooths pen strokes", () => {
    let marks = commitDraft(
      NO_MARKS,
      { tool: "circle", start: { x: 0, y: 0 }, end: { x: 100, y: 50 } },
      style("circle"),
    );
    marks = commitDraft(
      marks,
      {
        tool: "pen",
        points: [
          { x: 10, y: 10 },
          { x: 20, y: 30 },
          { x: 40, y: 35 },
        ],
      },
      style("pen"),
    );
    expect(marks.strokes.map((stroke) => stroke.id)).toEqual(["circle", "pen"]);
    expect(marks.smoothStrokeIds).toEqual(["pen"]);
    // The stroke's box leaves room for its line width.
    expect(marks.strokes[0]?.bounds.x).toBeLessThan(0);
  });
});

describe("eraseMarkAt", () => {
  it("removes the newest mark under the point and nothing else", () => {
    let marks = commitDraft(
      NO_MARKS,
      { tool: "box", start: { x: 0, y: 0 }, end: { x: 200, y: 200 } },
      style("box"),
    );
    marks = commitDraft(
      marks,
      { tool: "arrow", start: { x: 50, y: 50 }, end: { x: 150, y: 150 } },
      style("arrow"),
    );
    const once = eraseMarkAt(marks, { x: 100, y: 100 });
    expect(once.strokes).toEqual([]);
    expect(once.regions).toHaveLength(1);
    const twice = eraseMarkAt(once, { x: 100, y: 100 });
    expect(hasMarks(twice)).toBe(false);
    expect(eraseMarkAt(twice, { x: 100, y: 100 })).toBe(twice);
  });
});

describe("progressImageAnnotation", () => {
  it("cites the capture with a padded crop kept inside the image", () => {
    const marks = commitDraft(
      NO_MARKS,
      { tool: "box", start: { x: 900, y: 10 }, end: { x: 990, y: 60 } },
      style("box"),
    );
    const prepared = progressImageAnnotation({
      id: "annotation_1",
      update,
      marks,
      comment: "  Make this button quieter ",
      createdAt: "2026-10-21T11:00:00.000Z",
    });
    expect(prepared?.cropRect).toEqual({ x: 880, y: 0, width: 120, height: 90 });
    expect(prepared?.annotation).toMatchObject({
      id: "annotation_1",
      pageUrl: update.url,
      pageTitle:
        "Progress image captured 2026-10-21T10:00:00.000Z: Settings page with the new sidebar",
      comment: "Make this button quieter",
      // Box colors only matter in the screenshot, so the agent gets just where they are.
      regions: [{ id: "box", rect: { x: 900, y: 10, width: 90, height: 50 } }],
      elements: [],
      screenshot: null,
    });
  });

  it("has nothing to attach without marks", () => {
    expect(
      progressImageAnnotation({
        id: "annotation_1",
        update,
        marks: NO_MARKS,
        comment: "Hello",
        createdAt: update.createdAt,
      }),
    ).toBeNull();
  });

  it("shortens a long note in the title", () => {
    const titleFor = (note: string | null) =>
      progressImageAnnotation({
        id: "annotation_1",
        update: { ...update, note },
        marks: commitDraft(
          NO_MARKS,
          { tool: "box", start: { x: 0, y: 0 }, end: { x: 100, y: 100 } },
          style("box"),
        ),
        comment: "",
        createdAt: update.createdAt,
      })?.annotation.pageTitle ?? "";
    const long = titleFor("word ".repeat(40));
    expect(long.length).toBeLessThan(140);
    expect(long.endsWith("…")).toBe(true);
    expect(titleFor(null)).toBe("Progress image captured 2026-10-21T10:00:00.000Z");
  });
});

describe("markupToolForKey", () => {
  it("uses design mode's keys", () => {
    expect(["b", "R", "o", "a", "p", "d", "e", "v"].map(markupToolForKey)).toEqual([
      "box",
      "box",
      "circle",
      "arrow",
      "pen",
      "pen",
      "erase",
      null,
    ]);
  });
});
