import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProductionServer } from "../lib/production-server.mjs";

test("production server serves dashboard, API, and MCP from one origin", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ai-short-video-production-server-"));
  const distDir = path.join(rootDir, "dist");
  const server = createProductionServer({ rootDir, distDir });
  await mkdir(path.join(distDir, "assets"), { recursive: true });
  await writeFile(path.join(distDir, "index.html"), "<!doctype html><main>AI Short Video Factory production shell</main>", "utf8");
  await writeFile(path.join(distDir, "assets", "app.js"), "globalThis.__factoryProduction = true;", "utf8");
  await listen(server);

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const dashboard = await fetch(`${baseUrl}/`);
    assert.equal(dashboard.ok, true);
    assert.match(dashboard.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await dashboard.text(), /production shell/);

    const asset = await fetch(`${baseUrl}/assets/app.js`);
    assert.equal(asset.ok, true);
    assert.match(asset.headers.get("cache-control") ?? "", /immutable/);
    assert.match(asset.headers.get("content-type") ?? "", /text\/javascript/);

    const spaRoute = await fetch(`${baseUrl}/workspace/episodes`);
    assert.equal(spaRoute.ok, true);
    assert.match(await spaRoute.text(), /production shell/);

    const missingAsset = await fetch(`${baseUrl}/assets/missing.js`);
    assert.equal(missingAsset.status, 404);
    assert.equal((await missingAsset.json()).error, "not_found");

    const health = await fetchJson(`${baseUrl}/api/health`);
    assert.equal(health.ok, true);
    assert.equal(health.service, "ai-short-video-factory");

    const manifest = await fetchJson(`${baseUrl}/api/chatgpt/app-manifest`);
    assert.equal(manifest.ok, true);
    assert.equal(manifest.app.mcp_endpoint, `${baseUrl}/mcp`);
    assert.equal(manifest.app.uses_api_key_for_image2, false);

    const mcpInitialize = await fetchJson(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    });
    assert.equal(mcpInitialize.result.protocolVersion, "2025-06-18");
  } finally {
    await close(server);
    await rm(rootDir, { recursive: true, force: true });
  }
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  assert.equal(response.ok, true);
  return response.json();
}
