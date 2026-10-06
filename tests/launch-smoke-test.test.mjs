import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApiServer } from "../lib/backend-api.mjs";
import { resolveLaunchSmokeTest } from "../lib/launch-smoke-test.mjs";

test("launch smoke test verifies managed OAuth metadata and RS256 JWKS", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ai-short-video-launch-smoke-"));
  const issuer = "https://auth.example.test/issuer";
  const jwksUri = "https://auth.example.test/.well-known/jwks.json";
  await writeFile(path.join(rootDir, ".env.local"), [
    `CHATGPT_OAUTH_ISSUER=${issuer}`,
    `CHATGPT_OAUTH_JWKS_URI=${jwksUri}`,
    `CHATGPT_OAUTH_AUTHORIZE_URL=${issuer}/authorize`,
    `CHATGPT_OAUTH_TOKEN_URL=${issuer}/token`,
    `CHATGPT_OAUTH_REGISTER_URL=${issuer}/register`,
    `CHATGPT_OAUTH_METADATA_URL=${issuer}/.well-known/oauth-authorization-server`,
    ""
  ].join("\n"), "utf8");

  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    const href = String(url);
    if (href === `${issuer}/.well-known/oauth-authorization-server`) {
      return jsonResponse({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        registration_endpoint: `${issuer}/register`,
        jwks_uri: jwksUri,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        scopes_supported: ["shortvideo:write", "image2:handoff", "readiness:read"]
      });
    }
    if (href === jwksUri) {
      return jsonResponse({
        keys: [{
          kty: "RSA",
          kid: "prod-smoke-key",
          use: "sig",
          alg: "RS256",
          n: "w7ZdfakeModulusForLaunchSmokeValidationOnly",
          e: "AQAB"
        }]
      });
    }
    return originalFetch(url, options);
  };

  const server = createApiServer({ rootDir });
  await listen(server);

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const smoke = await resolveLaunchSmokeTest({ rootDir, baseUrl });
    const oauthTarget = smoke.targets.find((target) => target.id === "oauth-provider");

    assert.equal(smoke.local_contract_ready, true);
    assert.equal(smoke.oauth_provider_ready, true);
    assert.equal(smoke.public_contract_ready, false);
    assert.equal(smoke.smoke_ready, false);
    assert.equal(oauthTarget.status, "pass");
    assert.ok(oauthTarget.checks.every((check) => check.status === "pass"));
    assert.ok(smoke.blockers.some((blocker) => blocker.includes("PUBLIC_MCP_ORIGIN")));
    assert.equal(smoke.blockers.some((blocker) => blocker.includes("JWKS")), false);
  } finally {
    global.fetch = originalFetch;
    await close(server);
    await rm(rootDir, { recursive: true, force: true });
  }
});

function jsonResponse(body) {
  return new Response(`${JSON.stringify(body)}\n`, {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

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
