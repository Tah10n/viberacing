import { resolve } from "node:path";

import type { NextConfig } from "next";

export const workspaceRoot = resolve(process.cwd(), "../..");

export const baseSecurityHeaders: readonly Readonly<{ key: string; value: string }>[] = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Origin-Agent-Cluster", value: "?1" },
  {
    key: "Permissions-Policy",
    value:
      "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(self), screen-wake-lock=(), usb=()",
  },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "X-XSS-Protection", value: "0" },
];

export function securityHeaders(production: boolean): { key: string; value: string }[] {
  return [
    ...baseSecurityHeaders,
    ...(production
      ? [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ]
      : []),
  ];
}

export const nextConfig: NextConfig = {
  compress: true,
  generateEtags: true,
  images: {
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    dangerouslyAllowSVG: false,
    remotePatterns: [],
    unoptimized: true,
  },
  logging: {
    incomingRequests: { ignore: [/\/auth\/github\/callback(?:\?|$)/] },
  },
  output: "standalone",
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  reactStrictMode: true,
  transpilePackages: ["pg"],
  turbopack: {
    root: workspaceRoot,
  },
  typedRoutes: true,
  headers() {
    const headers = securityHeaders(process.env.NODE_ENV === "production");
    return Promise.resolve([{ source: "/(.*)", headers }]);
  },
};

export default nextConfig;
