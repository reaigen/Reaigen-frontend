# Floorplan reconstruction and presentation

## Status

This document is the canonical engineering contract for Reaigen floorplan
reconstruction, furniture placement, and consumer-facing 2D presentation.

The production viewer does not expose a URL-controlled debug mode, raw
observation overlay, or HTTP capture endpoint. Solver investigation is done
offline with sanitized fixtures under `fixtures/floorplan/`.

## Product goal

RoomPlan observations are measurements, not a finished drawing. The floorplan
pipeline must reconstruct the nearest physically valid and semantically
plausible scene while preserving trustworthy measured evidence.

The output is intended for real-estate agents and home buyers. It must be:

- readable without technical scan knowledge;
- visually consistent across small and large properties;
- conservative when input is ambiguous;
- deterministic for the same input;
- explicit about every relocation, merge, and rejection.

The solver must not invent a different apartment and must not repair invalid
layouts with arbitrary object nudges.

## Runtime ownership

| Responsibility | Implementation |
| --- | --- |
| RoomPlan parsing and geometry normalization | `app/lib/floorplan-geometry.ts` |
| Wall graph conditioning | `app/lib/floorplan-wall-conditioning.ts` |
| Frontend-to-solver conversion | `app/lib/floorplan-solver-adapter.ts` |
| Constraint solver | `vendor/reaigen-floorplan-solver-0.1.0.tgz` |
| Presentation preparation and object grouping | `app/lib/floorplan-layout-solver.ts` |
| Door hinge and swing presentation | `app/lib/floorplan-door-presentation.ts` |
| Room-label placement | `app/lib/floorplan-label-placement.ts` |
| Furniture symbol geometry | `app/lib/floorplan-icon-shapes.ts` and `public/floorplan-icons/` |
| Consumer SVG rendering | `app/components/floorplan-viewer.tsx` |
| Current-state editing | `app/components/floorplan-editor.tsx` |

The vendored package is the solver source of truth. The adapter owns conversion
between application geometry and the package contract. Rendering code must not
silently alter solved footprints.

## Canonical capture input

An Apple capture should retain these related artifacts:

```text
captured_structure.json
captured_structure.usdz
captured_structure_metadata.json
```

The JSON representation is canonical solver input. USDZ is supporting evidence
for visualization, detailed geometry, height, and manual verification. Export
metadata maps USDZ node names to RoomPlan UUIDs.

The canonical scene should retain, when present:

- rooms, section labels, and room types;
- floor polygon corners;
- walls, doors, windows, and openings;
- object category, transform, dimensions, height, and vertical placement;
- object attributes and confidence;
- object and surface parent identifiers;
- room membership;
- RoomPlan UUID to USDZ node mapping.

All reconstruction content uses the project coordinate contract: right-handed,
Y-up metres. Floorplan geometry uses X/Z as its 2D plane. Do not introduce a
runtime X mirror or an independent mesh pre-transform.

## Pipeline

### 1. Parse and normalize

Parse RoomPlan data into renderer-independent geometry. Normalize identifiers,
finite measurements, category aliases, orientation axes, parent relationships,
and floor polygons before solving.

### 2. Condition the measured wall graph

Condition duplicate and nearly collinear measured segments without inventing
missing walls. Preserve the distinction between:

- measured architectural edges;
- inferred polygon closure edges;
- openings cut from a wall;
- disconnected scan fragments.

Inferred closure edges exist only to support containment. They cannot create
wall-affinity, storage-run, or free-space placement candidates.

### 3. Build room polygons

Room polygon priority is:

1. RoomPlan section and floor polygons.
2. Individual CapturedRoom floor polygons within CapturedStructure.
3. Polygonization of measured walls.
4. A containment-only fallback hull for partial topology.

Connected wall components are not rooms. An object is assigned to the room
having the greatest intersection with its raw oriented footprint. Weak or
ambiguous assignment remains uncertain rather than forcing the object across a
wall.

### 4. Build reserved and free space

For each room:

```text
usable room polygon
- wall interiors
- openings and door reserves
- mandatory circulation
- permanent fixtures
= furniture free space
```

Swinging-door reserves include the opening, swept leaf sector, threshold, and
approach space. Sliding-door reserves include the opening, leaf travel, and
approach space. A conflict with a reserved door polygon invalidates a candidate.

### 5. Generate meaningful candidates

The solver chooses among discrete, explainable placements rather than
continuously pushing boxes. Candidate sources include:

- unchanged raw pose;
- conservative yaw rectification;
- measured-wall clearance correction;
- legal measured-wall placement;
- corner or room-edge placement when supported;
- relation-derived table/chair slots;
- nested parent placement;
- reject or merge.

Candidates that violate hard geometry are removed before ranking.

### 6. Select a compatible scene

Candidate selection minimizes displacement and semantic cost subject to hard
constraints. The same input and configuration must produce the same result.

## Hard constraints

These invariants cannot be traded for aesthetic score:

- object footprint remains inside its assigned room;
- no furniture-wall penetration;
- no illegal furniture-furniture overlap;
- no door opening, leaf sweep, threshold, or approach collision;
- no furniture crossing into another room;
- no storage interval crossing a door or opening;
- no tall storage covering a protected window interval;
- nested appliances cannot survive without their containing storage;
- rejected objects do not render in the consumer plan.

A questionable observation is rejected rather than placed outside a room or in
a doorway.

## Alignment policy

Measured pose is evidence. Rectification is category- and relation-specific,
not global cardinal snapping.

- Raw and yaw-only candidates always preserve the measured center.
- A `measured-wall-clearance` candidate may close a trustworthy wall gap by at
  most 0.12 m.
- Low storage up to 1.2 m high may close a wall gap by at most 0.16 m.
- Wall-backed furniture can rectify toward a measured wall only when the
  measured pose already supports that relationship.
- An explicit dining table with a child chair may rectify to the measured room
  axes by at most 22 degrees. Its center and dimensions remain measured.
- Generic objects do not snap without wall or relation evidence.

The 22 degree dining threshold and wall-clearance values are conservative
engineering defaults. They are configuration values, not claimed dataset
statistics.

## Parent relations, deduplication, and nested fixtures

RoomPlan parent identifiers take precedence over category-only heuristics.

Supported containment and grouping includes:

```text
chair -> table
sink -> storage
dishwasher -> storage
oven -> storage
stove -> storage
television -> storage
```

Deduplication remaps child parent identifiers through the complete merge chain.
Nested stove, oven, sink, and dishwasher candidates are derived after their
parent storage is selected. They are rejected atomically if the parent is
rejected. Nested service appliances do not create duplicate clearance zones.

For table groups, chairs are assigned to legal perimeter slots, face the table,
and preserve a visually readable overlap/under-table relationship. Tables are
opaque in the final symbol so chair linework does not show through the tabletop.

## Storage and kitchens

Storage uses a wall-run model rather than generic collision relaxation. Each
wall candidate is an interval with width along the wall and depth toward the
room. Door, opening, protected-window, and permanent-fixture intervals are
subtracted before packing.

Rules:

- use measured walls from the assigned room only;
- never derive a run from an inferred hull edge;
- preserve the solved footprint;
- orient the front face toward the room;
- merge likely fragments only when geometry and identifiers support it;
- reject a low-confidence fragment when no legal interval exists.

Generic storage symbols are authored at the exact solved width and depth.
Internal module seams are proportional and cannot change the footprint.

Kitchen counters use a consistent visual counter depth of 0.60 m only at the
presentation layer when the captured object represents a cabinet run. Embedded
stoves and ovens retain an outer appliance boundary and are visually integrated
into the run. Adjacent counter modules share edges without doubled outlines or
micro-gaps.

## Doors, windows, walls, and labels

All architectural detail linework shares one presentation token. Current SVG
detail strokes use 1.35 viewBox units with round joins/caps where appropriate.

- Wall masses remain the dominant black element.
- Window frames terminate cleanly into wall cuts.
- Door jambs, leaf, and arc share the same detail weight.
- The hinge is not rendered as an oversized dot.
- Ambiguous door configuration infers the hinge nearest a measured wall return;
  it does not silently assume Left/In.
- Sofa modules share boundaries without doubled seams.
- Room-number badges are fixed 32 px HTML overlays, so zoom and aspect ratio do
  not cause label-size jumps.
- Label placement scores usable clearance from walls, doors, furniture, and
  neighboring labels.

## Solved-object contract

Every retained or rejected observation must be explainable:

```ts
interface SolvedFurniture {
  id: string;
  status: "unchanged" | "rectified" | "relocated" | "merged" | "rejected";
  roomId: string;
  pose: Pose2D;
  sourcePose: Pose2D;
  confidence: number;
  reasons: string[];
}
```

Examples of acceptable reasons:

```text
intersects door swing; moved to nearest legal interval on same measured wall
82% overlap with larger same-kind observation; rejected as duplicate
assigned to parent table; yaw corrected by 7.2 degrees
closed 0.08 m measured wall clearance
```

## Data-driven priors

Dataset-derived information is a soft ranking prior, never a replacement for
the captured apartment geometry.

ProcTHOR is suitable for:

- object probability and count by room type;
- corner, edge, and middle placement class;
- wall-facing likelihood and front clearance;
- semantic groups and pair orientation;
- circulation-aware rejection patterns.

ARKitScenes is suitable for:

- real size, depth, height, and aspect-ratio distributions;
- orientation relative to dominant room axes;
- real pair distances and relative angles;
- geometry outlier detection.

ReplicaCAD and MLStructFP are useful for additional authored-scene and
floorplan-structure evaluation. Professionally designed layout corpora can
strengthen aesthetic ranking after license review.

These sources do not provide paired error labels for Reaigen's RoomPlan
pipeline. The production learning set must be built from consented captures:

```text
raw RoomPlan observation
-> automatic solved result
-> human-corrected result
```

Store versioned aggregate priors, provenance, license notes, sample counts, and
quantiles. Do not ship raw third-party scans in the frontend repository.

## Validation and regression fixtures

The checked-in fixtures cover a representative living room, fragmented scan,
legacy room, and multi-room label placement.

Run:

```bash
npm run validate-floorplan
npm run validate-floorplan-integration
npm run validate-floorplan-collision
npm run validate-floorplan-presentation
npm run validate-floorplan-rendering
npm run validate-currency-display
npm run typecheck
```

Release acceptance requires:

- zero furniture-wall penetrations;
- zero illegal furniture overlaps;
- zero door-reserve intersections;
- zero objects outside assigned rooms;
- zero storage intervals crossing openings;
- deterministic output;
- reasons for all moved, merged, or rejected objects;
- editor wall/opening/furniture changes surviving save and reload without
  changing the immutable session projection.

To mine or compare prior artifacts without changing runtime behavior:

```bash
npm run analyze-floorplan-patterns
```

## Editor contract

The global placement solve uses the closest immutable raw/welded scan-wall
baseline, exactly as iOS does. Edited walls do not invalidate object identity:
the rigid wall-attachment pass maps supported objects from that baseline onto
the live graph, while the collision solver handles only the active transform.
Editor preview and consumer rendering use the same attachment, symbol, and
door-presentation pipeline.

The web editor persists direct furniture authorship separately from solver
metadata in `floorplan_furniture_edits_json`:

- `deletedSourceObjectIDs` is the case-insensitive source-object tombstone set;
- `objectCenterOverrides` stores absolute snapped-world `[x, z]` centres.

The deterministic baseline solve always runs first. A lightweight rigid
wall-attachment pass follows it; authored centres and deletions are then
applied as absolute overrides so provenance remains intact and deleting an
observation cannot make a merged duplicate reappear. Furniture movement uses
swept oriented-box collision with wall, door-swing, and furniture obstacles.
Wall movement follows the iOS rigid-push behavior: normal-only wall translation,
connected collinear chains, furniture push propagation, and a single clamped
wall delta when fixed geometry blocks the train.

Kitchen worktop fixtures form a narrow editable hierarchy. A cooktop, sink,
integrated oven, or dishwasher is mounted to its containing cabinet run and is
excluded from independent floor-body collision. It may slide along the
cabinet's local run, while cabinet moves and wall pushes carry the fixture by
the identical delta. This mounted rule is category-specific: semantic
RoomPlan links such as chairs related to a table remain independent bodies. If
RoomPlan reports both a cooktop and its oven at the same cabinet position, the
top-down presentation draws the cooktop once and suppresses the redundant
front-facing oven footprint.

The editor session also freezes its parsed scan baseline and initial projection
at mount. Debounced saves merge new `draft_data` into the parent listing, but
those acknowledgements are persistence results—not new geometry input—and must
not rebuild the solver baseline or viewport scale. This is what keeps the whole
plan stationary after a wall or furniture drop.

On desktop the editor presents those rules as a compact DCC-style shell around
the same iOS gesture lifecycle. The selected wall chain or object is visible
during the active drag, every frame is computed from the same start scene, and
the target is cleared on release. The global solver is cached outside the drag
loop; only collision and rigid attachment run per frame. This prevents the
visible sticking, dancing, and hiding failure while retaining precise mouse pan
and zoom behavior.

## Docker deployment

The public frontend is the standalone Next.js Docker build on port 3055:

```bash
docker compose up -d --build
docker compose ps
```

The development server is independent. The standard project dev port is 3055;
a temporary collaborative server may run on another explicitly selected port.

## Known limits

- Partial scans without reliable floor polygons use conservative
  containment-only fallback geometry.
- Unknown door handedness remains conservative until topology or user input
  resolves it.
- Dataset priors are currently engineering defaults and fixture-derived
  behavior, not a trained production model.
- Rotation and dimension overrides are not yet part of the furniture-edit
  persistence contract; current authorship covers deletion and centre moves.
