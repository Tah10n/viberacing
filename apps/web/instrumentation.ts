import type { Instrumentation } from "next";
import { validateRuntimeConfig } from "./lib/config";
import {
  installProductionConsoleGuard,
  logError,
  logInfo,
  safeErrorFields,
  serializeRequiredError,
  writeRequiredError,
} from "./lib/log";

function publicRouteTemplate(routePath: string): string {
  const route = routePath.replace(/^\/app/, "").replace(/\/(?:page|route)$/, "") || "/";
  return /^\/[A-Za-z0-9_./[\]-]{0,200}$/.test(route) ? route : "unknown";
}

export async function register(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  installProductionConsoleGuard();
  try {
    validateRuntimeConfig();
  } catch (error) {
    const fields = safeErrorFields(error);
    if (process.env.NODE_ENV === "production" && process.env.NEXT_RUNTIME === "nodejs") {
      const { exitInvalidRuntimeConfiguration } = await import("./lib/startup.node");
      exitInvalidRuntimeConfiguration(
        serializeRequiredError("server_configuration_invalid", fields),
      );
    }
    writeRequiredError("server_configuration_invalid", fields);
    throw error;
  }
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
