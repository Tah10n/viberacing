import { calculateDailyScore, maximumWeeklyScore } from "./scoring";

export const maximumSimulatorTokenCount = Number.MAX_SAFE_INTEGER;
export { maximumWeeklyScore as maximumSimulatorWeeklyScore } from "./scoring";

export interface ScoreSimulation {
  readonly dailyScore: number;
  readonly weeklyScore: number;
}

const canonicalTokenCount = /^(?:0|[1-9][0-9]{0,15})$/u;

export function parseSimulatorTokenCount(value: string): number | undefined {
  if (!canonicalTokenCount.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function simulateScore(tokenCount: number, activeDays: number): ScoreSimulation {
  const dailyScore = calculateDailyScore(tokenCount);
  if (!Number.isInteger(activeDays) || activeDays < 0 || activeDays > 7) {
    throw new RangeError("active days must be an integer from zero through seven");
  }
  return {
    dailyScore,
    weeklyScore: Math.min(maximumWeeklyScore, dailyScore * activeDays),
  };
}
