export function formatAgentShare(tokens: string, total: string): string {
  const denominator = BigInt(total);
  if (denominator === 0n) return "0%";
  return `${((BigInt(tokens) * 100n + denominator / 2n) / denominator).toString()}%`;
}

export function formatExactTokens(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function formatCompactTokens(value: string): string {
  const tokens = BigInt(value);
  const units = [
    { divisor: 1n, suffix: "" },
    { divisor: 1_000n, suffix: "K" },
    { divisor: 1_000_000n, suffix: "M" },
    { divisor: 1_000_000_000n, suffix: "B" },
    { divisor: 1_000_000_000_000n, suffix: "T" },
  ];
  let index = units.findLastIndex((unit) => tokens >= unit.divisor);
  if (index <= 0) return tokens.toString();
  let unit = units[index];
  if (unit === undefined) return tokens.toString();
  let tenths = (tokens * 10n + unit.divisor / 2n) / unit.divisor;
  if (tenths >= 10_000n && index < units.length - 1) {
    index += 1;
    unit = units[index] ?? unit;
    tenths = (tokens * 10n + unit.divisor / 2n) / unit.divisor;
  }
  const whole = tenths / 10n;
  const decimal = tenths % 10n;
  return `${whole.toString()}${decimal === 0n ? "" : `,${decimal.toString()}`}${unit.suffix}`;
}
