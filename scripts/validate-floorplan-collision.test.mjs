import assert from "node:assert/strict";
import test from "node:test";

import {
  applyFurnitureEdits,
  collinearEdgeChain,
  moveFurniture,
  moveWall,
  parseFurnitureEdits,
  translateWallChain,
  wallNormalTranslation,
} from "../app/lib/floorplan-collision-solver.ts";
import {
  applyFurnitureWallAttachment,
  closestFurnitureWallBaseline,
} from "../app/lib/floorplan-wall-attachment.ts";

const object = (id, center, halfW = 0.5, halfD = 0.5) => ({
  id,
  category: "chair",
  center,
  axisW: [1, 0],
  axisD: [0, 1],
  halfW,
  halfD,
});

test("furniture cannot tunnel through a wall and slides along it", () => {
  const graph = {
    vertices: [[2, -3], [2, 3]],
    edges: [{ a: 0, b: 1 }],
  };
  const result = moveFurniture([object("chair", [0, 0])], "chair", graph, [3, 1]);

  assert.equal(result.blocked, true);
  assert.ok(result.objects[0].center[0] < 1.43);
  assert.ok(result.objects[0].center[0] > 1.35);
  assert.ok(result.objects[0].center[1] > 0.9);
});

test("furniture stops at another furniture object", () => {
  const result = moveFurniture(
    [object("moving", [0, 0]), object("fixed", [2, 0])],
    "moving",
    { vertices: [], edges: [] },
    [3, 0],
  );

  assert.equal(result.blocked, true);
  assert.ok(result.objects[0].center[0] < 0.98);
  assert.ok(result.objects[0].center[0] > 0.9);
  assert.deepEqual(result.objects[1].center, [2, 0]);
});

test("a counter fixture slides on its parent instead of acting as a rigid body", () => {
  const counter = { ...object("counter", [0, 0], 1.2, 0.3), category: "storage" };
  const hob = {
    ...object("hob", [0, 0], 0.28, 0.24),
    category: "stove",
    parentId: "counter",
  };
  const result = moveFurniture(
    [counter, hob, object("chair", [0.75, 0])],
    "hob",
    { vertices: [], edges: [] },
    [0.55, 0.4],
  );

  assert.deepEqual(result.objects[0].center, counter.center);
  assert.ok(result.objects[1].center[0] > 0.54 && result.objects[1].center[0] < 0.56);
  assert.equal(result.objects[1].center[1], 0);
  assert.deepEqual(result.objects[2].center, [0.75, 0]);
});

test("moving a cabinet carries its mounted fixture as one hierarchy", () => {
  const counter = { ...object("counter", [0, 0], 1.2, 0.3), category: "storage" };
  const hob = {
    ...object("hob", [0.25, 0], 0.28, 0.24),
    category: "stove",
    parentId: "counter",
  };
  const result = moveFurniture(
    [counter, hob],
    "counter",
    { vertices: [], edges: [] },
    [0.4, 0.2],
  );

  assert.deepEqual(result.objects[0].center, [0.4, 0.2]);
  assert.deepEqual(result.objects[1].center, [0.65, 0.2]);
});

test("RoomPlan table relationships group chairs as family, not mounted fixtures", () => {
  const table = { ...object("table", [0, 0], 0.8, 0.55), category: "table" };
  const chair = {
    ...object("chair", [1.2, 0], 0.25, 0.25),
    parentId: "table",
  };
  // Dragging the table brings its chair along instead of colliding with it —
  // a tucked-in chair must never block its own table.
  const tableMove = moveFurniture(
    [table, chair],
    "table",
    { vertices: [], edges: [] },
    [0.35, 0],
  );
  const near = (a, b) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6, `${a} !~ ${b}`);
  assert.equal(tableMove.blocked, false);
  near(tableMove.objects[0].center, [0.35, 0]);
  near(tableMove.objects[1].center, [1.55, 0]);

  // Dragging the chair pulls it away freely — no mounted-fixture slide rail,
  // and the table stays put.
  const chairMove = moveFurniture(
    [table, chair],
    "chair",
    { vertices: [], edges: [] },
    [0.4, 0.4],
  );
  assert.equal(chairMove.blocked, false);
  near(chairMove.objects[1].center, [1.6, 0.4]);
  near(chairMove.objects[0].center, [0, 0]);
});

test("furniture respects the saved-door swing reserve", () => {
  const result = moveFurniture(
    [object("chair", [2, 2], 0.25, 0.25)],
    "chair",
    { vertices: [], edges: [] },
    [0, -2],
    [[[2, 0], [3, 0]]],
  );

  assert.equal(result.blocked, true);
  assert.ok(result.objects[0].center[1] > 1.25);
});

test("moving a wall carries its connected collinear chain", () => {
  const graph = {
    vertices: [[-2, 0], [0, 0], [2, 0], [0, 2]],
    edges: [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 1, b: 3 }],
  };

  assert.deepEqual([...collinearEdgeChain(graph, 0)].sort(), [0, 1]);
  const moved = translateWallChain(graph, 0, [0, 0.5]);
  assert.deepEqual(moved.vertices.slice(0, 3), [[-2, 0.5], [0, 0.5], [2, 0.5]]);
  assert.deepEqual(moved.vertices[3], [0, 2]);
});

test("desktop wall drag is constrained to the selected wall normal", () => {
  const graph = {
    vertices: [[-2, 0], [2, 0]],
    edges: [{ a: 0, b: 1 }],
  };

  const constrained = wallNormalTranslation([3, 1.25], 0, graph);
  assert.ok(Math.abs(constrained[0]) < 1e-12);
  assert.equal(constrained[1], 1.25);
});

test("wall pushes contacted furniture and clamps it against fixed geometry", () => {
  const graph = {
    vertices: [[-2, 0], [2, 0], [-2, 2], [2, 2]],
    edges: [{ a: 0, b: 1 }, { a: 2, b: 3 }],
  };
  const result = moveWall([object("chair", [0, 0.65])], graph, 0, [0, 2]);

  assert.equal(result.blocked, true);
  assert.ok(result.wallDelta[1] > 0.7 && result.wallDelta[1] < 0.8);
  assert.ok(result.objects[0].center[1] > 1.35 && result.objects[0].center[1] < 1.45);
});

test("a moving wall keeps a worktop fixture attached to its cabinet", () => {
  const graph = {
    vertices: [[-2, 0], [2, 0], [-2, 3], [2, 3]],
    edges: [{ a: 0, b: 1 }, { a: 2, b: 3 }],
  };
  const cabinet = { ...object("cabinet", [0, 0.55], 0.9, 0.5), category: "storage" };
  const hob = {
    ...object("hob", [0.2, 0.55], 0.28, 0.24),
    category: "stove",
    parentId: "cabinet",
  };
  const result = moveWall([cabinet, hob], graph, 0, [0, 1.1]);

  const cabinetDelta = result.objects[0].center[1] - cabinet.center[1];
  const hobDelta = result.objects[1].center[1] - hob.center[1];
  assert.ok(cabinetDelta > 1);
  assert.equal(hobDelta, cabinetDelta);
  assert.equal(result.objects[1].center[0] - result.objects[0].center[0], 0.2);
});

test("wall push propagates through a furniture train", () => {
  const graph = {
    vertices: [[-2, 0], [2, 0], [-2, 3], [2, 3]],
    edges: [{ a: 0, b: 1 }, { a: 2, b: 3 }],
  };
  const result = moveWall(
    [object("first", [0, 0.6], 0.45, 0.45), object("second", [0, 1.6], 0.45, 0.45)],
    graph,
    0,
    [0, 3],
  );

  assert.equal(result.blocked, true);
  assert.ok(result.objects[0].center[1] > 1.5);
  assert.ok(result.objects[1].center[1] > 2.4);
  assert.ok(result.objects[1].center[1] < 2.48);
});

test("replaying a desktop drag from one immutable baseline is deterministic", () => {
  const graph = {
    vertices: [[-2, 0], [2, 0], [-2, 3], [2, 3]],
    edges: [{ a: 0, b: 1 }, { a: 2, b: 3 }],
  };
  const baseline = [object("chair", [0, 0.65])];
  const first = moveWall(baseline, graph, 0, [0, 1.4]);
  const replay = moveWall(baseline, graph, 0, [0, 1.4]);

  assert.deepEqual(replay, first);
  assert.deepEqual(baseline[0].center, [0, 0.65]);
});

test("furniture edits are normalized and applied after solving", () => {
  const edits = parseFurnitureEdits({
    floorplan_furniture_edits_json: JSON.stringify({
      deletedSourceObjectIDs: ["DELETE-ME"],
      objectCenterOverrides: { "MOVE-ME": [4, 5], invalid: ["x", 1] },
    }),
  });
  const result = applyFurnitureEdits(
    [object("delete-me", [0, 0]), object("move-me", [1, 1])],
    edits,
  );

  assert.deepEqual(edits.deletedSourceObjectIDs, ["delete-me"]);
  assert.deepEqual(result.map(({ id, center }) => ({ id, center })), [
    { id: "move-me", center: [4, 5] },
  ]);
});

test("wall attachment preserves object identity and never hides furniture", () => {
  const baselineWalls = [[[-2, 0], [2, 0]]];
  const editedWalls = [[[-2, 0.8], [2, 0.8]]];
  const source = [
    object("attached", [0, 0.55], 0.4, 0.5),
    object("free", [0, 2.5], 0.4, 0.4),
  ];
  const result = applyFurnitureWallAttachment(source, baselineWalls, editedWalls);

  assert.deepEqual(result.map(({ id }) => id), ["attached", "free"]);
  assert.ok(result[0].center[1] > 1.3 && result[0].center[1] < 1.4);
  assert.deepEqual(result[1].center, source[1].center);
  assert.deepEqual(source[0].center, [0, 0.55]);
});

test("wall attachment carries a mounted worktop fixture by its cabinet root", () => {
  const baselineWalls = [[[-2, 0], [2, 0]]];
  const editedWalls = [[[-2, 0.8], [2, 0.8]]];
  const cabinet = { ...object("cabinet", [0, 0.55], 0.9, 0.5), category: "storage" };
  const hob = {
    ...object("hob", [0.2, 0.55], 0.28, 0.24),
    category: "stove",
    parentId: "cabinet",
  };
  const result = applyFurnitureWallAttachment([cabinet, hob], baselineWalls, editedWalls);

  const cabinetDelta = result[0].center[1] - cabinet.center[1];
  const hobDelta = result[1].center[1] - hob.center[1];
  assert.ok(cabinetDelta > 0.79 && cabinetDelta < 0.81);
  assert.equal(hobDelta, cabinetDelta);
});

test("wall attachment clamps at first furniture contact without jumping through", () => {
  const baselineWalls = [[[-2, 0], [2, 0]]];
  const editedWalls = [[[-2, 2], [2, 2]]];
  const result = applyFurnitureWallAttachment(
    [object("attached", [0, 0.55], 0.4, 0.5), object("fixed", [0, 2.2], 0.4, 0.5)],
    baselineWalls,
    editedWalls,
  );

  assert.ok(result[0].center[1] > 1.15 && result[0].center[1] < 1.21);
  assert.deepEqual(result[1].center, [0, 2.2]);
});

test("closest baseline treats welded scan walls as baseline, not a user drag", () => {
  const raw = [[[0.02, 0], [2.02, 0]]];
  const welded = [[[0, 0], [2, 0]]];
  const edited = [[[0, 0], [2, 0]]];
  assert.equal(closestFurnitureWallBaseline(raw, welded, edited), welded);
});

// ── family semantics: parentId groups every category, not just fixtures ──────
// Real regression from draft 11949: a chair parented to its table sat tucked
// against the tabletop; because family membership was gated to counter
// fixtures, the chair acted as a blocker overlapping its own table and every
// table drag deflected sideways ("move vertically → snapped to horizontal").

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const capturedInput = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "floorplan", "draft-11949-captured-input.json"),
  "utf8",
));
const capturedGraph = (() => {
  const vertices = [];
  const edges = [];
  for (const [a, b] of capturedInput.walls) edges.push({ a: vertices.push(a) - 1, b: vertices.push(b) - 1 });
  return { vertices, edges };
})();
const capturedDoors = capturedInput.doors.map((d) => (Array.isArray(d) ? d : [d.p1, d.p2]));
const chairedTable = capturedInput.objects.find((o) => o.id.startsWith("b3973504"));
const tuckedChair = capturedInput.objects.find((o) => o.id.startsWith("4a65b776"));

test("captured chaired table moves vertically; its chair rides along", () => {
  const result = moveFurniture(capturedInput.objects, chairedTable.id, capturedGraph, [0, -0.3], capturedDoors);
  assert.equal(result.blocked, false);
  assert.ok(Math.abs(result.delta[1] + 0.3) < 1e-6, `vertical applied ${result.delta[1]}`);
  assert.ok(Math.abs(result.delta[0]) < 1e-6, `no sideways deflection ${result.delta[0]}`);
  const movedChair = result.objects.find((o) => o.id === tuckedChair.id);
  assert.ok(Math.abs(movedChair.center[1] - tuckedChair.center[1] + 0.3) < 1e-6, "chair follows the table");
});

test("captured chair drags away from its table without moving it", () => {
  const result = moveFurniture(capturedInput.objects, tuckedChair.id, capturedGraph, [0.5, 0], capturedDoors);
  assert.equal(result.blocked, false);
  assert.ok(Math.abs(result.delta[0] - 0.5) < 1e-6, `chair applied ${result.delta[0]}`);
  const table = result.objects.find((o) => o.id === chairedTable.id);
  assert.deepEqual(table.center, chairedTable.center);
});
