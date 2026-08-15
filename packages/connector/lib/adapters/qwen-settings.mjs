const qwenEnvironmentKeys = new Set(["QWEN_HOME", "QWEN_RUNTIME_DIR"]);

export function parseQwenEnvironment(contents) {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || !qwenEnvironmentKeys.has(match[1])) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    )
      value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "").trim();
    if (value) values[match[1]] = value;
  }
  return values;
}

export function stripJsonComments(contents) {
  let output = "";
  let string = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];
    const next = contents[index + 1];
    if (lineComment) {
      if (character === "\n" || character === "\r") {
        lineComment = false;
        output += character;
      } else output += " ";
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        output += "  ";
        index += 1;
        blockComment = false;
      } else output += character === "\n" || character === "\r" ? character : " ";
      continue;
    }
    if (string) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') string = false;
      continue;
    }
    if (character === '"') {
      string = true;
      output += character;
    } else if (character === "/" && next === "/") {
      output += "  ";
      index += 1;
      lineComment = true;
    } else if (character === "/" && next === "*") {
      output += "  ";
      index += 1;
      blockComment = true;
    } else output += character === "\ufeff" && index === 0 ? " " : character;
  }
  return output;
}

export function parseQwenJsonc(contents) {
  return JSON.parse(stripJsonComments(contents));
}

function skipWhitespace(contents, index) {
  while (/\s/.test(contents[index] ?? "")) index += 1;
  return index;
}

function stringEnd(contents, start) {
  let escaped = false;
  for (let index = start + 1; index < contents.length; index += 1) {
    const character = contents[index];
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === '"') return index + 1;
  }
  throw new Error("Unterminated JSONC string");
}

function valueEnd(contents, start) {
  if (contents[start] === '"') return stringEnd(contents, start);
  if (contents[start] === "{" || contents[start] === "[") {
    const stack = [contents[start]];
    let string = false;
    let escaped = false;
    for (let index = start + 1; index < contents.length; index += 1) {
      const character = contents[index];
      if (string) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') string = false;
        continue;
      }
      if (character === '"') string = true;
      else if (character === "{" || character === "[") stack.push(character);
      else if (character === "}" || character === "]") {
        const opening = stack.pop();
        if ((opening === "{" && character !== "}") || (opening === "[" && character !== "]"))
          throw new Error("Invalid JSONC structure");
        if (stack.length === 0) return index + 1;
      }
    }
    throw new Error("Unterminated JSONC value");
  }
  let index = start;
  while (index < contents.length && contents[index] !== "," && contents[index] !== "}") index += 1;
  return index;
}

function topLevelMembers(contents) {
  let index = skipWhitespace(contents, 0);
  if (contents[index] !== "{") throw new Error("Qwen settings must be a JSON object");
  index += 1;
  const members = [];
  for (;;) {
    index = skipWhitespace(contents, index);
    if (contents[index] === "}") return { members, rootClose: index };
    if (contents[index] !== '"') throw new Error("Invalid JSONC object key");
    const keyStart = index;
    const keyEnd = stringEnd(contents, keyStart);
    const key = JSON.parse(contents.slice(keyStart, keyEnd));
    index = skipWhitespace(contents, keyEnd);
    if (contents[index] !== ":") throw new Error("Invalid JSONC object member");
    const valueStart = skipWhitespace(contents, index + 1);
    const end = valueEnd(contents, valueStart);
    members.push({ key, keyStart, valueStart, valueEnd: end });
    index = skipWhitespace(contents, end);
    if (contents[index] === ",") index += 1;
    else if (contents[index] !== "}") throw new Error("Invalid JSONC object separator");
  }
}

function indentedValue(value, indent) {
  return JSON.stringify(value, null, 2).replaceAll("\n", `\n${indent}`);
}

export function setQwenJsoncProperty(contents, property, value) {
  const parsed = parseQwenJsonc(contents);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Qwen settings must be a JSON object");
  const stripped = stripJsonComments(contents);
  const { members, rootClose } = topLevelMembers(stripped);
  const existing = members.find((member) => member.key === property);
  if (existing) {
    const lineStart = contents.lastIndexOf("\n", existing.keyStart - 1) + 1;
    const indent = contents.slice(lineStart, existing.keyStart).match(/^[ \t]*/)?.[0] ?? "  ";
    return `${contents.slice(0, existing.valueStart)}${indentedValue(value, indent)}${contents.slice(existing.valueEnd)}`;
  }

  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const indent = "  ";
  let updated = contents;
  let close = rootClose;
  if (members.length > 0) {
    const last = members.at(-1);
    updated = `${updated.slice(0, last.valueEnd)},${updated.slice(last.valueEnd)}`;
    close += 1;
  }
  const beforeClose = updated.slice(0, close);
  const leadingNewline = /(?:\r?\n)[ \t]*$/.test(beforeClose) ? "" : newline;
  const member = `${indent}${JSON.stringify(property)}: ${indentedValue(value, indent)}${newline}`;
  return `${beforeClose}${leadingNewline}${member}${updated.slice(close)}`;
}
