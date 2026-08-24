export type LabelPoint = [number, number];

const distanceToSegment = (point: LabelPoint, a: LabelPoint, b: LabelPoint): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 1e-10) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSq));
  return Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dy * t));
};

export function labelPointInPolygon(point: LabelPoint, polygon: LabelPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (distanceToSegment(point, a, b) <= 1e-7) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1])) {
      const x = ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
      if (point[0] < x) inside = !inside;
    }
  }
  return inside;
}

function polygonCentroid(polygon: LabelPoint[]): LabelPoint {
  let areaTwice = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const next = (index + 1) % polygon.length;
    const cross = polygon[index][0] * polygon[next][1] - polygon[next][0] * polygon[index][1];
    areaTwice += cross;
    x += (polygon[index][0] + polygon[next][0]) * cross;
    y += (polygon[index][1] + polygon[next][1]) * cross;
  }
  if (Math.abs(areaTwice) <= 1e-8) {
    return [
      polygon.reduce((sum, point) => sum + point[0], 0) / polygon.length,
      polygon.reduce((sum, point) => sum + point[1], 0) / polygon.length,
    ];
  }
  return [x / (3 * areaTwice), y / (3 * areaTwice)];
}

/** Deterministic low-cost pole-of-inaccessibility approximation. Room labels
 * belong in visually open space, not at the arithmetic centre of an L room. */
export function highClearanceLabelPoint(polygon: LabelPoint[]): LabelPoint {
  const xs = polygon.map((point) => point[0]);
  const ys = polygon.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const centroid = polygonCentroid(polygon);
  const candidates: LabelPoint[] = [centroid];
  const divisions = 12;
  for (let ix = 0; ix < divisions; ix += 1) {
    for (let iy = 0; iy < divisions; iy += 1) {
      candidates.push([
        minX + ((ix + 0.5) / divisions) * (maxX - minX),
        minY + ((iy + 0.5) / divisions) * (maxY - minY),
      ]);
    }
  }
  let best = labelPointInPolygon(centroid, polygon) ? centroid : polygon[0];
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    if (!labelPointInPolygon(candidate, polygon)) continue;
    let clearance = Infinity;
    for (let index = 0; index < polygon.length; index += 1) {
      clearance = Math.min(
        clearance,
        distanceToSegment(candidate, polygon[index], polygon[(index + 1) % polygon.length]),
      );
    }
    const score = clearance - Math.hypot(candidate[0] - centroid[0], candidate[1] - centroid[1]) * 0.025;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export function assignLabelsToRoomPolygons(
  numbers: number[],
  rawPositions: Record<number, LabelPoint>,
  polygons: LabelPoint[][],
): { numbers: number[]; positions: Record<number, LabelPoint> } {
  if (!polygons.length) {
    const first = numbers.slice(0, 1);
    return {
      numbers: first,
      positions: Object.fromEntries(first.filter((number) => rawPositions[number]).map((number) => [number, rawPositions[number]])),
    };
  }

  const roomPoints = polygons.map(highClearanceLabelPoint);
  const pairs = numbers.flatMap((number) =>
    roomPoints.map((point, roomIndex) => ({
      number,
      roomIndex,
      contains: labelPointInPolygon(rawPositions[number] ?? point, polygons[roomIndex]),
      distance: Math.hypot(
        (rawPositions[number]?.[0] ?? point[0]) - point[0],
        (rawPositions[number]?.[1] ?? point[1]) - point[1],
      ),
    }))
  ).sort((a, b) =>
    Number(b.contains) - Number(a.contains)
    || a.distance - b.distance
    || a.number - b.number
    || a.roomIndex - b.roomIndex
  );

  const usedNumbers = new Set<number>();
  const usedRooms = new Set<number>();
  const positions: Record<number, LabelPoint> = {};
  for (const pair of pairs) {
    if (usedNumbers.has(pair.number) || usedRooms.has(pair.roomIndex)) continue;
    usedNumbers.add(pair.number);
    usedRooms.add(pair.roomIndex);
    positions[pair.number] = roomPoints[pair.roomIndex];
    if (usedNumbers.size >= Math.min(numbers.length, polygons.length)) break;
  }
  return { numbers: [...usedNumbers].sort((a, b) => a - b), positions };
}
