# Backend/iOS sync memo — floorplan workspace pass (2 September 2026)

What the web frontend now reads and writes, and what the backend and iOS
need to pick up to stay in parity. Storage-wise nothing breaks today —
everything rides the generic `draft_data` key/value contract — but any
consumer that renders or edits floorplans must adopt the items below or
web-authored plans will look or behave differently there.

## New draft-data keys written by web

| Key | Value | Who must read it |
| --- | --- | --- |
| `floorplan_wall_thickness_mm` | integer, plan-level wall thickness | iOS renderer, any backend export/PDF renderer |
| `floorplan_wall_style` | `solid` \| `outline` | iOS renderer, any backend export/PDF renderer |

Absent keys mean the previous defaults; no migration needed.

## Extended JSON payloads

- `floorplan_furniture_edits_json` gains `objectRotationOverrides`
  (`{ [lowercased object id]: degrees }`) alongside the existing
  `deletedSourceObjectIDs` and `objectCenterOverrides`. iOS currently
  ignores unknown fields, so nothing crashes — but until iOS applies the
  rotations, furniture rotated on web renders unrotated on iOS. Parsers
  must keep tolerating unknown fields (web may extend again).

## Contracts web now participates in (no change, but new writers)

- `wall_graph_json`, `floorplan_opening_edits_json` — web edits walls and
  creates/deletes openings. Custom openings carry web-generated UUIDs
  (lowercased) in `customOpenings[].id`.
- `door_N_camera` — web writes door configs (`door_type`, `hinge_side`,
  `swing_direction`) including for **custom** doors created on web. iOS
  should resolve configs by `door_id` and not assume every configured door
  originates from a scan.
- `room_N_label` / `room_N_marker_x` / `room_N_marker_z` /
  `room_N_label_offset_x` / `room_N_label_offset_z` — web creates and
  deletes rooms. Deletion writes an empty `room_N_label` (tombstone) and
  attempts `DELETE` on the marker/offset entries.
- Markers persist in the **raw scan frame** (web applies
  `rotateFromSnappedFrame` before saving). Any consumer that snapped
  markers on load must not re-snap already-raw values twice — iOS's
  existing load path is compatible.

## Label placement rule (render parity)

An authored marker (`room_N_marker_x/z` present) is the room label's single
source of truth — render the badge exactly there (plus the authored offset),
with no polygon reassignment and no collision nudging for that room. Rooms
without a marker keep automatic placement. Web editor, preview, and lightbox
follow this now; any backend-rendered floorplan image or iOS view must match
or the same plan shows labels in different places per platform.

## API behaviour notes (no action strictly required)

- `draft-data` POST rejects empty `data_value`; web works around tombstoning
  by only blanking **existing** entries and using the DELETE endpoint
  otherwise. A backend-side accept-empty or bulk-delete would simplify room
  deletion but is not blocking.
- Web saves draft-data per key with independent retries; expect bursts of
  small PATCH/POST requests after an editing session rather than one large
  write.
- Description generation uses the existing
  `generate-description` + `draft-services` polling and
  `creation-settings/me` endpoints unchanged.

## Suggested sync order

1. iOS: apply `objectRotationOverrides`; read wall thickness/style keys.
2. iOS + backend renderers: adopt the marker-first label rule.
3. Optional API niceties: empty-value tombstones or bulk delete for room
   teardown.
