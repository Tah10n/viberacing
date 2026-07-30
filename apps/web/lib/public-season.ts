const minimumSeasonStart = "1999-12-27";
const maximumSeasonStart = "2099-12-28";
const handlePattern = /^[a-z0-9](?:[a-z0-9_-]{1,22}[a-z0-9])$/;

export function isCommunitySeasonStart(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value < minimumSeasonStart ||
    value > maximumSeasonStart ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getUTCDay() === 1
  );
}

export function currentCommunitySeasonStart(now: Date): string | undefined {
  const timestamp = now.valueOf();
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const seasonStart = monday.toISOString().slice(0, 10);
  return isCommunitySeasonStart(seasonStart) ? seasonStart : undefined;
}

export function isPublicSnapshotHandle(value: unknown): value is string {
  return typeof value === "string" && handlePattern.test(value);
}
