const missing = (name: string): never => {
  throw new Error(`Missing required environment variable: ${name}`);
};

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? missing(name) : value;
}

export function publicOrigin(): URL {
  const url = new URL(process.env.VIBERACING_PUBLIC_ORIGIN ?? "http://localhost:3000");
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new Error("VIBERACING_PUBLIC_ORIGIN must be an origin without a path");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && (url.protocol !== "http:" || !loopback)) {
    throw new Error("VIBERACING_PUBLIC_ORIGIN must use HTTPS except on localhost");
  }
  return url;
}

export function secureCookies(): boolean {
  return publicOrigin().protocol === "https:";
}
