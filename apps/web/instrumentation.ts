import type { Instrumentation } from "next";
import { logError, logInfo, safeErrorFields } from "./lib/log";

function publicRouteTemplate(routePath: string): string {
  const route = routePath.replace(/^\/app/, "").replace(/\/(?:page|route)$/, "") || "/";
  return /^\/[A-Za-z0-9_./[\]-]{0,200}$/.test(route) ? route : "unknown";
}

export function register(): void {
  logInfo("server_started", {
    environment: process.env.NODE_ENV,
    runtime: process.env.NEXT_RUNTIME ?? "unknown",
  });
}

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  logError("next_request_error", {
    method: request.method,
    route: publicRouteTemplate(context.routePath),
    routeType: context.routeType,
    routerKind: context.routerKind,
    ...(context.renderSource === undefined ? {} : { renderSource: context.renderSource }),
    ...safeErrorFields(error),
  });
};
