export const maximumDailyScore = 1_000;
export const maximumWeeklyScore = 7_000;

export interface ScoringInput {
  readonly id: string;
  readonly dailyTokens: readonly number[];
  readonly sourceCount: number;
  readonly freshnessDays: number;
}

export interface RankedScore {
  readonly activeDays: number;
  readonly dailyScores: readonly number[];
  readonly id: string;
  readonly rank: number;
  readonly weeklyScore: number;
}

function assertTokenCount(tokens: number): void {
  if (!Number.isSafeInteger(tokens) || tokens < 0) {
    throw new RangeError("token count must be a non-negative safe integer");
  }
}

export function calculateDailyScore(tokens: number): number {
  assertTokenCount(tokens);
  return Math.min(maximumDailyScore, Math.round(250 * Math.log1p(tokens / 10_000)));
}

export function calculateWeeklyScore(dailyTokens: readonly number[]): number {
  if (dailyTokens.length !== 7) {
    throw new RangeError("a weekly score requires exactly seven daily token totals");
  }
  return Math.min(
    maximumWeeklyScore,
    dailyTokens.reduce((total, tokens) => total + calculateDailyScore(tokens), 0),
  );
}

export function rankWeeklyScores(inputs: readonly ScoringInput[]): readonly RankedScore[] {
  const scored = inputs.map((input) => {
    const dailyScores = input.dailyTokens.map(calculateDailyScore);
    return {
      id: input.id,
      dailyScores,
      activeDays: input.dailyTokens.filter((tokens) => tokens > 0).length,
      weeklyScore: Math.min(
        maximumWeeklyScore,
        dailyScores.reduce((total, score) => total + score, 0),
      ),
    };
  });

  scored.sort((left, right) => {
    const scoreOrder = right.weeklyScore - left.weeklyScore;
    if (scoreOrder !== 0) {
      return scoreOrder;
    }
    const activityOrder = right.activeDays - left.activeDays;
    return activityOrder !== 0 ? activityOrder : left.id.localeCompare(right.id);
  });

  let rank = 0;
  return scored.map((entry, index) => {
    const previous = scored[index - 1];
    if (previous?.weeklyScore !== entry.weeklyScore || previous.activeDays !== entry.activeDays) {
      rank = index + 1;
    }
    return { ...entry, rank };
  });
}

export function scoreProgress(score: number, leaderScore: number): number {
  if (leaderScore <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, score / leaderScore));
}
