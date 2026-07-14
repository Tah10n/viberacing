import { afterEach } from "vitest";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: false,
  value: true,
  writable: false,
});

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.lang = "en";
  localStorage.clear();
});
