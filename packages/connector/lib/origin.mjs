export function normalizeOrigin(value, label = "origin") {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${label} must be an HTTP(S) origin`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an HTTP(S) origin`);
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !["https:", "http:"].includes(url.protocol)
  )
    throw new Error(`${label} must be an HTTP(S) origin`);
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("Non-local origins must use HTTPS");
  return url.origin;
}
