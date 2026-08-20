export const REAI_VIEWER_ACTION_EVENT = "reai-viewer-action";

export type ReaiFloorplanCommand =
  | "focus_room"
  | "fit_floorplan"
  | "orient_north"
  | "open_orientation_control"
  | "rotate_view_left"
  | "rotate_view_right"
  | "zoom_in"
  | "zoom_out"
  | "start_distance_measurement"
  | "start_area_measurement"
  | "show_measurements";

export type ReaiVirtualTourCommand =
  | "go_to_room"
  | "next_scene"
  | "previous_scene"
  | "turn_left"
  | "turn_right"
  | "look_up"
  | "look_down"
  | "move_forward"
  | "move_backward"
  | "reset_view";

export interface ReaiViewerAction {
  schema: "com.reaigen.agent.viewer-action";
  version: 1;
  surface: "floorplan" | "virtual_tour";
  command: ReaiFloorplanCommand | ReaiVirtualTourCommand;
  resource: {
    draft_id: number;
    floorplan_id?: number;
    tour_id?: number;
    tour_asset_id?: string;
  };
  target?: {
    kind: "room" | "scene";
    id: number | string;
    label: string;
  } | null;
  parameters: {
    calibrated_north?: boolean;
    north_offset_degrees?: number;
    room_number?: number;
  };
  persistence: "session_only";
  confirmation_required: false;
}

const FLOORPLAN_COMMANDS = new Set<ReaiFloorplanCommand>([
  "focus_room",
  "fit_floorplan",
  "orient_north",
  "open_orientation_control",
  "rotate_view_left",
  "rotate_view_right",
  "zoom_in",
  "zoom_out",
  "start_distance_measurement",
  "start_area_measurement",
  "show_measurements",
]);

const TOUR_COMMANDS = new Set<ReaiVirtualTourCommand>([
  "go_to_room",
  "next_scene",
  "previous_scene",
  "turn_left",
  "turn_right",
  "look_up",
  "look_down",
  "move_forward",
  "move_backward",
  "reset_view",
]);

/**
 * Validate the server's bounded viewer contract before it reaches a camera or
 * floor-plan surface. Viewer actions never accept URLs, script, selectors, or
 * arbitrary coordinates.
 */
export function isReaiViewerAction(value: unknown): value is ReaiViewerAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Partial<ReaiViewerAction>;
  if (
    action.schema !== "com.reaigen.agent.viewer-action"
    || action.version !== 1
    || action.persistence !== "session_only"
    || action.confirmation_required !== false
    || !action.resource
    || !Number.isInteger(action.resource.draft_id)
  ) return false;

  if (action.surface === "floorplan") {
    return (
      typeof action.command === "string"
      && FLOORPLAN_COMMANDS.has(action.command as ReaiFloorplanCommand)
      && Number.isInteger(action.resource.floorplan_id)
    );
  }
  if (action.surface === "virtual_tour") {
    return (
      typeof action.command === "string"
      && TOUR_COMMANDS.has(action.command as ReaiVirtualTourCommand)
      && Number.isInteger(action.resource.tour_id)
    );
  }
  return false;
}

export function dispatchReaiViewerAction(
  value: unknown,
  expected: { draftId?: number; tourId?: number },
): boolean {
  if (!isReaiViewerAction(value)) return false;
  if (expected.draftId !== undefined && value.resource.draft_id !== expected.draftId) return false;
  if (
    value.surface === "virtual_tour"
    && expected.tourId !== undefined
    && value.resource.tour_id !== expected.tourId
  ) return false;
  window.dispatchEvent(new CustomEvent<ReaiViewerAction>(REAI_VIEWER_ACTION_EVENT, { detail: value }));
  return true;
}

export function readReaiViewerAction(event: Event): ReaiViewerAction | null {
  if (!(event instanceof CustomEvent)) return null;
  return isReaiViewerAction(event.detail) ? event.detail : null;
}
