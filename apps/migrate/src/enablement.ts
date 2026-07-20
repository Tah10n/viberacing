type Environment = Readonly<Record<string, string | undefined>>;

export function migrationsAreEnabled(environment: Environment = process.env): boolean {
  try {
    return environment.VIBERACING_MIGRATIONS_ENABLED === "true";
  } catch {
    return false;
  }
}
