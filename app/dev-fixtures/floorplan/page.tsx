"use client";

// Dev QA fixture: the floorplan editor on a known plan — used by the UI smoke
// suite to guard mounting, framing and the opening solver end to end.

import { notFound } from "next/navigation";
import FloorplanEditor from "../../components/floorplan-editor";

const entry = (id: number, data_key: string, data_value: string) => ({
  id,
  data_key,
  data_value,
  data_type: "text",
  sort_order: id,
});

const DRAFT_DATA = [
  entry(
    1,
    "wall_graph_json",
    JSON.stringify({
      vertices: [
        [0, 0],
        [8, 0],
        [8, 5],
        [0, 5],
      ],
      edges: [
        { a: 0, b: 1 },
        { a: 1, b: 2 },
        { a: 2, b: 3 },
        { a: 3, b: 0 },
      ],
    }),
  ),
  entry(
    2,
    "floorplan_opening_edits_json",
    JSON.stringify({
      deletedSourceOpeningIDs: [],
      customOpenings: [
        { id: "door-1", kind: "door", p1: [2.0, 0], p2: [2.9, 0] },
        { id: "win-1", kind: "window", p1: [5.0, 0], p2: [6.2, 0] },
      ],
    }),
  ),
  entry(3, "room_1_label", "Obývačka"),
  entry(4, "room_1_marker_x", "1.0"),
  entry(5, "room_1_marker_z", "1.0"),
];

export default function FloorplanFixture() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <FloorplanEditor
      draftId={999999}
      draftData={DRAFT_DATA}
      lang="sk"
      units={[]}
      targetAreaUnit={null}
      onClose={() => {}}
      onSaved={() => {}}
    />
  );
}
