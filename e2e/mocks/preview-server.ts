// Local stand-in for `vite preview` — that command doesn't work for this
// project: vite.config.ts hard-pins Nitro's `preset: "vercel"`, which
// outputs Vercel's Build Output API v3 format (.vercel/output/static +
// .vercel/output/functions/__server.func/index.mjs, a Web-standard
// `{fetch(Request): Response}` handler) rather than the generic
// dist/server/server.js layout TanStack Start's own preview plugin
// expects — confirmed by running `npm run preview` directly and getting
// `ERR_MODULE_NOT_FOUND: dist/server/server.js`. `docs/DEVELOPMENT.md`'s
// claim that `npm run preview` serves the production build is stale
// relative to that preset being pinned; flagged in docs/E2E_TEST_REPORT.md
// rather than silently worked around.
//
// This server reproduces just enough of .vercel/output/config.json's
// routing (confirmed by reading it: cache headers on /assets/**, a
// filesystem check, then a catch-all to the function) to serve a real
// build for Playwright: static files from .vercel/output/static when
// they exist, otherwise the SSR function — a genuine production-mode
// build (service worker registered, real bundling) rather than vite dev.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PORT = 4173;
const HOST = "127.0.0.1";
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const STATIC_DIR = join(ROOT, ".vercel/output/static");
const FUNCTION_ENTRY = join(ROOT, ".vercel/output/functions/__server.func/index.mjs");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

async function serveStaticFile(
  res: ServerResponse,
  filePath: string,
  pathname: string,
): Promise<boolean> {
  if (!existsSync(filePath)) return false;
  const info = await stat(filePath);
  if (!info.isFile()) return false;
  const ext = extname(filePath);
  const body = await readFile(filePath);
  const headers: Record<string, string> = {
    "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
  };
  if (pathname.startsWith("/assets/")) {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  }
  res.writeHead(200, headers);
  res.end(body);
  return true;
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

let handlerPromise: Promise<{ fetch(req: Request): Promise<Response> }> | undefined;
function getHandler() {
  if (!handlerPromise) {
    // Dynamic import() requires a file:// URL on Windows, not a raw
    // drive-letter path (`c:\...` is parsed as an unsupported URL scheme).
    handlerPromise = import(pathToFileURL(FUNCTION_ENTRY).href).then((m) => m.default);
  }
  return handlerPromise;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

    if (
      url.pathname !== "/" &&
      (await serveStaticFile(res, join(STATIC_DIR, url.pathname), url.pathname))
    ) {
      return;
    }

    const handler = await getHandler();
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(key, value);
      else if (Array.isArray(value)) headers.set(key, value.join(", "));
    }
    const body = await readRequestBody(req);
    const request = new Request(url, {
      method: req.method,
      headers,
      body,
      // @ts-expect-error - Node's fetch Request requires this for a body-bearing request
      duplex: body ? "half" : undefined,
    });

    const response = await handler.fetch(request);
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    res.writeHead(response.status, responseHeaders);
    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
  } catch (err) {
    console.error("[preview-server] request failed", err);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal error in E2E preview server");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[preview-server] serving .vercel/output on http://${HOST}:${PORT}`);
});
