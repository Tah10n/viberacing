import { afterEach, expect, it, vi } from "vitest";
import { withRequestLogging } from "./request-log";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
it("disabled debug events consume no capacity; ordinary traffic cannot starve bounded errors", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VIBERACING_LOG_LEVEL", "info");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-01-01T12:00:00Z"));
  const info = vi.spyOn(console, "log").mockImplementation(() => {});
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const request = new Request("https://example.test/ready");
  const quiet = withRequestLogging<[Request]>("/ready", () => new Response(), {
    successLevel: "debug",
  });
  for (let i = 0; i < 200; i++) await quiet(request);
  const success = withRequestLogging<[Request]>("/api/example", () => new Response());
  for (let i = 0; i < 150; i++) await success(request);
  const completed = () =>
    info.mock.calls.filter((call) => String(call[0]).includes('"event":"http_request_completed"'));
  expect(completed()).toHaveLength(100);
  const failed = withRequestLogging<[Request]>("/api/example", () => {
    throw Object.assign(new Error("private fixture password"), { code: "57P01" });
  });
  const response = await failed(request);
  expect(errors).toHaveBeenCalledOnce();
  expect(JSON.parse(String(errors.mock.calls[0]?.[0]))).toMatchObject({
    requestId: response.headers.get("X-Request-Id"),
    errorCode: "57P01",
    event: "http_request_failed",
  });
  for (let i = 0; i < 100; i++) await failed(request);
  expect(errors).toHaveBeenCalledTimes(20);
  expect(JSON.stringify(errors.mock.calls)).not.toMatch(/private fixture|password|stack/);
  vi.setSystemTime(new Date("2030-01-01T12:01:00Z"));
  await failed(request);
  expect(errors).toHaveBeenCalledTimes(21);
});
