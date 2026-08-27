import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { iconForKind } from "../app/lib/floorplan-icon-shapes.ts";
import {
  attachFloorplanFixtureHierarchy,
  removeRedundantCountertopFixtures,
} from "../app/lib/floorplan-fixture-hierarchy.ts";
import {
  assignLabelsToRoomPolygons,
  highClearanceLabelPoint,
  labelPointInPolygon,
} from "../app/lib/floorplan-label-placement.ts";
import { inferDoorPresentationConfig } from "../app/lib/floorplan-door-presentation.ts";

test("sofa glyph preserves a full back rail, slim arms and two unsquashed cushions", () => {
  const icon = iconForKind("sofa", 1.35, 0.6);
  const rectangles = icon.shapes.filter((shape) => shape.t === "rect");
  const seams = icon.shapes.filter((shape) => shape.t === "line");

  assert.equal(rectangles.length, 5);
  assert.equal(rectangles[0].w, icon.w);
  assert.ok(rectangles[0].h < icon.d * 0.2);
  assert.equal(rectangles[1].w, rectangles[2].w);
  assert.equal(rectangles[3].w, rectangles[4].w);
  assert.equal(rectangles[3].h, rectangles[4].h);
  assert.ok(rectangles[3].w > rectangles[1].w * 2);
  assert.ok(rectangles[3].x + rectangles[3].w < rectangles[4].x);
  assert.equal(seams.length, 0);
});

test("storage glyph occupies the measured footprint instead of a fixed aspect box", () => {
  const icon = iconForKind("storage", 1.1, 0.22);
  const rectangles = icon.shapes.filter((shape) => shape.t === "rect");
  const lines = icon.shapes.filter((shape) => shape.t === "line");

  assert.equal(icon.w, 2.2);
  assert.equal(icon.d, 0.44);
  assert.equal(rectangles.length, 1);
  assert.equal(rectangles[0].w, icon.w);
  assert.equal(rectangles[0].h, icon.d);
  assert.ok(lines.length >= 3);
});

const planObject = (id, category, center, halfW = 0.3, halfD = 0.3) => ({
  id,
  category,
  center,
  axisW: [1, 0],
  axisD: [0, 1],
  halfW,
  halfD,
});

test("countertop fixtures receive a stable cabinet parent before presentation", () => {
  const source = [
    planObject("counter", "storage", [0, 0], 1.2, 0.25),
    planObject("hob", "stove", [0.35, 0.04]),
  ];
  const hierarchical = attachFloorplanFixtureHierarchy(source);
  assert.equal(hierarchical[1].parentId, "counter");
});

test("an oven below a co-located hob is not rendered as a second front-facing appliance", () => {
  const source = [
    planObject("counter", "storage", [0, 0], 1.2, 0.25),
    planObject("hob", "stove", [0.2, 0.02]),
    planObject("oven", "oven", [0.22, 0.02]),
  ];
  const composed = removeRedundantCountertopFixtures(source);
  assert.deepEqual(composed.map(({ id }) => id), ["counter", "hob"]);

  const integratedOven = iconForKind("oven", 0.28, 0.24, "counter-fixture");
  assert.equal(integratedOven.shapes.filter((shape) => shape.t === "circle").length, 4);
  assert.equal(integratedOven.shapes.some((shape) => shape.t === "rect"), false);
});

test("the captured 11949 kitchen composes its real hob and oven as one top view", async () => {
  const captured = JSON.parse(await readFile(
    new URL("../fixtures/floorplan/draft-11949-captured-input.json", import.meta.url),
    "utf8",
  ));
  const composed = removeRedundantCountertopFixtures(captured.objects);
  const parent = "a1ffe66c-17cc-452a-9bec-0e2d1eef01ad";
  const mounted = composed.filter((object) => object.parentId === parent);

  assert.deepEqual(mounted.map((object) => object.category), ["stove"]);
});

test("labels are assigned one-to-one to supported room polygons", () => {
  const polygons = [
    [[0, 0], [4, 0], [4, 3], [0, 3]],
    [[5, 0], [8, 0], [8, 3], [5, 3]],
  ];
  const assignment = assignLabelsToRoomPolygons(
    [1, 2, 3],
    { 1: [1, 1], 2: [6, 1], 3: [4.8, 1.5] },
    polygons,
  );
  assert.deepEqual(assignment.numbers, [1, 2]);
  assert.equal(labelPointInPolygon(assignment.positions[1], polygons[0]), true);
  assert.equal(labelPointInPolygon(assignment.positions[2], polygons[1]), true);
});

test("concave-room label point remains inside and clears the boundary", () => {
  const polygon = [[0, 0], [5, 0], [5, 1.5], [1.5, 1.5], [1.5, 5], [0, 5]];
  const point = highClearanceLabelPoint(polygon);
  assert.equal(labelPointInPolygon(point, polygon), true);
  assert.ok(point[0] > 0.35 && point[1] > 0.35);
});

test("ambiguous door hinges at the nearest measured wall return", () => {
  const door = { p1: [0, 1], p2: [0, 0] };
  const walls = [
    [[0, 0], [0, 4]],
    [[0, 0], [3, 0]],
  ];
  const config = inferDoorPresentationConfig(
    door,
    { doorType: "Swinging", hingeSide: "Moving", swingDirection: "Moving" },
    walls,
  );
  assert.equal(config.hingeSide, "Right");
  assert.equal(config.swingDirection, "In");
});

test("explicit door configuration is preserved", () => {
  const explicit = { doorType: "Swinging", hingeSide: "Left", swingDirection: "Out" };
  assert.deepEqual(
    inferDoorPresentationConfig({ p1: [0, 0], p2: [1, 0] }, explicit, []),
    explicit,
  );
});
