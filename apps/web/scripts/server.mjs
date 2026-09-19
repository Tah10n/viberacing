import { createServer } from "node:http";
import { writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { setTimeout } from "node:timers";
import next from "next";
import { AsyncLocalStorage } from "node:async_hooks";
import { holdPublicResponse } from "./public-response.mjs";

const publicResponse = (globalThis.viberacingPublicResponse ??= new AsyncLocalStorage());

process.env.NODE_ENV = "production";
const appDirectory = fileURLToPath(new URL("..", import.meta.url));
process.chdir(appDirectory);
const manifest = JSON.parse(
  await readFile(new URL("../.next/required-server-files.json", import.meta.url), "utf8"),
);
const app = next({
  dev: false,
  dir: appDirectory,
  conf: manifest.config,
});
await app.prepare();
const handle = app.getRequestHandler();
let active = 0;
let publicActive = 0;
let requests = 0;
let overloads = 0;
let nextSummary = Date.now() + 60000;
const server = createServer(
  {
    maxHeaderSize: 16384,
    headersTimeout: 5000,
    requestTimeout: 10000,
    connectionsCheckingInterval: 1000,
  },
  async (request, response) => {
    requests += 1;
    if (Date.now() >= nextSummary) {
      writeSync(
        1,
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          service: "viberacing-web",
          event: "http_resource_summary",
          requests,
          overloads,
          active,
          publicActive,
          rssBytes: process.memoryUsage().rss,
        }) + "\n",
      );
      requests = 0;
      overloads = 0;
      nextSummary = Date.now() + 60000;
    }
    const requestId = randomUUID();
    response.setHeader("X-Request-Id", requestId);
    let pathname;
    try {
      pathname = new URL(request.url, "http://local.invalid").pathname;
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    // Treat every non-API dynamic path as public cost, including encoded/unknown paths.
    const control = /^\/(?:api(?:\/|$)|health$|ready$|dashboard(?:\/|$)|connect(?:\/|$))/.test(
      pathname,
    );
    const asset = pathname.startsWith("/_next/static/") || /^\/favicon\.(ico|svg)$/.test(pathname);
    const costly = !control && !asset;
    if (active >= 32 || (costly && publicActive >= 4)) {
      overloads += 1;
      response.writeHead(503, {
        "Retry-After": "1",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      });
      response.end("Temporarily overloaded");
      return;
    }
    active += 1;
    if (costly) publicActive += 1;
    // Hold the slot until Next has actually stopped work, even if the peer disconnects.
    try {
      if (costly) {
        const state = { overloaded: false };
        holdPublicResponse(
          response,
          state,
          pathname === "/sitemap.xml" ? 32 * 1024 * 1024 : undefined,
        );
        await publicResponse.run(state, () => handle(request, response));
      } else {
        await handle(request, response);
      }
    } catch {
      if (!response.headersSent)
        response.writeHead(503, {
          "Retry-After": "1",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        });
      response.end();
    } finally {
      active -= 1;
      if (costly) publicActive -= 1;
    }
  },
);
server.maxConnections = 128;
server.keepAliveTimeout = 5000;
server.maxRequestsPerSocket = 100;
server.setTimeout(15000, (socket) => socket.destroy());
server.listen(Number(process.env.PORT ?? 3000), process.env.HOSTNAME ?? "0.0.0.0");
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    server.close(() => {
      void app.close().finally(() => process.exit(0));
    });
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), 15000).unref();
  });
}
