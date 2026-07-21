const adminActorReferencePattern = /^adm_[A-Za-z0-9_-]{21}[AQgw]$/;

export function isAdminActorReference(value: unknown): value is string {
  return typeof value === "string" && adminActorReferencePattern.test(value);
}
