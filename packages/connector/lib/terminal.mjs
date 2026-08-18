const terminalControlPattern = /[\u0000-\u001f\u007f-\u009f]/u;
const terminalControlGlobalPattern = /[\u0000-\u001f\u007f-\u009f]/gu;

export function hasTerminalControlCharacters(value) {
  return typeof value === "string" && terminalControlPattern.test(value);
}

export function sanitizeTerminalText(value) {
  return String(value).replace(terminalControlGlobalPattern, "�");
}
