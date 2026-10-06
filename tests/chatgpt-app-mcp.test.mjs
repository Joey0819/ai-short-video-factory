import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApiServer } from "../lib/backend-api.mjs";

test("ChatGPT app manifest and OAuth metadata expose account-auth MCP contract", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ai-short-video-mcp-contract-"));
  const server = createApiServer({ rootDir });
  await listen(server);
  const restoreEnv = setOAuthEnv({});

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const manifest = await fetchJson(`${baseUrl}/api/chatgpt/app-manifest`);

    assert.equal(manifest.ok, true);
    assert.equal(manifest.app.auth_method, "ChatGPT Apps OAuth 2.1 / MCP");
    assert.equal(manifest.app.uses_api_key_for_image2, false);
    assert.equal(manifest.app.account_required_for_generation, true);
    assert.equal(manifest.app.image2.model, "gpt-image-2");
    assert.equal(manifest.app.image2.uses_api_key, false);
    assert.equal(manifest.app.image2.handoff_tool, "get_image2_handoff");
    assert.equal(manifest.app.image2.asset_intake_tool, "attach_image2_assets");
    assert.equal(manifest.app.mcp_endpoint, `${baseUrl}/mcp`);
    assert.equal(manifest.app.oauth_protected_resource, `${baseUrl}/.well-known/oauth-protected-resource`);
    assert.ok(manifest.app.tools.some((tool) => tool.name === "produce_short_video"));
    assert.ok(manifest.app.tools.some((tool) => tool.name === "get_image2_handoff"));
    assert.ok(manifest.app.tools.some((tool) => tool.name === "attach_image2_assets"));
    assert.ok(JSON.stringify(manifest).includes("sk-proj") === false);

    const metadata = await fetchJson(`${baseUrl}/.well-known/oauth-protected-resource`);
    assert.equal(metadata.resource, `${baseUrl}/mcp`);
    assert.deepEqual(metadata.authorization_servers, [`${baseUrl}/oauth-placeholder`]);
    assert.equal(metadata.authorization_server_metadata, `${baseUrl}/oauth-placeholder/.well-known/oauth-authorization-server`);
    assert.equal(metadata.oauth_mode, "development");
    assert.ok(metadata.scopes_supported.includes("image2:handoff"));
    assert.equal(metadata.uses_api_key_for_image2, false);
    assert.equal(metadata.resource_documentation, `${baseUrl}/api/chatgpt/app-manifest`);

    const authorizationServer = await fetchJson(`${baseUrl}/oauth-placeholder/.well-known/oauth-authorization-server`);
    assert.equal(authorizationServer.issuer, `${baseUrl}/oauth-placeholder`);
    assert.equal(authorizationServer.authorization_endpoint, `${baseUrl}/oauth-placeholder/authorize`);
    assert.equal(authorizationServer.token_endpoint, `${baseUrl}/oauth-placeholder/token`);
    assert.ok(authorizationServer.code_challenge_methods_supported.includes("S256"));
    assert.ok(authorizationServer.scopes_supported.includes("shortvideo:write"));

    const registration = await fetchJson(`${baseUrl}/oauth-placeholder/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "ChatGPT test client",
        redirect_uris: ["http://127.0.0.1/callback"],
        scope: "shortvideo:write image2:handoff"
      })
    });
    assert.equal(registration.token_endpoint_auth_method, "none");
    assert.equal(registration.scope, "shortvideo:write image2:handoff");

    const toolsList = await fetchJson(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    });
    assert.equal(toolsList.result.tools.length, 5);
    const readinessTool = toolsList.result.tools.find((tool) => tool.name === "get_product_readiness");
    const createTool = toolsList.result.tools.find((tool) => tool.name === "create_short_video_project");
    const produceTool = toolsList.result.tools.find((tool) => tool.name === "produce_short_video");
    const image2Tool = toolsList.result.tools.find((tool) => tool.name === "get_image2_handoff");
    const attachImage2Tool = toolsList.result.tools.find((tool) => tool.name === "attach_image2_assets");
    assert.deepEqual(readinessTool.securitySchemes, [{ type: "noauth" }]);
    assert.deepEqual(readinessTool._meta.securitySchemes, [{ type: "noauth" }]);
    assert.deepEqual(createTool.securitySchemes[0].scopes, ["shortvideo:write"]);
    assert.deepEqual(produceTool.securitySchemes[0].scopes, ["shortvideo:write", "image2:handoff"]);
    assert.deepEqual(image2Tool.securitySchemes[0].scopes, ["image2:handoff"]);
    assert.deepEqual(attachImage2Tool.securitySchemes[0].scopes, ["shortvideo:write", "image2:handoff"]);
    assert.equal(produceTool.securitySchemes[0].authorizationUrl, `${baseUrl}/oauth-placeholder/authorize`);
    assert.equal(produceTool._meta.ui.resourceUri, "ui://ai-short-video-factory/dashboard.html?v=1");
    assert.equal(produceTool._meta["openai/outputTemplate"], "ui://ai-short-video-factory/dashboard.html?v=1");
    assert.ok(toolsList.result.tools.every((tool) => !JSON.stringify(tool).includes("sk-proj")));

    const widget = await fetchJson(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: "ui://ai-short-video-factory/dashboard.html?v=1" } })
    });
    assert.equal(widget.result.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.equal(widget.result.contents[0]._meta.ui.csp.connectDomains[0], baseUrl);
    assert.equal(widget.result.contents[0]._meta.ui.domain, undefined);
  } finally {
    restoreEnv();
    await close(server);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("MCP account-auth tools require OAuth PKCE token and produce handoff after verification", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ai-short-video-mcp-produce-"));
  const server = createApiServer({ rootDir });
  await listen(server);
  const restoreEnv = setOAuthEnv({});

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const unauthenticated = await fetchJson(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "get_image2_handoff",
          arguments: { projectId: "demo-reference", episodeId: "episode-001" }
        }
      })
    });

    assert.equal(unauthenticated.result.isError, true);
    assert.equal(unauthenticated.result.structuredContent.authentication_required, true);
    assert.equal(unauthenticated.result.structuredContent.uses_api_key, false);
    assert.match(unauthenticated.result._meta["mcp/www_authenticate"][0], /missing_token/);
    assert.match(unauthenticated.result._meta["mcp/www_authenticate"][0], /resource_metadata=/);

    await writeFile(path.join(rootDir, ".env.local"), "CHATGPT_ACCOUNT_VERIFIED=true\nOPENAI_API_KEY=sk-proj-fake-test-key\n", "utf8");
    const invalidBearer = await fetchJson(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer invalid-token" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 30,
        method: "tools/call",
        params: {
          name: "produce_short_video",
          arguments: {
            topic: "AI robot bakery courtroom drama",
            count: 2,
            renderCount: 1,
            renderDuration: 3
          }
        }
      })
    });
    assert.equal(invalidBearer.result.isError, true);
    assert.match(invalidBearer.result._meta["mcp/www_authenticate"][0], /invalid_token/);

    const markerOnly = await fetchJson(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 31,
        method: "tools/call",
        params: {
          name: "produce_short_video",
          arguments: {
            topic: "AI robot bakery courtroom drama",
            count: 2,
            renderCount: 1,
            renderDuration: 3
          }
        }
      })
    });
    assert.equal(markerOnly.result.isError, true);
    assert.match(markerOnly.result._meta["mcp/www_authenticate"][0], /missing_token/);

    const partialScopeToken = await issueOAuthToken({
      baseUrl,
      scope: "shortvideo:write"
    });
    const missingImageScope = await fetchJson(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${partialScopeToken}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 32,
        method: "tools/call",
        params: {
          name: "produce_short_video",
          arguments: {
            topic: "AI robot bakery courtroom drama",
            count: 2,
            renderCount: 1,
            renderDuration: 3
          }
        }
      })
    });
    assert.equal(missingImageScope.result.isError, true);
    assert.match(missingImageScope.result._meta["mcp/www_authenticate"][0], /insufficient_scope/);
    assert.match(missingImageScope.result._meta["mcp/www_authenticate"][0], /image2:handoff/);

    const accessToken = await issueOAuthToken({
      baseUrl,
      scope: "shortvideo:write image2:handoff"
    });
    await writeFile(path.join(rootDir, ".env.local"), "CHATGPT_ACCOUNT_VERIFIED=false\nOPENAI_API_KEY=sk-proj-fake-test-key\n", "utf8");

    const produced = await fetchJson(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "produce_short_video",
          arguments: {
            topic: "AI robot bakery courtroom drama",
            count: 2,
            renderCount: 1,
            renderDuration: 3
          }
        }
      })
    });

    assert.equal(produced.result.structuredContent.content_count, 2);
    assert.equal(produced.result.structuredContent.rendered_count, 1);
    assert.equal(produced.result.structuredContent.provider_mode, "chatgpt-account");
    assert.equal(produced.result.structuredContent.production_package_path, "outputs/demo-reference/production-package.tar.gz");
    assert.equal(JSON.stringify(produced).includes("sk-proj-fake-test-key"), false);

    const handoff = await fetchJson(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "get_image2_handoff",
          arguments: { projectId: "demo-reference", episodeId: "episode-001" }
        }
      })
    });

    assert.equal(handoff.result.structuredContent.model, "gpt-image-2");
    assert.equal(handoff.result.structuredContent.uses_api_key, false);
    assert.equal(handoff.result.structuredContent.status, "ready");
    assert.ok(handoff.result.structuredContent.prompt_count > 0);
    assert.equal(JSON.stringify(handoff).includes("sk-proj-fake-test-key"), false);

    const attachedAssets = await fetchJson(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "attach_image2_assets",
          arguments: {
            projectId: "demo-reference",
            episodeId: "episode-001",
            assets: [
              {
                shotId: 1,
                fileName: "chatgpt-image2-shot-001.png",
                mimeType: "image/png",
                data: Buffer.from("fake chatgpt image2 asset").toString("base64")
              }
            ]
          }
        }
      })
    });

    assert.equal(attachedAssets.result.structuredContent.model, "gpt-image-2");
    assert.equal(attachedAssets.result.structuredContent.uses_api_key, false);
    assert.equal(attachedAssets.result.structuredContent.asset_count, 1);
    assert.equal(attachedAssets.result.structuredContent.manifest_path, "outputs/demo-reference/episode-001/image2-assets/manifest.json");
    assert.equal(attachedAssets.result.structuredContent.assets[0].artifact_path, "/api/artifact/demo-reference/episode-001/image2-assets/shot-001.png");
    assert.equal(JSON.stringify(attachedAssets).includes("sk-proj-fake-test-key"), false);

    const assetManifest = JSON.parse(await readFile(path.join(rootDir, "outputs/demo-reference/episode-001/image2-assets/manifest.json"), "utf8"));
    assert.equal(assetManifest.model, "gpt-image-2");
    assert.equal(assetManifest.uses_api_key, false);
    assert.equal(assetManifest.asset_count, 1);

    const updatedBundleManifest = JSON.parse(await readFile(path.join(rootDir, "outputs/demo-reference/episode-001/publish-bundle/manifest.json"), "utf8"));
    assert.equal(updatedBundleManifest.image2_assets.asset_count, 1);
    assert.equal(updatedBundleManifest.image2_assets.uses_api_key, false);

    const servedAsset = await fetch(`${baseUrl}/api/artifact/demo-reference/episode-001/image2-assets/shot-001.png`);
    assert.equal(servedAsset.ok, true);
    assert.equal(servedAsset.headers.get("content-type"), "image/png");
    assert.equal(await servedAsset.text(), "fake chatgpt image2 asset");

    const readinessAfterAssets = await fetchJson(`${baseUrl}/api/readiness`);
    assert.equal(readinessAfterAssets.summary.image2_asset_count, 1);
    assert.equal(readinessAfterAssets.checks.find((check) => check.id === "image2_assets").status, "pass");

    const packageBytes = await readFile(path.join(rootDir, produced.result.structuredContent.production_package_path));
    assert.ok(packageBytes.byteLength > 1000);
  } finally {
    restoreEnv();
    await close(server);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("MCP production account-auth accepts RS256 OAuth/OIDC JWTs through configured JWKS", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ai-short-video-mcp-prod-oauth-"));
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  Object.assign(jwk, { kid: "prod-test-key", alg: "RS256", use: "sig" });
  const jwksServer = http.createServer((request, response) => {
    if (request.url === "/jwks.json") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(`${JSON.stringify({ keys: [jwk] })}\n`);
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    response.end("{}\n");
  });
  await listen(jwksServer);
  const server = createApiServer({ rootDir });
  await listen(server);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const issuer = "https://auth.example.test/chatgpt";
  const restoreEnv = setOAuthEnv({
    CHATGPT_OAUTH_ISSUER: issuer,
    CHATGPT_OAUTH_JWKS_URI: `http://127.0.0.1:${jwksServer.address().port}/jwks.json`,
    CHATGPT_OAUTH_AUTHORIZE_URL: `${issuer}/authorize`,
    CHATGPT_OAUTH_TOKEN_URL: `${issuer}/token`,
    CHATGPT_OAUTH_REGISTER_URL: `${issuer}/register`
  });

  try {
    const metadata = await fetchJson(`${baseUrl}/.well-known/oauth-protected-resource`);
    assert.deepEqual(metadata.authorization_servers, [issuer]);
    assert.equal(metadata.oauth_mode, "production");
    assert.equal(metadata.production_oauth_configured, true);

    const toolsList = await fetchJson(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 50, method: "tools/list", params: {} })
    });
    assert.equal(toolsList.result.tools.find((tool) => tool.name === "produce_short_video").securitySchemes[0].authorizationUrl, `${issuer}/authorize`);

    const accessToken = signRs256Jwt({
      privateKey,
      kid: "prod-test-key",
      payload: {
        iss: issuer,
        aud: `${baseUrl}/mcp`,
        resource: `${baseUrl}/mcp`,
        sub: "prod-chatgpt-user",
        client_id: "chatgpt-prod-client",
        scope: "shortvideo:write image2:handoff",
        iat: Math.floor(Date.now() / 1000),
        nbf: Math.floor(Date.now() / 1000) - 5,
        exp: Math.floor(Date.now() / 1000) + 300
      }
    });

    const produced = await fetchJson(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 51,
        method: "tools/call",
        params: {
          name: "produce_short_video",
          arguments: {
            topic: "AI robot bakery courtroom drama",
            count: 2,
            renderCount: 1,
            renderDuration: 3
          }
        }
      })
    });

    assert.equal(produced.result.structuredContent.provider_mode, "chatgpt-account");
    assert.equal(produced.result.structuredContent.rendered_count, 1);
    assert.equal(JSON.stringify(produced).includes("PRIVATE KEY"), false);
  } finally {
    restoreEnv();
    await close(server);
    await close(jwksServer);
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

const OAUTH_ENV_KEYS = [
  "CHATGPT_OAUTH_ISSUER",
  "CHATGPT_OAUTH_JWKS_URI",
  "CHATGPT_OAUTH_AUTHORIZE_URL",
  "CHATGPT_OAUTH_TOKEN_URL",
  "CHATGPT_OAUTH_REGISTER_URL",
  "CHATGPT_OAUTH_METADATA_URL",
  "CHATGPT_OAUTH_AUDIENCE",
  "CHATGPT_OAUTH_DEV_SECRET"
];

function setOAuthEnv(values) {
  const previous = Object.fromEntries(OAUTH_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of OAUTH_ENV_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
  return () => {
    for (const key of OAUTH_ENV_KEYS) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  };
}

function signRs256Jwt({ privateKey, kid, payload }) {
  const header = { alg: "RS256", typ: "JWT", kid };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signedInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signedInput), privateKey).toString("base64url");
  return `${signedInput}.${signature}`;
}

async function issueOAuthToken({ baseUrl, scope }) {
  const codeVerifier = `test-verifier-${crypto.randomBytes(24).toString("base64url")}`;
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const redirectUri = "http://127.0.0.1/callback";
  const clientId = "local-test-client";
  const authorizeUrl = new URL(`${baseUrl}/oauth-placeholder/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", scope);
  authorizeUrl.searchParams.set("resource", `${baseUrl}/mcp`);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", "state-123");

  const authorization = await fetch(authorizeUrl, { redirect: "manual" });
  assert.equal(authorization.status, 302);
  const location = authorization.headers.get("location");
  assert.ok(location);
  const callback = new URL(location);
  assert.equal(callback.searchParams.get("state"), "state-123");
  const code = callback.searchParams.get("code");
  assert.ok(code);

  const token = await fetchJson(`${baseUrl}/oauth-placeholder/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      client_id: clientId,
      resource: `${baseUrl}/mcp`
    }).toString()
  });
  assert.equal(token.token_type, "Bearer");
  assert.equal(token.scope, scope);
  assert.ok(token.access_token);
  return token.access_token;
}
