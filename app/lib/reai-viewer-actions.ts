export const REAI_VIEWER_ACTION_EVENT = "reai-viewer-action";
export const REAI_VIEWER_ACTION_RESULT_EVENT = "reai-viewer-action-result";

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
  | "reset_view"
  | "set_tour_cover";

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
    kind: "room" | "scene" | "camera";
    id: number | string;
    label: string;
  } | null;
  parameters: {
    calibrated_north?: boolean;
    north_offset_degrees?: number;
    room_number?: number;
    camera_id?: string;
    write_token?: string;
  };
  persistence: "session_only" | "tour_thumbnail";
  confirmation_required: boolean;
}

export interface ReaiViewerActionResult {
  schema: "com.reaigen.agent.viewer-action-result";
  version: 1;
  command: "set_tour_cover";
  resource: { draft_id: number; tour_id: number };
  status: "completed" | "capture_unavailable" | "save_failed";
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
  "set_tour_cover",
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
    || !action.resource
    || !Number.isInteger(action.resource.draft_id)
  ) return false;

  if (action.surface === "floorplan") {
    return (
      typeof action.command === "string"
      && FLOORPLAN_COMMANDS.has(action.command as ReaiFloorplanCommand)
      && Number.isInteger(action.resource.floorplan_id)
      && action.persistence === "session_only"
      && action.confirmation_required === false
    );
  }
  if (action.surface === "virtual_tour") {
    const validTour = (
      typeof action.command === "string"
      && TOUR_COMMANDS.has(action.command as ReaiVirtualTourCommand)
      && Number.isInteger(action.resource.tour_id)
    );
    if (!validTour) return false;
    if (action.command === "set_tour_cover") {
      const parameters = action.parameters;
      const boundedCamera = action.persistence === "tour_thumbnail"
        && Boolean(parameters)
        && action.target?.kind === "camera"
        && typeof action.target.id === "string"
        && action.target.id.length > 0
        && parameters?.camera_id === action.target.id;
      if (!boundedCamera) return false;
      if (action.confirmation_required === true) {
        return !parameters?.write_token;
      }
      return action.confirmation_required === false
        && typeof parameters?.write_token === "string"
        && parameters.write_token.length > 0;
    }
    return action.persistence === "session_only" && action.confirmation_required === false;
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

export function dispatchReaiViewerActionResult(result: ReaiViewerActionResult): void {
  window.dispatchEvent(new CustomEvent<ReaiViewerActionResult>(
    REAI_VIEWER_ACTION_RESULT_EVENT,
    { detail: result },
  ));
}

export function readReaiViewerActionResult(event: Event): ReaiViewerActionResult | null {
  if (!(event instanceof CustomEvent) || !event.detail || typeof event.detail !== "object") return null;
  const result = event.detail as Partial<ReaiViewerActionResult>;
  if (
    result.schema !== "com.reaigen.agent.viewer-action-result"
    || result.version !== 1
    || result.command !== "set_tour_cover"
    || !result.resource
    || !Number.isInteger(result.resource.draft_id)
    || !Number.isInteger(result.resource.tour_id)
    || !["completed", "capture_unavailable", "save_failed"].includes(result.status || "")
  ) return null;
  return result as ReaiViewerActionResult;
}
