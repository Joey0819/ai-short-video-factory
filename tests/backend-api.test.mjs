import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createApiServer } from "../lib/backend-api.mjs";

test("backend API reports health, providers, and generated project state", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ai-short-video-factory-"));
  const restoreEnv = snapshotEnv(LAUNCH_ENV_KEYS);
  const server = createApiServer({ rootDir });
  await listen(server);

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const health = await fetchJson(`${baseUrl}/api/health`);
    assert.equal(health.ok, true);
    assert.equal(health.project_id, "demo-reference");

    await writeFile(path.join(rootDir, ".env.local"), "OPENAI_API_KEY=sk-proj-fake-test-key\nCHATGPT_ACCOUNT_VERIFIED=true\n", "utf8");
    const providers = await fetchJson(`${baseUrl}/api/providers`);
    assert.equal(providers.provider_status.api_key.configured, true);
    assert.equal(providers.provider_status.account_auth.configured, true);
    assert.equal(JSON.stringify(providers).includes("sk-proj-fake-test-key"), false);

    const launchSmoke = await fetchJson(`${baseUrl}/api/launch-smoke-test`);
    assert.equal(launchSmoke.ok, true);
    assert.equal(launchSmoke.local_contract_ready, true);
    assert.equal(launchSmoke.recommended_provider, "chatgpt-account");
    assert.equal(launchSmoke.auth_method, "ChatGPT Apps OAuth 2.1 / MCP");
    assert.equal(launchSmoke.image_model, "gpt-image-2");
    assert.equal(launchSmoke.uses_image_api_key, false);
    const localSmokeTarget = launchSmoke.targets.find((target) => target.id === "local-contract");
    assert.equal(localSmokeTarget.status, "pass");
    assert.equal(localSmokeTarget.ready, true);
    assert.ok(localSmokeTarget.checks.every((check) => check.status === "pass"));
    assert.equal(JSON.stringify(launchSmoke).includes("sk-proj-fake-test-key"), false);

    const initialLaunchConfig = await fetchJson(`${baseUrl}/api/launch-config`);
    assert.equal(initialLaunchConfig.ok, true);
    assert.equal(initialLaunchConfig.launch_config.status.public_mcp_origin_configured, false);

    const invalidLaunchConfig = await fetch(`${baseUrl}/api/launch-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        public_mcp_origin: "http://127.0.0.1:3030",
        chatgpt_app_registered: true
      })
    });
    assert.equal(invalidLaunchConfig.status, 400);
    const invalidLaunchBody = await invalidLaunchConfig.json();
    assert.equal(invalidLaunchBody.error, "invalid_launch_config");

    const launchConfig = await fetchJson(`${baseUrl}/api/launch-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        public_mcp_origin: "https://mcp.example.com",
        oauth_issuer: "https://auth.example.com",
        oauth_jwks_uri: "https://auth.example.com/.well-known/jwks.json",
        oauth_authorize_url: "https://auth.example.com/authorize",
        oauth_token_url: "https://auth.example.com/token",
        oauth_register_url: "https://auth.example.com/register",
        oauth_metadata_url: "https://auth.example.com/.well-known/oauth-authorization-server",
        oauth_audience: "https://mcp.example.com/mcp",
        chatgpt_app_registered: true
      })
    });
    assert.equal(launchConfig.ok, true);
    assert.equal(launchConfig.launch_config.status.public_mcp_origin_configured, true);
    assert.equal(launchConfig.launch_config.status.production_oauth_configured, true);
    assert.equal(launchConfig.launch_config.status.chatgpt_app_registered, true);
    assert.equal(launchConfig.readiness.summary.public_mcp_origin_configured, true);
    assert.equal(launchConfig.readiness.summary.production_oauth_configured, true);
    assert.equal(launchConfig.launch_preflight.required_env.find((entry) => entry.name === "CHATGPT_APP_REGISTERED").configured, true);
    assert.equal(JSON.stringify(launchConfig).includes("sk-proj-fake-test-key"), false);
    const envAfterLaunchConfig = await readFile(path.join(rootDir, ".env.local"), "utf8");
    assert.match(envAfterLaunchConfig, /PUBLIC_MCP_ORIGIN=https:\/\/mcp\.example\.com/);
    assert.match(envAfterLaunchConfig, /CHATGPT_OAUTH_JWKS_URI=https:\/\/auth\.example\.com\/\.well-known\/jwks\.json/);
    const launchManifestAfterSave = await fetchJson(`${baseUrl}/api/chatgpt/app-manifest`);
    assert.equal(launchManifestAfterSave.app.mcp_endpoint, "https://mcp.example.com/mcp");
    assert.equal(launchManifestAfterSave.app.oauth_protected_resource, "https://mcp.example.com/.well-known/oauth-protected-resource");

    const dryRun = await fetchJson(`${baseUrl}/api/openai/dry-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "robot bakery drama", count: 2 })
    });
    assert.equal(dryRun.live_request_sent, false);
    assert.equal(dryRun.openai_key_configured, true);

    const accountDryRun = await fetchJson(`${baseUrl}/api/chatgpt/account-dry-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "robot bakery drama", count: 2 })
    });
    assert.equal(accountDryRun.live_request_sent, false);
    assert.equal(accountDryRun.uses_api_key, false);
    assert.equal(accountDryRun.account_verified, true);
    assert.equal(accountDryRun.models.image, "gpt-image-2");
    assert.equal(JSON.stringify(accountDryRun).includes("sk-proj-fake-test-key"), false);

    const clearedAccount = await fetchJson(`${baseUrl}/api/chatgpt/account-verification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verified: false })
    });
    assert.equal(clearedAccount.account_verified, false);
    assert.equal(clearedAccount.provider_status.account_auth.configured, false);

    const savedAccount = await fetchJson(`${baseUrl}/api/chatgpt/account-verification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verified: true })
    });
    assert.equal(savedAccount.account_verified, true);
    assert.equal(savedAccount.project.provider_status.account_auth.configured, true);
    assert.equal(JSON.stringify(savedAccount).includes("sk-proj-fake-test-key"), false);

    const referenceUpload = await fetchJson(`${baseUrl}/api/reference`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: "operator-reference.png",
        mimeType: "image/png",
        sizeBytes: Buffer.byteLength("fake image reference"),
        data: Buffer.from("fake image reference").toString("base64")
      })
    });
    assert.equal(referenceUpload.ok, true);
    assert.equal(referenceUpload.source_asset.kind, "image");
    assert.equal(referenceUpload.project.source_asset.file_name, "operator-reference.png");
    assert.equal(JSON.stringify(referenceUpload).includes("sk-proj-fake-test-key"), false);

    const referenceArtifact = await fetch(`${baseUrl}${referenceUpload.source_asset.artifact_path}`);
    assert.equal(referenceArtifact.ok, true);
    assert.equal(referenceArtifact.headers.get("content-type"), "image/png");
    assert.equal(await referenceArtifact.text(), "fake image reference");

    const generated = await fetchJson(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "robot bakery drama", count: 2 })
    });
    assert.equal(generated.project.episodes.length, 2);
    assert.equal(generated.project.provider_mode, "live");
    assert.equal(generated.project.source_asset.file_name, "operator-reference.png");

    const accountGenerated = await fetchJson(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "robot bakery drama", count: 2, providerMode: "chatgpt" })
    });
    assert.equal(accountGenerated.project.episodes.length, 2);
    assert.equal(accountGenerated.project.provider_mode, "chatgpt-account");
    assert.equal(accountGenerated.project.provider_status.account_auth.configured, true);

    const state = JSON.parse(await readFile(path.join(rootDir, "public", "factory-state.json"), "utf8"));
    assert.equal(state.recipe.source_summary, "robot bakery drama");

    const reviewed = await fetchJson(`${baseUrl}/api/episode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ episodeId: "episode-002", reviewGate: "returned" })
    });
    assert.equal(reviewed.project.episodes.find((episode) => episode.id === "episode-002").review_gate, "returned");

    const reviewedState = JSON.parse(await readFile(path.join(rootDir, "storage", "projects", "demo-reference", "project.json"), "utf8"));
    assert.equal(reviewedState.episodes.find((episode) => episode.id === "episode-002").review_gate, "returned");

    const savedProject = await fetchJson(`${baseUrl}/api/project/save`, {
      method: "POST"
    });
    assert.equal(savedProject.ok, true);
    assert.equal(savedProject.files.project_state, "storage/projects/demo-reference/project.json");
    assert.equal(savedProject.files.save_receipt, "storage/projects/demo-reference/save-receipt.json");
    assert.equal(JSON.stringify(savedProject).includes("sk-proj-fake-test-key"), false);
    const saveReceipt = JSON.parse(await readFile(path.join(rootDir, savedProject.files.save_receipt), "utf8"));
    assert.equal(saveReceipt.project_id, "demo-reference");
    assert.equal(saveReceipt.episode_count, 2);

    const duplicatedProject = await fetchJson(`${baseUrl}/api/project/duplicate`, {
      method: "POST"
    });
    assert.equal(duplicatedProject.ok, true);
    assert.match(duplicatedProject.duplicate.id, /^copy-[0-9]{14}$/);
    assert.match(duplicatedProject.duplicate.project_snapshot, /^storage\/projects\/demo-reference\/duplicates\/copy-[0-9]{14}\/project\.json$/);
    assert.equal(JSON.stringify(duplicatedProject).includes("sk-proj-fake-test-key"), false);
    const duplicateManifest = JSON.parse(await readFile(path.join(rootDir, duplicatedProject.duplicate.manifest_path), "utf8"));
    assert.equal(duplicateManifest.project_id, "demo-reference");
    assert.equal(duplicateManifest.episode_count, 2);

    const rules = await fetchJson(`${baseUrl}/api/project/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalityRules: ["Rule one", "Rule two", "Rule one"]
      })
    });
    assert.equal(rules.ok, true);
    assert.equal(rules.project.recipe.originality_rules.length, 2);
    assert.equal(rules.project.recipe.originality_rules[0], "Rule one");
    assert.equal(rules.project.recipe.originality_rules[1], "Rule two");

    const invalidRulesResponse = await fetch(`${baseUrl}/api/project/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(invalidRulesResponse.status, 400);
    const invalidRulesBody = await invalidRulesResponse.json();
    assert.equal(invalidRulesBody.ok, false);

    const bundle = await fetchJson(`${baseUrl}/api/bundle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ episodeId: "episode-001" })
    });
    assert.equal(bundle.ok, true);
    assert.equal(bundle.manifest.episode_id, "episode-001");
    assert.equal(JSON.stringify(bundle).includes("sk-proj-fake-test-key"), false);
  } finally {
    await close(server);
    restoreEnv();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("OpenAI live check endpoint reports missing key without a live request", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ai-short-video-live-check-missing-"));
  const server = createApiServer({ rootDir });
  await listen(server);

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const liveCheck = await fetchJson(`${baseUrl}/api/openai/live-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "robot bakery drama", count: 1 })
    });

    assert.equal(liveCheck.ok, true);
    assert.equal(liveCheck.live_request_sent, false);
    assert.equal(liveCheck.live_access, false);
    assert.equal(liveCheck.error_class, "missing_key");
    assert.equal(JSON.stringify(liveCheck).includes("sk-proj"), false);
  } finally {
    await close(server);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("OpenAI live check endpoint classifies quota failure without leaking the key", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ai-short-video-live-check-quota-"));
  const server = createApiServer({ rootDir });
  await listen(server);
  const originalFetch = global.fetch;
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  global.fetch = async (url, options) => {
    if (String(url) === "https://api.openai.com/v1/responses") {
      assert.equal(options.headers.Authorization, "Bearer sk-proj-fake-test-key");
      assert.equal(JSON.stringify(options.body).includes("sk-proj-fake-test-key"), false);
      return new Response(JSON.stringify({
        error: {
          code: "insufficient_quota",
          type: "insufficient_quota",
          message: "Quota failed for key sk-proj-fake-test-key."
        }
      }), {
        status: 429,
        headers: { "Content-Type": "application/json" }
      });
    }
    return originalFetch(url, options);
  };

  try {
    await writeFile(path.join(rootDir, ".env.local"), "OPENAI_API_KEY=sk-proj-fake-test-key\n", "utf8");
    const liveCheck = await fetchJson(`${baseUrl}/api/openai/live-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "robot bakery drama", count: 1 })
    });

    assert.equal(liveCheck.ok, true);
    assert.equal(liveCheck.live_request_sent, true);
    assert.equal(liveCheck.live_access, false);
    assert.equal(liveCheck.error_class, "quota");
    assert.match(liveCheck.message, /insufficient_quota/);
    assert.equal(JSON.stringify(liveCheck).includes("sk-proj-fake-test-key"), false);
  } finally {
    global.fetch = originalFetch;
    await close(server);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("Ollama live check endpoint reports local model readiness", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ai-short-video-ollama-live-check-"));
  const server = createApiServer({ rootDir });
  await listen(server);
  const originalFetch = global.fetch;
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  global.fetch = async (url, options) => {
    if (String(url) === "http://127.0.0.1:11434/api/tags") {
      assert.equal(options, undefined);
      return new Response(JSON.stringify({
        models: [{ name: "qwen3.6:latest" }]
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return originalFetch(url, options);
  };

  try {
    const liveCheck = await fetchJson(`${baseUrl}/api/ollama/live-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "robot bakery drama", count: 1 })
    });

    assert.equal(liveCheck.ok, true);
    assert.equal(liveCheck.live_access, true);
    assert.equal(liveCheck.model, "qwen3.6:latest");
    assert.equal(JSON.stringify(liveCheck).includes("sk-proj"), false);
  } finally {
    global.fetch = originalFetch;
    await close(server);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("Ollama-mode production creates LLM content and rendered MP4 artifacts", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ai-short-video-ollama-produce-"));
  const server = createApiServer({ rootDir });
  await listen(server);
  const originalFetch = global.fetch;
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  global.fetch = async (url, options) => {
    if (String(url) === "http://127.0.0.1:11434/api/generate") {
      const body = JSON.parse(options.body);
      assert.equal(body.model, "qwen3.6:latest");
      assert.equal(JSON.stringify(body).includes("AI neon ramen detective"), true);
      return new Response(JSON.stringify({ response: JSON.stringify(sampleOpenAiDraft) }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return originalFetch(url, options);
  };

  try {
    const produced = await fetchJson(`${baseUrl}/api/produce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "AI neon ramen detective",
        count: 1,
        providerMode: "ollama",
        sourceType: "text idea",
        renderDuration: 3
      })
    });

    assert.equal(produced.ok, true);
    assert.equal(produced.project.provider_mode, "local-llm");
    assert.equal(produced.project.provider_status.local_llm.configured, true);
    assert.equal(produced.project.episodes[0].title, "The Ramen Sign Blinked Twice");
    assert.equal(produced.project.episodes[0].status, "rendered");
    assert.equal(produced.artifacts.length, 1);
    const video = await readFile(path.join(rootDir, produced.artifacts[0].output_path));
    assert.ok(video.byteLength > 1000);
  } finally {
    global.fetch = originalFetch;
    await close(server);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("backend production request falls back to local pipeline when OpenAI responses fails", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ai-short-video-produce-fallback-"));
  const server = createApiServer({ rootDir });
  await listen(server);
  const originalFetch = global.fetch;
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  global.fetch = async (url, options) => {
    if (String(url).includes("api.openai.com")) {
      return new Response(JSON.stringify({ error: { message: "simulated outage" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      });
    }
    return originalFetch(url, options);
  };

  try {
    await writeFile(path.join(rootDir, ".env.local"), "OPENAI_API_KEY=sk-invalid-fallback-key\n", "utf8");

    const fallbackResponse = await fetchJson(`${baseUrl}/api/produce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "AI cartoon fruit drama",
        count: 1,
        providerMode: "openai",
        sourceType: "text idea"
      })
    });

    assert.equal(fallbackResponse.ok, true);
    assert.equal(fallbackResponse.project.provider_mode, "local");
    assert.equal(Array.isArray(fallbackResponse.warnings), true);
    assert.equal(fallbackResponse.warnings.length > 0, true);
    assert.equal(fallbackResponse.project.episodes.length, 1);
    assert.equal(fallbackResponse.artifacts.length, 1);
    assert.ok(fallbackResponse.production_package_path.includes("production-package.tar.gz"));
    const fallbackManifest = JSON.parse(await readFile(path.join(rootDir, fallbackResponse.production_manifest_path), "utf8"));
    assert.ok(fallbackManifest.warnings.some((warning) => warning.includes("OpenAI content generation failed")));
    const fallbackReadiness = await fetchJson(`${baseUrl}/api/readiness`);
    assert.ok(fallbackReadiness.summary.provider_warnings.some((warning) => warning.includes("OpenAI content generation failed")));
    assert.equal(fallbackReadiness.checks.find((check) => check.id === "provider_diagnostics").status, "warn");
  } finally {
    global.fetch = originalFetch;
    await close(server);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("chatgpt-mode production uses OpenAI director fallback when account auth is not verified", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ai-short-video-chatgpt-openai-fallback-"));
  const server = createApiServer({ rootDir });
  await listen(server);
  const originalFetch = global.fetch;
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  global.fetch = async (url, options) => {
    if (String(url) === "https://api.openai.com/v1/responses") {
      assert.equal(options.headers.Authorization, "Bearer sk-proj-fake-test-key");
      assert.equal(JSON.stringify(options.body).includes("sk-proj-fake-test-key"), false);
      return new Response(JSON.stringify({ output_text: JSON.stringify(sampleOpenAiDraft) }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return originalFetch(url, options);
  };

  try {
    await writeFile(path.join(rootDir, ".env.local"), "OPENAI_API_KEY=sk-proj-fake-test-key\n", "utf8");

    const produced = await fetchJson(`${baseUrl}/api/produce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "AI neon ramen detective",
        count: 1,
        providerMode: "chatgpt",
        sourceType: "text idea",
        renderDuration: 3
      })
    });

    assert.equal(produced.ok, true);
    assert.equal(produced.project.provider_mode, "live");
    assert.equal(produced.project.recipe.source_summary, "AI neon ramen detective");
    assert.equal(produced.project.episodes[0].title, "The Ramen Sign Blinked Twice");
    assert.equal(produced.project.episodes[0].status, "rendered");
    assert.equal(produced.artifacts.length, 1);
    assert.ok(produced.warnings.some((warning) => warning.includes("Using OpenAI API director fallback")));
    const video = await readFile(path.join(rootDir, produced.artifacts[0].output_path));
    assert.ok(video.byteLength > 1000);
    assert.equal(JSON.stringify(produced).includes("sk-proj-fake-test-key"), false);
  } finally {
    global.fetch = originalFetch;
    await close(server);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("web production can force OpenAI director while preserving ChatGPT account readiness", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ai-short-video-force-openai-director-"));
  const server = createApiServer({ rootDir });
  await listen(server);
  const originalFetch = global.fetch;
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  global.fetch = async (url, options) => {
    if (String(url) === "https://api.openai.com/v1/responses") {
      assert.equal(options.headers.Authorization, "Bearer sk-proj-fake-test-key");
      assert.equal(JSON.stringify(options.body).includes("AI neon ramen detective"), true);
      assert.equal(JSON.stringify(options.body).includes("sk-proj-fake-test-key"), false);
      return new Response(JSON.stringify({ output_text: JSON.stringify(sampleOpenAiDraft) }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return originalFetch(url, options);
  };

  try {
    await writeFile(path.join(rootDir, ".env.local"), "OPENAI_API_KEY=sk-proj-fake-test-key\nCHATGPT_ACCOUNT_VERIFIED=true\n", "utf8");

    const produced = await fetchJson(`${baseUrl}/api/produce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "AI neon ramen detective",
        count: 1,
        providerMode: "chatgpt",
        forceLiveDirector: true,
        sourceType: "text idea",
        renderDuration: 3
      })
    });

    assert.equal(produced.ok, true);
    assert.equal(produced.project.provider_mode, "live");
    assert.equal(produced.project.provider_status.api_key.configured, true);
    assert.equal(produced.project.provider_status.account_auth.configured, true);
    assert.equal(produced.project.episodes[0].title, "The Ramen Sign Blinked Twice");
    assert.equal(produced.project.episodes[0].status, "rendered");
    assert.equal(produced.artifacts.length, 1);
    assert.ok(produced.warnings.some((warning) => warning.includes("Using OpenAI API director for web prompt content")));
    assert.equal(JSON.stringify(produced).includes("sk-proj-fake-test-key"), false);
  } finally {
    global.fetch = originalFetch;
    await close(server);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("backend production job creates content, MP4, bundle, and served artifact", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ai-short-video-produce-"));
  const server = createApiServer({ rootDir });
  await listen(server);

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const uploadedReference = await fetchJson(`${baseUrl}/api/reference`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: "source-video.mp4",
        mimeType: "video/mp4",
        sizeBytes: Buffer.byteLength("fake video reference"),
        data: Buffer.from("fake video reference").toString("base64")
      })
    });
    assert.equal(uploadedReference.source_asset.kind, "video");

    const produced = await fetchJson(`${baseUrl}/api/produce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "AI robot bakery courtroom drama",
        count: 2,
        renderDuration: 3
      })
    });

    assert.equal(produced.ok, true);
    assert.equal(produced.project.episodes.length, 2);
    assert.equal(produced.project.source_asset.file_name, "source-video.mp4");
    assert.equal(produced.project.episodes[0].status, "rendered");
    assert.equal(produced.project.episodes[0].review_gate, "approved");
    assert.equal(produced.project.episodes[1].status, "rendered");
    assert.equal(produced.project.episodes[1].review_gate, "approved");
    assert.match(produced.project.episodes[0].title, /Robot Bakery Courtroom/);
    assert.equal(produced.artifacts.length, 2);
    assert.equal(produced.artifacts[0].episode_id, "episode-001");
    assert.equal(produced.artifacts[1].episode_id, "episode-002");
    assert.equal(produced.production_manifest_path, "outputs/demo-reference/production-manifest.json");
    assert.equal(produced.production_package_path, "outputs/demo-reference/production-package.tar.gz");

    const video = await readFile(path.join(rootDir, produced.artifacts[0].output_path));
    assert.ok(video.byteLength > 1000);
    const secondVideo = await readFile(path.join(rootDir, produced.artifacts[1].output_path));
    assert.ok(secondVideo.byteLength > 1000);

    const productionManifest = JSON.parse(await readFile(path.join(rootDir, produced.production_manifest_path), "utf8"));
    assert.equal(productionManifest.rendered_count, 2);
    assert.equal(productionManifest.source_asset.file_name, "source-video.mp4");
    assert.equal(productionManifest.publish_ready_count, 2);
    assert.equal(productionManifest.artifacts[0].output_path, "outputs/demo-reference/episode-001/final.mp4");
    assert.equal(productionManifest.artifacts[0].image2_handoff_path, "outputs/demo-reference/episode-001/publish-bundle/image2-handoff.json");
    assert.equal(productionManifest.artifacts[1].output_path, "outputs/demo-reference/episode-002/final.mp4");
    assert.equal(productionManifest.artifacts[1].image2_handoff_path, "outputs/demo-reference/episode-002/publish-bundle/image2-handoff.json");
    assert.equal(productionManifest.files.production_package, "outputs/demo-reference/production-package.tar.gz");

    const packageBytes = await readFile(path.join(rootDir, produced.production_package_path));
    assert.ok(packageBytes.byteLength > 1000);
    const packageEntries = await listTarEntries(path.join(rootDir, produced.production_package_path));
    assert.ok(packageEntries.includes("production-manifest.json"));
    assert.ok(packageEntries.includes("episode-001/final.mp4"));
    assert.ok(packageEntries.includes("episode-002/final.mp4"));

    const manifest = JSON.parse(await readFile(path.join(rootDir, produced.artifacts[0].manifest_path), "utf8"));
    assert.equal(manifest.publish_ready, true);
    assert.equal(manifest.source_asset.file_name, "source-video.mp4");
    assert.equal(manifest.video_output, "outputs/demo-reference/episode-001/final.mp4");
    assert.equal(manifest.files.image2Handoff, "outputs/demo-reference/episode-001/publish-bundle/image2-handoff.json");
    const image2Handoff = JSON.parse(await readFile(path.join(rootDir, manifest.files.image2Handoff), "utf8"));
    assert.equal(image2Handoff.model, "gpt-image-2");
    assert.equal(image2Handoff.uses_api_key, false);

    const artifactResponse = await fetch(`${baseUrl}/api/artifact/demo-reference/episode-001/final.mp4`);
    assert.equal(artifactResponse.ok, true);
    assert.equal(artifactResponse.headers.get("content-type"), "video/mp4");
    assert.ok((await artifactResponse.arrayBuffer()).byteLength > 1000);

    const artifactHead = await fetch(`${baseUrl}/api/artifact/demo-reference/episode-001/final.mp4`, {
      method: "HEAD"
    });
    assert.equal(artifactHead.ok, true);
    assert.equal(artifactHead.headers.get("content-type"), "video/mp4");

    const productionManifestResponse = await fetch(`${baseUrl}/api/artifact/demo-reference/production-manifest.json`);
    assert.equal(productionManifestResponse.ok, true);
    assert.equal(productionManifestResponse.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal((await productionManifestResponse.json()).rendered_count, 2);

    const bundleManifestResponse = await fetch(`${baseUrl}/api/artifact/demo-reference/episode-001/publish-bundle/manifest.json`);
    assert.equal(bundleManifestResponse.ok, true);
    assert.equal(bundleManifestResponse.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal((await bundleManifestResponse.json()).publish_ready, true);

    const image2HandoffResponse = await fetch(`${baseUrl}/api/artifact/demo-reference/episode-001/publish-bundle/image2-handoff.json`);
    assert.equal(image2HandoffResponse.ok, true);
    assert.equal(image2HandoffResponse.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal((await image2HandoffResponse.json()).model, "gpt-image-2");

    const image2Fixture = await readFile(path.join(process.cwd(), "public/assets/fruit-drama-preview.png"));
    const attachedImage2Assets = await fetchJson(`${baseUrl}/api/image2-assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        episodeId: "episode-001",
        render: true,
        duration: 3,
        assets: [{
          shotId: 1,
          fileName: "chatgpt-image2-shot-001.png",
          mimeType: "image/png",
          data: image2Fixture.toString("base64")
        }]
      })
    });
    assert.equal(attachedImage2Assets.ok, true);
    assert.equal(attachedImage2Assets.asset_manifest.asset_count, 1);
    assert.equal(attachedImage2Assets.asset_manifest.uses_api_key, false);
    assert.equal(attachedImage2Assets.render.image2_asset_count, 1);
    assert.equal(attachedImage2Assets.artifact.image2_asset_count, 1);
    assert.equal(attachedImage2Assets.artifact.image2_assets_used, 1);
    assert.equal(attachedImage2Assets.production_package_path, "outputs/demo-reference/production-package.tar.gz");
    const refreshedPackageEntries = await listTarEntries(path.join(rootDir, attachedImage2Assets.production_package_path));
    assert.ok(refreshedPackageEntries.includes("episode-001/image2-assets/manifest.json"));
    assert.ok(refreshedPackageEntries.includes("episode-001/image2-assets/shot-001.png"));

    const packageResponse = await fetch(`${baseUrl}/api/artifact/demo-reference/production-package.tar.gz`);
    assert.equal(packageResponse.ok, true);
    assert.equal(packageResponse.headers.get("content-type"), "application/gzip");
    assert.ok((await packageResponse.arrayBuffer()).byteLength > 1000);

    const readiness = await fetchJson(`${baseUrl}/api/readiness`);
    assert.equal(readiness.ok, true);
    assert.equal(readiness.ready, true);
    assert.equal(readiness.commercial_ready, false);
    assert.equal(readiness.openai_live_ready, false);
    assert.equal(readiness.chatgpt_account_ready, false);
    assert.equal(readiness.summary.content_count, 2);
    assert.equal(readiness.summary.rendered_count, 2);
    assert.equal(readiness.summary.publish_bundle_count, 2);
    assert.equal(readiness.summary.image2_handoff_count, 2);
    assert.equal(readiness.summary.image2_asset_count, 1);
    assert.equal(readiness.summary.reference_asset_configured, true);
    assert.ok(readiness.summary.production_package_bytes > 1000);
    const checks = Object.fromEntries(readiness.checks.map((check) => [check.id, check]));
    assert.equal(checks.reference_asset.status, "pass");
    assert.equal(checks.rendered_video.status, "pass");
    assert.equal(checks.publish_bundle.status, "pass");
    assert.equal(checks.image2_handoff.status, "pass");
    assert.equal(checks.image2_assets.status, "pass");
    assert.equal(checks.production_manifest.status, "pass");
    assert.equal(checks.production_package.status, "pass");
    assert.equal(checks.commercial_public_origin.status, "warn");
    assert.equal(checks.commercial_public_origin.commercial, true);
    assert.equal(checks.chatgpt_app_registration.status, "warn");
    assert.ok(readiness.summary.launch_blockers.some((blocker) => blocker.includes("PUBLIC_MCP_ORIGIN")));
    assert.ok(readiness.summary.launch_blockers.some((blocker) => blocker.includes("CHATGPT_APP_REGISTERED")));
    assert.equal(checks.openai_live.required, false);
    assert.equal(checks.chatgpt_account.required, false);
    assert.equal(JSON.stringify(readiness).includes("sk-proj"), false);

    const preflight = await fetchJson(`${baseUrl}/api/launch-preflight`);
    assert.equal(preflight.ok, true);
    assert.equal(preflight.launch_ready, false);
    assert.equal(preflight.local_production_ready, true);
    assert.equal(preflight.recommended_provider, "chatgpt-account");
    assert.equal(preflight.image_model, "gpt-image-2");
    assert.equal(preflight.uses_image_api_key, false);
    assert.equal(preflight.stages.find((stage) => stage.id === "image2-account-handoff").status, "pass");
    assert.equal(preflight.stages.find((stage) => stage.id === "image2-asset-intake").status, "pass");
    assert.equal(preflight.stages.find((stage) => stage.id === "chatgpt-developer-registration").status, "fail");
    assert.ok(preflight.required_env.some((entry) => entry.name === "PUBLIC_MCP_ORIGIN" && entry.configured === false));
    assert.equal(JSON.stringify(preflight).includes("sk-proj"), false);
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

function listTarEntries(packagePath) {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", ["-tzf", packagePath], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim().split(/\r?\n/).filter(Boolean));
      } else {
        reject(new Error(`tar exited with ${code}\n${stderr}`));
      }
    });
  });
}

const LAUNCH_ENV_KEYS = [
  "PUBLIC_MCP_ORIGIN",
  "CHATGPT_OAUTH_ISSUER",
  "CHATGPT_OAUTH_JWKS_URI",
  "CHATGPT_OAUTH_AUTHORIZE_URL",
  "CHATGPT_OAUTH_TOKEN_URL",
  "CHATGPT_OAUTH_REGISTER_URL",
  "CHATGPT_OAUTH_METADATA_URL",
  "CHATGPT_OAUTH_AUDIENCE",
  "CHATGPT_APP_REGISTERED"
];

const sampleOpenAiDraft = {
  recipe: {
    recipe_name: "OpenAI Prompt Batch",
    source_summary: "AI neon ramen detective",
    genre: "vertical AI mystery short",
    visual_style: "cinematic neon ramen shop detective drama",
    originality_rules: ["Do not copy exact source frames.", "Create new characters and clues."]
  },
  episodes: [
    {
      title: "The Ramen Sign Blinked Twice",
      hook: "The detective noticed the sign blinked only when the bowl was empty.",
      world: "neon ramen alley",
      genre: "ramen detective mystery",
      visual_style: "rainy neon alley with expressive noodle-shop characters",
      duration_seconds: 24,
      hashtags: ["#aistory", "#shorts", "#ramenmystery"],
      captions: [
        { start: 0, end: 3, text: "THE SIGN BLINKED" },
        { start: 4, end: 7, text: "THE BOWL WAS EMPTY" },
        { start: 8, end: 11, text: "WHO ORDERED IT?" }
      ],
      voiceover: [
        "The alley was quiet.",
        "Then the ramen sign blinked twice.",
        "The missing bowl changed the case."
      ],
      shots: [
        {
          duration_seconds: 4,
          visual: "A detective enters a neon ramen alley.",
          image_prompt: "Vertical 9:16 neon ramen alley detective, no text.",
          video_prompt: "Slow rainy push-in."
        },
        {
          duration_seconds: 4,
          visual: "The ramen sign blinks twice.",
          image_prompt: "Vertical 9:16 glowing ramen sign, no text.",
          video_prompt: "Subtle flicker and camera tilt."
        },
        {
          duration_seconds: 4,
          visual: "An empty bowl sits under a spotlight.",
          image_prompt: "Vertical 9:16 empty ramen bowl clue, no text.",
          video_prompt: "Slow zoom toward the bowl."
        },
        {
          duration_seconds: 4,
          visual: "The shop crowd reacts.",
          image_prompt: "Vertical 9:16 ramen shop crowd reaction, no text.",
          video_prompt: "Fast reaction cut."
        }
      ]
    }
  ]
};

function snapshotEnv(keys) {
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  return () => {
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  };
}
