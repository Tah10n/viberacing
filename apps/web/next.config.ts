import { resolve } from "node:path";
import type { NextConfig } from "next";

export function applicationHeaders(production: boolean) {
  return [
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
  ];
}

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  reactStrictMode: true,
  transpilePackages: ["pg"],
  turbopack: { root: resolve(process.cwd(), "../..") },
  headers() {
    return Promise.resolve([
      {
        source: "/(.*)",
        headers: applicationHeaders(process.env.NODE_ENV === "production"),
      },
    ]);
  },
};

export default config;
