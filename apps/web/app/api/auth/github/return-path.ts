export function safeReturnPath(value: string | null, base: URL): string {
  if (value === null || value.length > 500 || !value.startsWith("/")) return "/dashboard";
  try {
    const target = new URL(value, base);
    return target.origin === base.origin
      ? `${target.pathname}${target.search}${target.hash}`
      : "/dashboard";
  } catch {
    return "/dashboard";
  }
}
