import { afterEach } from "vitest";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: false,
  value: true,
  writable: false,
});

afterEach(() => {
  if (typeof document !== "undefined") {
    document.body.replaceChildren();
    document.documentElement.lang = "en";
  }
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
});
