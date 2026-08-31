import type { TrainingQuality, TrainingResolution } from "./api/client";

export interface TrainingProfileDefaults {
  resolution: TrainingResolution;
  iterations: number;
}

export const TRAINING_PROFILE_DEFAULTS: Record<TrainingQuality, TrainingProfileDefaults> = {
  fast: { resolution: "res2", iterations: 5350 },
  balanced: { resolution: "res2", iterations: 15000 },
  quality: { resolution: "res1", iterations: 30000 },
};

export function parseTrainingIterations(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed !== 0 && (parsed < 1000 || parsed > 60000)) return null;
  return parsed;
}
