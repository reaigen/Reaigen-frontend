export interface TrainingIterationPolicy {
  minimum_iterations: number;
  maximum_iterations: number;
  iteration_step: number;
}

/** Validate against the active Django lookup; this module owns no GPU limits. */
export function parseTrainingIterations(
  value: unknown,
  policy: TrainingIterationPolicy | null | undefined,
): number | null {
  if (!policy) return null;
  const minimum = policy.minimum_iterations;
  const maximum = policy.maximum_iterations;
  const step = policy.iteration_step;
  if (
    !Number.isInteger(minimum)
    || !Number.isInteger(maximum)
    || !Number.isInteger(step)
    || minimum < 1
    || maximum < minimum
    || step < 1
  ) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < minimum || parsed > maximum) return null;
  if ((parsed - minimum) % step !== 0) return null;
  return parsed;
}
