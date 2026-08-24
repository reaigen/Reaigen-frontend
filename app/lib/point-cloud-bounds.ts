export interface PointCloudBounds {
  center: [number, number, number];
  radius: number;
}

const MAX_BOUND_SAMPLES = 32_768;

/** Frame the dense body of a scan instead of letting one triangulation outlier
 * make the apartment disappear into a tiny cluster in the viewport. */
export function robustPointCloudBounds(positions: Float32Array): PointCloudBounds {
  const pointCount = Math.floor(positions.length / 3);
  if (pointCount < 1) throw new Error("Point cloud contains no positions.");
  const sampleCount = Math.min(pointCount, MAX_BOUND_SAMPLES);
  const step = pointCount / sampleCount;
  const axes = [
    new Array<number>(sampleCount),
    new Array<number>(sampleCount),
    new Array<number>(sampleCount),
  ];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const point = Math.min(pointCount - 1, Math.floor(sample * step));
    axes[0][sample] = positions[point * 3];
    axes[1][sample] = positions[point * 3 + 1];
    axes[2][sample] = positions[point * 3 + 2];
  }
  axes.forEach((axis) => axis.sort((left, right) => left - right));
  const trim = sampleCount >= 200 ? Math.floor(sampleCount * 0.01) : 0;
  const upper = sampleCount - 1 - trim;
  const lowerValues = axes.map((axis) => axis[trim]);
  const upperValues = axes.map((axis) => axis[upper]);
  const center: [number, number, number] = [
    (lowerValues[0] + upperValues[0]) / 2,
    (lowerValues[1] + upperValues[1]) / 2,
    (lowerValues[2] + upperValues[2]) / 2,
  ];
  const radius = Math.max(
    0.05,
    Math.hypot(
      upperValues[0] - lowerValues[0],
      upperValues[1] - lowerValues[1],
      upperValues[2] - lowerValues[2],
    ) / 2,
  );
  if (![...center, radius].every(Number.isFinite)) {
    throw new Error("Point-cloud bounds are invalid.");
  }
  return { center, radius };
}
