# Floorplan editor layout handoff

The canonical architecture, constraints, rendering rules, validation commands,
and deployment procedure are documented in
[`docs/floorplan-reconstruction.md`](./floorplan-reconstruction.md).

Editor-specific requirements:

- Solve from the current graph, room polygons, doors, windows, and door
  configurations, never from `base.initialGraph`.
- Recompute affected placements immediately after an architectural edit.
- Match the native RoomPlan gesture contract: draw starts snap to a corner or
  wall edge, draw ends remain orthogonal while their free axis snaps to nearby
  corners, moved corners weld when dropped within 0.10 m, and wall/body drags
  are calculated from an immutable gesture-start snapshot.
- A source RoomPlan door or window hosted by a moved wall must first be
  converted to an authored opening with the same identifier. Move it with the
  wall and mark the source identifier deleted so reloads cannot restore the old
  position. Erasing a host wall persistently removes its openings.
- Undo snapshots include both the complete wall graph and opening edits.
- Use the same solver adapter and presentation preparation as the consumer
  viewer.
- Preserve object status, source pose, selected candidate, parent relationship,
  merge provenance, confidence, and reasons.
- Hide rejected furniture in the consumer drawing while retaining it for
  editor diagnostics.
- Keep furniture read-only until the persistence API can save the complete
  solved-object contract.

Before release, run every command in the canonical document's validation
section and build the production Docker image.
