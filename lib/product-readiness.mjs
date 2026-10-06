import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  CHATGPT_APP_MANIFEST_PATH,
  CHATGPT_APP_SCOPES,
  CHATGPT_MCP_TOOL_NAMES,
  MCP_ENDPOINT_PATH,
  OAUTH_AUTHORIZATION_SERVER_METADATA_PATH,
  OAUTH_AUTHORIZE_PATH,
  OAUTH_PROTECTED_RESOURCE_PATH,
  OAUTH_REGISTER_PATH,
  OAUTH_TOKEN_PATH
} from "./chatgpt-app-constants.mjs";
import { DEFAULT_PROJECT_ID } from "./factory-core.mjs";
import {
  readChatGptAccountPresence,
  readChatGptAppRegistrationPresence,
  readChatGptOAuthProviderPresence,
  readOpenAiKeyPresence,
  readPublicMcpOriginPresence
} from "./provider-plan.mjs";

const MIN_ARTIFACT_BYTES = 1000;

export async function resolveProductReadiness({ rootDir = process.cwd() } = {}) {
  const generatedAt = new Date().toISOString();
  const keyPresence = await readOpenAiKeyPresence({
    envFilePath: path.join(rootDir, ".env.local")
  });
  const accountPresence = await readChatGptAccountPresence({
    envFilePath: path.join(rootDir, ".env.local")
  });
  const appRegistration = await readChatGptAppRegistrationPresence({
    envFilePath: path.join(rootDir, ".env.local")
  });
  const oauthProvider = await readChatGptOAuthProviderPresence({
    envFilePath: path.join(rootDir, ".env.local")
  });
  const publicOrigin = await readPublicMcpOriginPresence({
    envFilePath: path.join(rootDir, ".env.local")
  });
  const state = await readProjectState(rootDir);
  const projectId = state?.id ?? DEFAULT_PROJECT_ID;
  const productionManifestPath = path.join(rootDir, "outputs", projectId, "production-manifest.json");
  const productionPackagePath = path.join(rootDir, "outputs", projectId, "production-package.tar.gz");
  const productionManifest = await readJsonIfExists(productionManifestPath);
  const providerWarnings = Array.isArray(productionManifest?.warnings)
    ? productionManifest.warnings.filter((warning) => typeof warning === "string" && warning.trim().length > 0)
    : [];
  const episodes = Array.isArray(state?.episodes) ? state.episodes : [];
  const artifacts = Array.isArray(productionManifest?.artifacts) ? productionManifest.artifacts : [];
  const renderedVideos = await countExistingVideos({ rootDir, projectId, episodes, artifacts });
  const publishBundles = await countExistingBundles({ rootDir, projectId, artifacts });
  const image2Handoffs = await countExistingImage2Handoffs({ rootDir, projectId, artifacts });
  const image2Assets = await countExistingImage2Assets({ rootDir, projectId, artifacts });
  const packageStats = await statIfExists(productionPackagePath);
  const packageBytes = packageStats?.size ?? 0;
  const sourceAsset = state?.source_asset ?? null;
  const sourceAssetStats = await statSourceAsset({ rootDir, sourceAsset });

  const checks = [
    buildCheck({
      id: "backend_api",
      label: "Backend API",
      passed: true,
      summary: "Readiness endpoint is responding."
    }),
    buildCheck({
      id: "content_state",
      label: "Generated content",
      passed: episodes.length > 0,
      summary: episodes.length > 0 ? `${episodes.length} episode drafts available.` : "No generated episodes found."
    }),
    buildCheck({
      id: "reference_asset",
      label: "Reference asset",
      passed: Boolean(sourceAssetStats?.size),
      required: false,
      summary: sourceAssetStats?.size
        ? `${sourceAsset.file_name} stored as ${formatBytes(sourceAssetStats.size)} ${sourceAsset.kind} reference.`
        : "Optional: upload a screenshot or reference video, or continue from a text idea."
    }),
    buildCheck({
      id: "rendered_video",
      label: "Playable MP4",
      passed: renderedVideos > 0,
      summary: renderedVideos > 0 ? `${renderedVideos} rendered MP4 file${renderedVideos === 1 ? "" : "s"} found.` : "No rendered MP4 artifact found."
    }),
    buildCheck({
      id: "publish_bundle",
      label: "Publish bundle",
      passed: publishBundles > 0,
      summary: publishBundles > 0 ? `${publishBundles} publish bundle${publishBundles === 1 ? "" : "s"} ready.` : "No publish bundle manifest found."
    }),
    buildCheck({
      id: "image2_handoff",
      label: "Image 2 handoff",
      passed: image2Handoffs > 0,
      summary: image2Handoffs > 0 ? `${image2Handoffs} Image 2 handoff file${image2Handoffs === 1 ? "" : "s"} ready.` : "No Image 2 handoff file found."
    }),
    buildCheck({
      id: "image2_assets",
      label: "Image 2 assets",
      passed: image2Assets > 0,
      required: false,
      commercial: true,
      summary: image2Assets > 0
        ? `${image2Assets} Image 2 generated asset manifest${image2Assets === 1 ? "" : "s"} attached.`
        : "Optional before public launch: attach ChatGPT/Image 2 generated shot stills through the account-auth MCP tool."
    }),
    buildCheck({
      id: "chatgpt_mcp_app",
      label: "ChatGPT MCP app",
      passed: true,
      summary: `${CHATGPT_MCP_TOOL_NAMES.length} MCP tools exposed at ${MCP_ENDPOINT_PATH}; OAuth protected-resource and PKCE authorization-server metadata are available.`
    }),
    buildCheck({
      id: "chatgpt_app_registration",
      label: "ChatGPT app registration",
      passed: appRegistration.configured,
      required: false,
      commercial: true,
      summary: appRegistration.configured
        ? `ChatGPT app registration marker found from ${appRegistration.source}.`
        : "Mark CHATGPT_APP_REGISTERED=true only after the public MCP server is registered and tested in ChatGPT Developer Mode."
    }),
    buildCheck({
      id: "oauth_pkce_issuer",
      label: "OAuth PKCE issuer",
      passed: true,
      summary: `Authorization metadata at ${OAUTH_AUTHORIZATION_SERVER_METADATA_PATH}; token endpoint at ${OAUTH_TOKEN_PATH}; PKCE S256 required.`
    }),
    buildCheck({
      id: "commercial_public_origin",
      label: "Public HTTPS MCP",
      passed: publicOrigin.configured,
      required: false,
      commercial: true,
      summary: publicOrigin.configured
        ? `PUBLIC_MCP_ORIGIN is configured from ${publicOrigin.source}.`
        : publicOrigin.reason
    }),
    buildCheck({
      id: "production_oauth_verifier",
      label: "Production OAuth verifier",
      passed: oauthProvider.configured,
      required: false,
      commercial: true,
      summary: oauthProvider.configured
        ? `External OAuth/OIDC JWKS verifier configured from ${oauthProvider.source}.`
        : "Optional: using local development OAuth issuer until CHATGPT_OAUTH_ISSUER and CHATGPT_OAUTH_JWKS_URI are configured."
    }),
    buildCheck({
      id: "production_manifest",
      label: "Batch manifest",
      passed: Boolean(productionManifest?.project_id && Number(productionManifest.rendered_count) > 0),
      summary: productionManifest?.project_id
        ? `${productionManifest.rendered_count ?? 0} rendered item${Number(productionManifest.rendered_count) === 1 ? "" : "s"} recorded.`
        : "No production manifest found."
    }),
    buildCheck({
      id: "production_package",
      label: "Download package",
      passed: packageBytes > MIN_ARTIFACT_BYTES,
      summary: packageBytes > MIN_ARTIFACT_BYTES ? `${formatBytes(packageBytes)} archive ready.` : "No production package archive found."
    }),
    buildCheck({
      id: "openai_live",
      label: "OpenAI live mode",
      passed: keyPresence.configured,
      required: false,
      summary: keyPresence.configured ? `Key configured from ${keyPresence.source}.` : "Optional: key not saved; local production remains available."
    }),
    buildCheck({
      id: "provider_diagnostics",
      label: "Provider diagnostics",
      passed: providerWarnings.length === 0,
      required: false,
      summary: providerWarnings.length
        ? providerWarnings.slice(0, 2).join(" ")
        : "No provider fallback warnings in the latest production manifest."
    }),
    buildCheck({
      id: "chatgpt_account",
      label: "ChatGPT account",
      passed: accountPresence.configured,
      required: false,
      commercial: true,
      summary: accountPresence.configured
        ? `Account verification marker found from ${accountPresence.source}.`
        : "Optional: account verification pending; local production remains available."
    })
  ];

  const requiredChecks = checks.filter((check) => check.required);
  const localReady = requiredChecks.every((check) => check.status === "pass");
  const commercialReady = localReady && accountPresence.configured && appRegistration.configured && oauthProvider.configured && publicOrigin.configured;
  return {
    ok: true,
    ready: localReady,
    commercial_ready: commercialReady,
    openai_live_ready: keyPresence.configured,
    chatgpt_account_ready: accountPresence.configured,
    chatgpt_mcp_app_ready: true,
    chatgpt_app_registered: appRegistration.configured,
    project_id: projectId,
    generated_at: generatedAt,
    summary: {
      content_count: episodes.length,
      rendered_count: renderedVideos,
      publish_bundle_count: publishBundles,
      image2_handoff_count: image2Handoffs,
      image2_asset_count: image2Assets,
      mcp_tool_count: CHATGPT_MCP_TOOL_NAMES.length,
      oauth_pkce_ready: true,
      oauth_mode: oauthProvider.mode,
      production_oauth_configured: oauthProvider.configured,
      public_mcp_origin_configured: publicOrigin.configured,
      public_mcp_origin: publicOrigin.origin,
      chatgpt_app_registered: appRegistration.configured,
      reference_asset_configured: Boolean(sourceAssetStats?.size),
      production_package_bytes: packageBytes,
      provider_warnings: providerWarnings,
      launch_blockers: commercialReady
        ? []
        : [
            publicOrigin.configured ? null : "Configure PUBLIC_MCP_ORIGIN with a public HTTPS URL.",
            oauthProvider.configured ? null : "Configure CHATGPT_OAUTH_ISSUER and CHATGPT_OAUTH_JWKS_URI.",
            appRegistration.configured ? null : "Register and test the MCP app in ChatGPT Developer Mode, then set CHATGPT_APP_REGISTERED=true.",
            accountPresence.configured ? null : "Complete ChatGPT account verification."
          ].filter(Boolean)
    },
    chatgpt_app: {
      manifest_path: CHATGPT_APP_MANIFEST_PATH,
      mcp_endpoint: MCP_ENDPOINT_PATH,
      oauth_protected_resource: OAUTH_PROTECTED_RESOURCE_PATH,
      oauth_authorization_server: OAUTH_AUTHORIZATION_SERVER_METADATA_PATH,
      oauth_authorize: OAUTH_AUTHORIZE_PATH,
      oauth_token: OAUTH_TOKEN_PATH,
      oauth_register: OAUTH_REGISTER_PATH,
      oauth_mode: oauthProvider.mode,
      production_oauth_configured: oauthProvider.configured,
      public_mcp_origin: publicOrigin.origin,
      registered: appRegistration.configured,
      scopes: CHATGPT_APP_SCOPES,
      tools: CHATGPT_MCP_TOOL_NAMES
    },
    checks
  };
}

async function readProjectState(rootDir) {
  const candidates = [
    path.join(rootDir, "storage", "projects", DEFAULT_PROJECT_ID, "project.json"),
    path.join(rootDir, "public", "factory-state.json")
  ];

  for (const candidate of candidates) {
    const parsed = await readJsonIfExists(candidate);
    if (parsed) return parsed;
  }
  return null;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function statIfExists(filePath) {
  try {
    return await stat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function statSourceAsset({ rootDir, sourceAsset }) {
  if (!sourceAsset?.storage_path || typeof sourceAsset.storage_path !== "string") return null;
  const filePath = path.isAbsolute(sourceAsset.storage_path)
    ? sourceAsset.storage_path
    : path.join(rootDir, sourceAsset.storage_path);
  return statIfExists(filePath);
}

async function countExistingVideos({ rootDir, projectId, episodes, artifacts }) {
  const paths = new Set();
  for (const artifact of artifacts) {
    if (typeof artifact.output_path === "string") paths.add(artifact.output_path);
  }
  for (const episode of episodes) {
    if (episode?.status === "rendered" && typeof episode.output_path === "string") paths.add(episode.output_path);
  }
  if (paths.size === 0) {
    paths.add(path.join("outputs", projectId, "episode-001", "final.mp4"));
  }

  let count = 0;
  for (const outputPath of paths) {
    const filePath = path.isAbsolute(outputPath) ? outputPath : path.join(rootDir, outputPath);
    const stats = await statIfExists(filePath);
    if (stats?.size > MIN_ARTIFACT_BYTES) count += 1;
  }
  return count;
}

async function countExistingBundles({ rootDir, projectId, artifacts }) {
  const paths = new Set();
  for (const artifact of artifacts) {
    if (typeof artifact.manifest_path === "string") paths.add(artifact.manifest_path);
  }
  if (paths.size === 0) {
    paths.add(path.join("outputs", projectId, "episode-001", "publish-bundle", "manifest.json"));
  }

  let count = 0;
  for (const manifestPath of paths) {
    const filePath = path.isAbsolute(manifestPath) ? manifestPath : path.join(rootDir, manifestPath);
    const manifest = await readJsonIfExists(filePath);
    if (manifest?.publish_ready) count += 1;
  }
  return count;
}

async function countExistingImage2Handoffs({ rootDir, projectId, artifacts }) {
  const paths = new Set();
  for (const artifact of artifacts) {
    if (typeof artifact.image2_handoff_path === "string") paths.add(artifact.image2_handoff_path);
    if (typeof artifact.manifest_path === "string") {
      paths.add(path.join(path.dirname(artifact.manifest_path), "image2-handoff.json"));
    }
  }
  if (paths.size === 0) {
    paths.add(path.join("outputs", projectId, "episode-001", "publish-bundle", "image2-handoff.json"));
  }

  let count = 0;
  for (const image2Path of paths) {
    const filePath = path.isAbsolute(image2Path) ? image2Path : path.join(rootDir, image2Path);
    const handoff = await readJsonIfExists(filePath);
    if (handoff?.model === "gpt-image-2" && Array.isArray(handoff.prompts) && handoff.prompts.length > 0) count += 1;
  }
  return count;
}

async function countExistingImage2Assets({ rootDir, projectId, artifacts }) {
  const paths = new Set();
  for (const artifact of artifacts) {
    if (typeof artifact.image2_asset_manifest_path === "string") paths.add(artifact.image2_asset_manifest_path);
    if (typeof artifact.manifest_path === "string") {
      paths.add(path.join(path.dirname(artifact.manifest_path), "..", "image2-assets", "manifest.json"));
    }
  }
  if (paths.size === 0) {
    paths.add(path.join("outputs", projectId, "episode-001", "image2-assets", "manifest.json"));
  }

  let count = 0;
  for (const assetManifestPath of paths) {
    const filePath = path.isAbsolute(assetManifestPath) ? assetManifestPath : path.join(rootDir, assetManifestPath);
    const manifest = await readJsonIfExists(filePath);
    if (manifest?.model === "gpt-image-2" && manifest.uses_api_key === false && Number(manifest.asset_count) > 0) count += 1;
  }
  return count;
}

function buildCheck({ id, label, passed, summary, required = true, commercial = false }) {
  return {
    id,
    label,
    status: passed ? "pass" : required ? "fail" : "warn",
    required,
    commercial,
    summary
  };
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
