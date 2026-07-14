import assert from "node:assert/strict";
import { inspectPublicPng, parsePng, sanitizePublicPng } from "./lib/png-content-policy.mjs";

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return output;
}

function fixture(extraChunks = []) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    ...extraChunks,
    chunk("IDAT", Buffer.from([0])),
    chunk("IEND"),
  ]);
}

const safe = fixture([chunk("sRGB", Buffer.from([0]))]);
assert.equal(parsePng(safe).length, 4);
assert.deepEqual(inspectPublicPng(safe), []);

const credential = fixture([chunk("caBX", Buffer.from("public certificate metadata", "utf8"))]);
assert.deepEqual(inspectPublicPng(credential), [
  'PNG chunk "caBX" is not allowed in public assets',
]);
const sanitized = sanitizePublicPng(credential);
assert.deepEqual(sanitized.removedTypes, ["caBX"]);
assert.deepEqual(inspectPublicPng(sanitized.buffer), []);
assert.ok(sanitized.buffer.includes(Buffer.from([0])));

const corrupted = Buffer.from(safe);
corrupted[corrupted.length - 1] ^= 0xff;
assert.match(inspectPublicPng(corrupted)[0], /checksum is invalid/);
assert.match(inspectPublicPng(Buffer.concat([safe, Buffer.from("trailing")]))[0], /trailing data/);
assert.match(inspectPublicPng(Buffer.from("not a png"))[0], /signature/);

console.log("PNG content-policy tests passed (7 assertions).");
