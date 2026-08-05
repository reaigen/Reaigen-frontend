export type DoorPoint = [number, number];

export interface DoorPresentationConfig {
  doorType: string;
  hingeSide: string;
  swingDirection: string;
}

const distance = (a: DoorPoint, b: DoorPoint): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Resolve missing RoomPlan presentation metadata from measured topology.
 * The solver remains conservative and reserves both plausible swing sectors;
 * this function only chooses the conventional consumer-plan glyph. */
export function inferDoorPresentationConfig(
  door: { p1: DoorPoint; p2: DoorPoint },
  config: DoorPresentationConfig | undefined,
  walls: [DoorPoint, DoorPoint][],
): DoorPresentationConfig {
  if (config?.doorType === "Moving") return config;
  if (
    config?.doorType === "Swinging"
    && config.hingeSide !== "Moving"
    && config.swingDirection !== "Moving"
  ) return config;

  const dx = door.p2[0] - door.p1[0];
  const dy = door.p2[1] - door.p1[1];
  const doorLength = Math.max(Math.hypot(dx, dy), 1e-6);
  const doorAxis: DoorPoint = [dx / doorLength, dy / doorLength];

  const cornerScore = (point: DoorPoint): number => {
    let score = Infinity;
    for (const [a, b] of walls) {
      const wx = b[0] - a[0];
      const wy = b[1] - a[1];
      const wallLength = Math.hypot(wx, wy);
      if (wallLength < 0.08) continue;
      const alignment = Math.abs((wx / wallLength) * doorAxis[0] + (wy / wallLength) * doorAxis[1]);
      // A perpendicular wall return is stronger hinge evidence than the two
      // collinear wall stubs that terminate at an opening.
      const alignmentPenalty = alignment < 0.35 ? 0 : 0.12;
      score = Math.min(score, distance(point, a) + alignmentPenalty, distance(point, b) + alignmentPenalty);
    }
    return score;
  };

  const p1Score = cornerScore(door.p1);
  const p2Score = cornerScore(door.p2);
  return {
    doorType: "Swinging",
    hingeSide: p2Score + 1e-6 < p1Score ? "Right" : "Left",
    // DoorSwing selects the actual geometric side from the measured interior,
    // so this is an inward semantic request rather than a fixed world side.
    swingDirection: "In",
  };
}
