import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {
  CHATGPT_WIDGET_PATH,
  MCP_ENDPOINT_PATH,
  OAUTH_AUTHORIZE_PATH,
  OAUTH_AUTHORIZATION_SERVER_METADATA_PATH,
  OAUTH_PROTECTED_RESOURCE_PATH,
  OAUTH_REGISTER_PATH,
  OAUTH_TOKEN_PATH
} from "./chatgpt-app-constants.mjs";
import { handleApiRequest } from "./backend-api.mjs";

const STATIC_CACHE_SECONDS = 60 * 60 * 24 * 30;

export function createProductionServer({
  rootDir = process.cwd(),
  distDir = path.join(rootDir, "dist")
} = {}) {
  return http.createServer((request, response) => {
    handleProductionRequest(request, response, { rootDir, distDir }).catch((error) => {
      sendJson(response, 500, {
        ok: false,
        error: "production_server_error",
        message: error instanceof Error ? error.message : "Unknown production server error."
      });
    });
  });
}

export async function handleProductionRequest(request, response, { rootDir = process.cwd(), distDir = path.join(rootDir, "dist") } = {}) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (isBackendRoute(url.pathname)) {
    await handleApiRequest(request, response, { rootDir });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 404, {
      ok: false,
      error: "not_found",
      message: `${request.method} ${url.pathname} is not an AI Short Video Factory route.`
    });
    return;
  }

  await sendStaticAsset(request, response, { url, distDir });
}

function isBackendRoute(pathname) {
  return (
    pathname === MCP_ENDPOINT_PATH ||
    pathname === CHATGPT_WIDGET_PATH ||
    pathname === OAUTH_PROTECTED_RESOURCE_PATH ||
    pathname === OAUTH_AUTHORIZATION_SERVER_METADATA_PATH ||
    pathname === OAUTH_AUTHORIZE_PATH ||
    pathname === OAUTH_TOKEN_PATH ||
    pathname === OAUTH_REGISTER_PATH ||
    pathname === "/api" ||
    pathname.startsWith("/api/")
  );
}

async function sendStaticAsset(request, response, { url, distDir }) {
  const indexPath = path.join(distDir, "index.html");
  const safePath = resolveStaticPath(url.pathname, distDir);
  if (!safePath) {
    sendJson(response, 404, {
      ok: false,
      error: "not_found",
      message: `${request.method} ${url.pathname} is not a valid static route.`
    });
    return;
  }

  const filePath = await findStaticFile(safePath, indexPath, shouldFallbackToIndex(url.pathname));
  if (!filePath) {
    const indexAvailable = await fileExists(indexPath);
    if (!indexAvailable) {
      sendJson(response, 503, {
        ok: false,
        error: "frontend_build_missing",
        message: "Build the frontend with `npm run build` before running the production server."
      });
      return;
    }
    sendJson(response, 404, {
      ok: false,
      error: "not_found",
      message: `${request.method} ${url.pathname} is not a built frontend asset.`
    });
    return;
  }

  const stats = await stat(filePath);
  const isIndex = filePath === indexPath;
  response.writeHead(200, {
    "Cache-Control": isIndex ? "no-store" : `public, max-age=${STATIC_CACHE_SECONDS}, immutable`,
    "Content-Length": stats.size,
    "Content-Type": contentTypeFor(filePath)
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }

  const stream = createReadStream(filePath);
  stream.once("error", () => {
    response.destroy();
  });
  stream.pipe(response);
}

async function findStaticFile(candidate, indexPath, allowIndexFallback) {
  try {
    const stats = await stat(candidate);
    if (stats.isFile()) return candidate;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  if (!allowIndexFallback) return null;
  return (await fileExists(indexPath)) ? indexPath : null;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return false;
  }
}

function shouldFallbackToIndex(pathname) {
  if (pathname === "/") return true;
  return !path.extname(pathname);
}

function resolveStaticPath(pathname, distDir) {
  let decoded = "/";
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const normalized = decoded === "/" ? "/index.html" : decoded;
  const filePath = path.resolve(distDir, `.${normalized}`);
  const root = path.resolve(distDir);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return filePath;
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".ico") return "image/x-icon";
  if (extension === ".mp4") return "video/mp4";
  return "application/octet-stream";
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(data, null, 2)}\n`);
}
