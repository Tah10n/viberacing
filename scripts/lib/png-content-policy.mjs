const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const allowedPublicChunks = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "bKGD",
  "cHRM",
  "cICP",
  "cLLi",
  "gAMA",
  "mDCv",
  "pHYs",
  "sBIT",
  "sRGB",
  "tRNS",
]);

const crcTable = new Uint32Array(256);
for (let value = 0; value < crcTable.length; value += 1) {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  crcTable[value] = crc >>> 0;
}

function crc32(buffer, start, end) {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc = crcTable[(crc ^ buffer[offset]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assertPng(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function parsePng(buffer) {
  assertPng(Buffer.isBuffer(buffer), "input is not a Buffer");
  assertPng(buffer.length >= pngSignature.length, "file is shorter than the PNG signature");
  assertPng(
    buffer.subarray(0, pngSignature.length).equals(pngSignature),
    "signature does not identify a PNG file",
  );

  const chunks = [];
  let offset = pngSignature.length;
  let reachedEnd = false;

  while (offset < buffer.length) {
    assertPng(buffer.length - offset >= 12, "chunk header or checksum is truncated");
    const dataLength = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + dataLength;
    assertPng(chunkEnd <= buffer.length, "chunk data extends beyond the file");

    const type = buffer.toString("ascii", offset + 4, offset + 8);
    assertPng(/^[A-Za-z]{4}$/.test(type), "chunk type contains invalid bytes");

    const checksumOffset = offset + 8 + dataLength;
    const expectedChecksum = buffer.readUInt32BE(checksumOffset);
    const actualChecksum = crc32(buffer, offset + 4, checksumOffset);
    assertPng(expectedChecksum === actualChecksum, `${type} chunk checksum is invalid`);

    chunks.push({ dataLength, end: chunkEnd, start: offset, type });
    offset = chunkEnd;

    if (type === "IEND") {
      reachedEnd = true;
      break;
    }
  }

  assertPng(chunks.length > 0, "PNG contains no chunks");
  assertPng(chunks[0].type === "IHDR", "IHDR is not the first chunk");
  assertPng(chunks[0].dataLength === 13, "IHDR length is not 13 bytes");
  assertPng(buffer.readUInt32BE(chunks[0].start + 8) > 0, "PNG width is zero");
  assertPng(buffer.readUInt32BE(chunks[0].start + 12) > 0, "PNG height is zero");
  assertPng(
    chunks.filter(({ type }) => type === "IHDR").length === 1,
    "PNG has multiple IHDR chunks",
  );
  assertPng(
    chunks.some(({ type }) => type === "IDAT"),
    "PNG contains no IDAT chunk",
  );
  assertPng(reachedEnd, "PNG contains no IEND chunk");
  assertPng(chunks.at(-1)?.dataLength === 0, "IEND length is not zero");
  assertPng(offset === buffer.length, "PNG has trailing data after IEND");

  return chunks;
}

export function readPngDimensions(buffer) {
  const [header] = parsePng(buffer);
  return Object.freeze({
    height: buffer.readUInt32BE(header.start + 12),
    width: buffer.readUInt32BE(header.start + 8),
  });
}

export function inspectPublicPng(buffer) {
  try {
    const chunks = parsePng(buffer);
    return [
      ...new Set(
        chunks
          .filter(({ type }) => !allowedPublicChunks.has(type))
          .map(({ type }) => `PNG chunk ${JSON.stringify(type)} is not allowed in public assets`),
      ),
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown parser failure";
    return [`PNG validation failed: ${message}`];
  }
}

export function sanitizePublicPng(buffer) {
  const chunks = parsePng(buffer);
  const removedTypes = [];
  const retained = [pngSignature];

  for (const chunk of chunks) {
    if (allowedPublicChunks.has(chunk.type)) {
      retained.push(buffer.subarray(chunk.start, chunk.end));
      continue;
    }

    assertPng(
      chunk.type[0] === chunk.type[0].toLowerCase(),
      `refusing to remove unknown critical chunk ${chunk.type}`,
    );
    removedTypes.push(chunk.type);
  }

  const sanitized = Buffer.concat(retained);
  assertPng(inspectPublicPng(sanitized).length === 0, "sanitized PNG failed public policy");
  return { buffer: sanitized, removedTypes };
}
