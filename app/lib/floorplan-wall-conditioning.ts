export type V2 = [number, number];

export function conditionWallSegmentsForPresentation(
  segments: [V2, V2][],
  interior: V2,
  floorPolygons: V2[][] = []
): [V2, V2][] {
  const minimumLength = 0.06;
  const distance = (a: V2, b: V2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const normalized = segments
    .filter(([a, b]) => distance(a, b) >= minimumLength)
    .map(([a, b]) => [[...a] as V2, [...b] as V2] as [V2, V2]);

  const dedupe = (input: [V2, V2][]): [V2, V2][] => {
    const seen = new Set<string>();
    const result: [V2, V2][] = [];
    const pointKey = (point: V2) =>
      `${Math.round(point[0] * 1000)},${Math.round(point[1] * 1000)}`;
    for (const segment of input) {
      if (distance(segment[0], segment[1]) < minimumLength) continue;
      const keys = [pointKey(segment[0]), pointKey(segment[1])].sort();
      const key = `${keys[0]}|${keys[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(segment);
    }
    return result;
  };

  const polygonEdges = floorPolygons.flatMap((polygon) => {
    if (polygon.length < 3) return [];
    const edges: [V2, V2][] = [];
    for (let index = 0; index < polygon.length; index += 1) {
      const next = (index + 1) % polygon.length;
      edges.push([polygon[index], polygon[next]]);
    }
    return edges;
  });
  if (polygonEdges.length >= 3) return dedupe(polygonEdges);
  if (normalized.length < 2) return normalized;

  type AxisRun = {
    orientation: "horizontal" | "vertical";
    line: number;
    lineSamples: number[];
    intervals: Array<[number, number]>;
  };
  const groups: AxisRun[] = [];
  const diagonals: [V2, V2][] = [];
  const lineTolerance = 0.06;

  for (const [a, b] of normalized) {
    const dx = Math.abs(b[0] - a[0]);
    const dz = Math.abs(b[1] - a[1]);
    const orientation =
      dx >= dz * 4 ? "horizontal" : dz >= dx * 4 ? "vertical" : null;
    if (!orientation) {
      diagonals.push([a, b]);
      continue;
    }
    const line = orientation === "horizontal" ? (a[1] + b[1]) / 2 : (a[0] + b[0]) / 2;
    const start = orientation === "horizontal" ? Math.min(a[0], b[0]) : Math.min(a[1], b[1]);
    const end = orientation === "horizontal" ? Math.max(a[0], b[0]) : Math.max(a[1], b[1]);
    let group = groups.find(
      (candidate) =>
        candidate.orientation === orientation &&
        Math.abs(candidate.line - line) <= lineTolerance
    );
    if (!group) {
      group = { orientation, line, lineSamples: [], intervals: [] };
      groups.push(group);
    }
    group.lineSamples.push(line);
    group.line =
      group.lineSamples.reduce((sum, value) => sum + value, 0) /
      group.lineSamples.length;
    group.intervals.push([start, end]);
  }

  const allPoints = normalized.flatMap(([a, b]) => [a, b]);
  const minX = Math.min(...allPoints.map((point) => point[0]));
  const maxX = Math.max(...allPoints.map((point) => point[0]));
  const minZ = Math.min(...allPoints.map((point) => point[1]));
  const maxZ = Math.max(...allPoints.map((point) => point[1]));
  const result: [V2, V2][] = [...diagonals];

  for (const group of groups) {
    const sourceIntervals = [...group.intervals].sort((a, b) => a[0] - b[0]);
    const measured: Array<[number, number]> = [];
    for (const interval of sourceIntervals) {
      const previous = measured[measured.length - 1];
      if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
      else measured.push([...interval] as [number, number]);
    }

    const cornerCoordinates: number[] = [];
    for (const [a, b] of normalized) {
      const dx = Math.abs(b[0] - a[0]);
      const dz = Math.abs(b[1] - a[1]);
      const perpendicular =
        group.orientation === "horizontal" ? dz >= dx * 4 : dx >= dz * 4;
      if (!perpendicular) continue;
      for (const endpoint of [a, b]) {
        const endpointLine = group.orientation === "horizontal" ? endpoint[1] : endpoint[0];
        if (Math.abs(endpointLine - group.line) <= 0.1) {
          cornerCoordinates.push(
            group.orientation === "horizontal" ? endpoint[0] : endpoint[1]
          );
        }
      }
    }

    const measuredStart = measured[0][0];
    const measuredEnd = measured[measured.length - 1][1];
    const extentStart = Math.min(measuredStart, ...cornerCoordinates);
    const extentEnd = Math.max(measuredEnd, ...cornerCoordinates);
    const measuredLength = measured.reduce((sum, [start, end]) => sum + end - start, 0);
    const extentLength = Math.max(extentEnd - extentStart, minimumLength);
    const coverage = measuredLength / extentLength;
    const outerCoordinate =
      group.orientation === "horizontal"
        ? group.line < interior[1]
          ? minZ
          : maxZ
        : group.line < interior[0]
          ? minX
          : maxX;
    const isExterior = Math.abs(group.line - outerCoordinate) <= 0.1;

    const outputIntervals: Array<[number, number]> = [];
    if (isExterior && coverage >= 0.45) {
      outputIntervals.push([extentStart, extentEnd]);
    } else {
      for (const interval of measured) {
        const previous = outputIntervals[outputIntervals.length - 1];
        if (previous && interval[0] - previous[1] <= 0.16) previous[1] = interval[1];
        else outputIntervals.push([...interval] as [number, number]);
      }
    }

    for (const [start, end] of outputIntervals) {
      result.push(
        group.orientation === "horizontal"
          ? [[start, group.line], [end, group.line]]
          : [[group.line, start], [group.line, end]]
      );
    }
  }

  return dedupe(result);
}
