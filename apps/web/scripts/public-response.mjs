import { Buffer } from "node:buffer";
// Public dynamic responses are bounded and held until rendering finishes, so a
// database timeout cannot become a streamed HTTP 200 error page.
export function holdPublicResponse(response, state, maximumBytes = 2 * 1024 * 1024) {
  const write = response.write.bind(response);
  const end = response.end.bind(response);
  const writeHead = response.writeHead.bind(response);
  let chunks = [];
  let bytes = 0;
  function append(chunk, encoding) {
    if (chunk == null || state.overloaded) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    bytes += buffer.length;
    if (bytes > maximumBytes) {
      state.overloaded = true;
      chunks = [];
    } else chunks.push(buffer);
  }
  response.flushHeaders = () => {};
  response.writeHead = (status, message, headers) => {
    response.statusCode = status;
    if (typeof message === "string") response.statusMessage = message;
    else headers = message;
    for (const [key, value] of Object.entries(headers ?? {})) response.setHeader(key, value);
    return response;
  };
  response.write = (chunk, encoding, callback) => {
    append(chunk, typeof encoding === "string" ? encoding : undefined);
    const done = typeof encoding === "function" ? encoding : callback;
    if (done) globalThis.queueMicrotask(done);
    return true;
  };
  response.end = (chunk, encoding, callback) => {
    append(chunk, typeof encoding === "string" ? encoding : undefined);
    response.writeHead = writeHead;
    response.write = write;
    response.end = end;
    const done = typeof encoding === "function" ? encoding : callback;
    if (state.overloaded) {
      for (const name of ["Content-Length", "Content-Encoding", "ETag", "Location"])
        response.removeHeader(name);
      response.statusCode = 503;
      response.statusMessage = "Service Unavailable";
      response.setHeader("Retry-After", "1");
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      return end("Temporarily overloaded", done);
    }
    return end(Buffer.concat(chunks), done);
  };
}
