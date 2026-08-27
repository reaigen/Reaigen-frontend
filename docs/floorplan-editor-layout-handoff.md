# Floorplan editor layout handoff

The canonical architecture, constraints, rendering rules, validation commands,
and deployment procedure are documented in
[`docs/floorplan-reconstruction.md`](./floorplan-reconstruction.md).

Editor-specific requirements:

- Solve the full furniture layout once from the immutable scan/welded baseline.
  Apply wall attachment and authored furniture edits to the current graph
  without rerunning the global solver during an interaction.
- Match the native RoomPlan gesture contract: draw starts snap to a corner or
  wall edge, draw ends remain orthogonal while their free axis snaps to nearby
  corners, moved corners weld when dropped within 0.10 m, and wall/body drags
  are calculated from an immutable gesture-start snapshot.
- A source RoomPlan door or window hosted by a moved wall must first be
  converted to an authored opening with the same identifier. Move it with the
  wall and mark the source identifier deleted so reloads cannot restore the old
  position. Erasing a host wall persistently removes its openings.
- Undo snapshots include the complete wall graph, opening edits, and authored
  furniture edits.
- Use the same solver adapter, stable wall baseline, rigid wall-attachment
  pass, and presentation preparation as the consumer viewer.
- Preserve object status, source pose, selected candidate, parent relationship,
  merge provenance, confidence, and reasons.
- Hide rejected furniture in the consumer drawing while retaining it for
  editor diagnostics.
- Persist furniture authorship in `floorplan_furniture_edits_json`. The value
  contains `deletedSourceObjectIDs` tombstones and absolute snapped-world
  `objectCenterOverrides`; identifiers are normalized case-insensitively.
- Apply furniture overrides and tombstones only after the deterministic solve.
  This prevents deleting one source observation from exposing a duplicate that
  the solver had merged or rejected.
- Never re-run the global placement solve against transient drag geometry.
  Match iOS: choose the closest raw/welded scan baseline, solve once against
  that immutable evidence, then rigidly attach supported objects from baseline
  walls to edited walls. This preserves object identity and prevents drag-time
  merging, hiding, and reappearance.
- Freeze the parsed scan baseline and initial viewport projection for the full
  lifetime of an editor mount. Autosave returns updated `draft_data` through
  the parent page, but that prop update must never be treated as new scan
  evidence or recalculate centre/scale. Close and reopen the editor to create a
  new baseline session.
- Furniture dragging uses swept oriented-box collision. It cannot tunnel
  through walls, doors, or other furniture and preserves tangential motion so
  the object slides naturally along a blocker.
- Treat worktop appliances as mounted hierarchy children, not independent
  floor rigid bodies. A cooktop/sink/oven/dishwasher may slide only along its
  cabinet run; moving or wall-pushing the cabinet carries the child by exactly
  the same delta. RoomPlan's looser chair-to-table relationship must not use
  this mounted behavior. A co-located oven below a cooktop has no second
  top-down footprint.
- Wall dragging is projected onto the selected wall's normal and moves its
  connected collinear chain. A moving wall pushes contacted furniture as a
  rigid train and clamps the entire move when that train reaches fixed
  geometry. This behavior is shared with the iOS editor.
- Share the iOS physics and persistence contract, not its touch UI. Desktop
  keeps the selected wall chain or furniture body visible only for the active
  gesture, computes every drag frame from one immutable baseline, clears the
  transform target on release/cancel, supports mouse-wheel zoom and
  middle-mouse panning, and never exposes free-corner dragging.
- Treat the desktop editor as a focused viewport below the shared Reaigen
  header. It must always expose a labelled back-to-detail action, editor title,
  plan dimensions, room count, and persistence state; never rely on a lone X
  or the browser back button as the only exit.
- Keep the command surface as one floating monochrome dock with three legible
  groups: selection/geometry, openings/rooms, and history/view. Controls retain
  text labels at comfortable desktop widths, use at least 48 px targets and
  20 px icons, and show exactly one strong dark fill for the active editing
  mode. Utility actions stay visually quieter. When the Agent or a smaller
  window reduces the canvas, collapse labels progressively into one single-row
  icon dock with accessible names/tooltips; never wrap into a tall two-row
  panel over the drawing.
- A faint neutral drafting grid may anchor the white canvas, but the drawing
  remains the strongest content. Do not import a dark DCC theme, dense chrome,
  or unlabelled professional-CAD glyphs into the estate-agent workflow.
- Escape cancels the current mode or selection, Cmd/Ctrl+Z undoes, and the
  common edit modes have keyboard shortcuts. These accelerate desktop work but
  are never required to discover or complete an operation.

Before release, run every command in the canonical document's validation
section and build the production Docker image.
