# Floorplan editor layout handoff

The canonical architecture, constraints, rendering rules, validation commands,
and deployment procedure are documented in
[`docs/floorplan-reconstruction.md`](./floorplan-reconstruction.md).

Editor-specific requirements:

- Solve from the current graph, room polygons, doors, windows, and door
  configurations, never from `base.initialGraph`.
- Recompute affected placements immediately after an architectural edit.
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
