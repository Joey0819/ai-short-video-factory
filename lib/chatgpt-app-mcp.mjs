import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildPublishBundle } from "./artifact-bundle.mjs";
import { DEFAULT_PROJECT_ID, createFactoryProject, writeFactoryProject } from "./factory-core.mjs";
import { attachImage2Assets } from "./image2-assets.mjs";
import { produceVideos } from "./production-pipeline.mjs";
import { readChatGptAccountPresence, readOpenAiKeyPresence } from "./provider-plan.mjs";
import { resolveProductReadiness } from "./product-readiness.mjs";
import {
  CHATGPT_APP_MANIFEST_PATH,
  CHATGPT_APP_RESOURCE_URI,
  CHATGPT_APP_SCOPES,
  CHATGPT_WIDGET_PATH,
  MCP_ENDPOINT_PATH,
  OAUTH_AUTHORIZATION_SERVER_METADATA_PATH,
  OAUTH_AUTHORIZE_PATH,
  OAUTH_PROTECTED_RESOURCE_PATH
} from "./chatgpt-app-constants.mjs";
import {
  buildWwwAuthenticateChallenge,
  getOAuthIssuerUrl,
  resolveOAuthRuntimeConfig,
  verifyMcpAuthorization
} from "./chatgpt-oauth-dev.mjs";

export {
  CHATGPT_APP_MANIFEST_PATH,
  CHATGPT_APP_RESOURCE_URI,
  CHATGPT_APP_SCOPES,
  CHATGPT_WIDGET_PATH,
  MCP_ENDPOINT_PATH,
  OAUTH_PROTECTED_RESOURCE_PATH
};

const MCP_PROTOCOL_VERSION = "2025-06-18";

export function buildChatGptAppManifest({ baseUrl = "http://127.0.0.1:3030", env = process.env } = {}) {
  const tools = buildMcpToolDescriptors({ baseUrl, env });
  const oauthConfig = resolveOAuthRuntimeConfig({ baseUrl, env });
  return {
    name: "AI Short Video Factory",
    description: "Create short-video content drafts, render local MP4 packages, and hand Image 2 prompts to ChatGPT through account-auth MCP tools.",
    archetype: "interactive-decoupled",
    auth_method: "ChatGPT Apps OAuth 2.1 / MCP",
    uses_api_key_for_image2: false,
    mcp_endpoint: `${baseUrl}${MCP_ENDPOINT_PATH}`,
    oauth_protected_resource: `${baseUrl}${OAUTH_PROTECTED_RESOURCE_PATH}`,
    oauth_mode: oauthConfig.mode,
    production_oauth_configured: oauthConfig.production_configured,
    account_required_for_generation: true,
    image2: {
      model: "gpt-image-2",
      auth_method: "ChatGPT Apps OAuth 2.1 / MCP account verification",
      uses_api_key: false,
      handoff_tool: "get_image2_handoff",
      asset_intake_tool: "attach_image2_assets"
    },
    widget: buildWidgetResource({ baseUrl }),
    scopes: CHATGPT_APP_SCOPES,
    tools
  };
}

export function buildOAuthProtectedResourceMetadata({ baseUrl = "http://127.0.0.1:3030", env = process.env } = {}) {
  const oauthConfig = resolveOAuthRuntimeConfig({ baseUrl, env });
  return {
    resource: `${baseUrl}${MCP_ENDPOINT_PATH}`,
    resource_name: "AI Short Video Factory MCP",
    authorization_servers: [oauthConfig.issuer],
    authorization_server_metadata: oauthConfig.authorization_server_metadata,
    scopes_supported: CHATGPT_APP_SCOPES,
    bearer_methods_supported: ["header"],
    resource_documentation: `${baseUrl}${CHATGPT_APP_MANIFEST_PATH}`,
    mcp_server: `${baseUrl}${MCP_ENDPOINT_PATH}`,
    account_verification_marker: "CHATGPT_ACCOUNT_VERIFIED",
    image_model: "gpt-image-2",
    uses_api_key_for_image2: false,
    oauth_mode: oauthConfig.mode,
    production_oauth_configured: oauthConfig.production_configured,
    jwks_uri: oauthConfig.production_configured ? oauthConfig.jwks_uri : null,
    token_endpoint_auth_methods_supported: oauthConfig.token_endpoint_auth_methods_supported
  };
}

export function buildChatGptWidgetHtml({ baseUrl = "http://127.0.0.1:3030" } = {}) {
  const dashboardUrl = baseUrl.replace(/:3030$/, ":3024");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI Short Video Factory</title>
  <style>
    body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #071011; color: #f4ead8; }
    main { display: grid; gap: 14px; padding: 16px; }
    h1 { margin: 0; font-size: 18px; }
    p { margin: 0; color: #9aa7a6; line-height: 1.45; }
    button, a { display: inline-flex; align-items: center; justify-content: center; min-height: 38px; padding: 0 12px; border-radius: 8px; border: 1px solid #2b3b3f; background: #46e0b2; color: #041211; font-weight: 800; text-decoration: none; cursor: pointer; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .secondary { background: rgba(244,234,216,.06); color: #f4ead8; }
    pre { overflow: auto; padding: 12px; border: 1px solid #2b3b3f; border-radius: 8px; background: rgba(0,0,0,.25); color: #9af0d4; }
  </style>
</head>
<body>
  <main>
    <h1>AI Short Video Factory</h1>
    <p>Account-auth MCP surface for content production, MP4 packaging, and Image 2 handoff. Image prompts use ChatGPT account verification, not an OpenAI API key.</p>
    <div class="actions">
      <button type="button" id="produce">Create content + video</button>
      <button type="button" id="handoff" class="secondary">Get Image 2 handoff</button>
      <a href="${escapeHtml(dashboardUrl)}" target="_blank" rel="noreferrer">Open dashboard</a>
    </div>
    <pre id="result">Waiting for ChatGPT tool output...</pre>
  </main>
  <script>
    const result = document.getElementById("result");
    const show = (value) => { result.textContent = JSON.stringify(value, null, 2); };
    const output = window.openai?.toolOutput;
    if (output) show(output);
    document.getElementById("produce").addEventListener("click", async () => {
      if (!window.openai?.callTool) return show({ error: "ChatGPT tool bridge is unavailable in this preview." });
      show(await window.openai.callTool("produce_short_video", { topic: "AI cartoon fruit drama", count: 5, renderCount: 1, renderDuration: 5 }));
    });
    document.getElementById("handoff").addEventListener("click", async () => {
      if (!window.openai?.callTool) return show({ error: "ChatGPT tool bridge is unavailable in this preview." });
      show(await window.openai.callTool("get_image2_handoff", { projectId: "demo-reference", episodeId: "episode-001" }));
    });
  </script>
</body>
</html>`;
}

export async function handleMcpJsonRpc({ message, rootDir = process.cwd(), baseUrl = "http://127.0.0.1:3030", authorization = "", env = process.env } = {}) {
  if (Array.isArray(message)) {
    return Promise.all(message.map((entry) => handleSingleMcpMessage({ message: entry, rootDir, baseUrl, authorization, env })));
  }
  return handleSingleMcpMessage({ message, rootDir, baseUrl, authorization, env });
}

async function handleSingleMcpMessage({ message, rootDir, baseUrl, authorization, env }) {
  const id = Object.hasOwn(message ?? {}, "id") ? message.id : null;
  try {
    if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return jsonRpcError(id, -32600, "Invalid JSON-RPC request.");
    }

    if (message.method === "initialize") {
      return jsonRpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
          resources: {}
        },
        serverInfo: {
          name: "ai-short-video-factory",
          title: "AI Short Video Factory",
          version: "0.1.0"
        }
      });
    }

    if (message.method === "tools/list") {
      return jsonRpcResult(id, {
        tools: buildMcpToolDescriptors({ baseUrl, env })
      });
    }

    if (message.method === "resources/list") {
      return jsonRpcResult(id, {
        resources: [buildWidgetResource({ baseUrl })]
      });
    }

    if (message.method === "resources/read") {
      const uri = message.params?.uri;
      if (uri !== CHATGPT_APP_RESOURCE_URI) {
        return jsonRpcError(id, -32602, `Unknown resource URI ${String(uri)}.`);
      }
      return jsonRpcResult(id, {
        contents: [
          {
            uri: CHATGPT_APP_RESOURCE_URI,
            mimeType: "text/html;profile=mcp-app",
            text: buildChatGptWidgetHtml({ baseUrl }),
            _meta: buildWidgetResourceMetadata({ baseUrl })
          }
        ]
      });
    }

    if (message.method === "tools/call") {
      const name = message.params?.name;
      const args = message.params?.arguments ?? {};
      const result = await callMcpTool({ name, args, rootDir, baseUrl, authorization, env });
      return jsonRpcResult(id, result);
    }

    return jsonRpcError(id, -32601, `Unsupported MCP method ${message.method}.`);
  } catch (error) {
    return jsonRpcError(id, -32000, error instanceof Error ? error.message : "MCP handler failed.");
  }
}

async function callMcpTool({ name, args, rootDir, baseUrl, authorization, env }) {
  const tool = buildMcpToolDescriptors({ baseUrl, env }).find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Unknown tool ${String(name)}.`);
  }

  let accountAuthenticated = false;
  if (tool.requires_account_auth) {
    const requiredScopes = Array.isArray(tool.required_scopes)
      ? tool.required_scopes
      : [tool.required_scope].filter(Boolean);
    const auth = await verifyMcpAuthorization({
      authorization,
      requiredScopes,
      baseUrl,
      env,
      rootDir
    });
    if (!auth.ok) {
      return buildAuthRequiredToolResult({
        baseUrl,
        scope: requiredScopes.join(" "),
        error: auth.error,
        description: auth.description
      });
    }
    accountAuthenticated = true;
  }

  if (name === "get_product_readiness") {
    const readiness = await resolveProductReadiness({ rootDir });
    return {
      structuredContent: {
        ready: readiness.ready,
        project_id: readiness.project_id,
        summary: readiness.summary,
        checks: readiness.checks
      },
      content: [{ type: "text", text: `Product readiness is ${readiness.ready ? "ready" : "not ready"}.` }]
    };
  }

  if (name === "create_short_video_project") {
    const project = await createProjectFromArgs({ args, rootDir, accountAuthenticated });
    await writeFactoryProject(project, rootDir);
    return {
      structuredContent: {
        project_id: project.id,
        topic: project.recipe.source_summary,
        content_count: project.episodes.length,
        provider_mode: project.provider_mode,
        episodes: project.episodes.map(toEpisodeSummary)
      },
      content: [{ type: "text", text: `Created ${project.episodes.length} content drafts for ${project.recipe.source_summary}.` }]
    };
  }

  if (name === "produce_short_video") {
    const project = await createProjectFromArgs({ args, rootDir, accountAuthenticated });
    const production = await produceVideos({
      rootDir,
      project,
      renderCount: normalizeCount(args.renderCount, 1),
      renderDuration: normalizeOptionalCount(args.renderDuration)
    });
    return {
      structuredContent: {
        project_id: production.project.id,
        topic: production.project.recipe.source_summary,
        content_count: production.project.episodes.length,
        provider_mode: production.project.provider_mode,
        rendered_count: production.artifacts.length,
        production_manifest_path: production.production_manifest_path,
        production_package_path: production.production_package_path,
        artifacts: production.artifacts
      },
      content: [{ type: "text", text: `Created ${production.project.episodes.length} drafts and rendered ${production.artifacts.length} MP4 artifact.` }],
      _meta: {
        dashboard_url: baseUrl.replace(/:3030$/, ":3024"),
        artifacts: production.artifacts
      }
    };
  }

  if (name === "get_image2_handoff") {
    const projectId = normalizeText(args.projectId, DEFAULT_PROJECT_ID);
    const episodeId = normalizeText(args.episodeId, "episode-001");
    const handoff = await readOrBuildImage2Handoff({ rootDir, projectId, episodeId, accountAuthenticated });
    return {
      structuredContent: {
        project_id: handoff.project_id,
        episode_id: handoff.episode_id,
        model: handoff.model,
        auth_method: handoff.auth_method,
        uses_api_key: handoff.uses_api_key,
        status: handoff.status,
        prompt_count: handoff.prompts.length,
        prompts: handoff.prompts
      },
      content: [{ type: "text", text: `Image 2 handoff is ${handoff.status} with ${handoff.prompts.length} prompts.` }]
    };
  }

  if (name === "attach_image2_assets") {
    const projectId = normalizeText(args.projectId, DEFAULT_PROJECT_ID);
    const episodeId = normalizeText(args.episodeId, "episode-001");
    const manifest = await attachImage2Assets({
      rootDir,
      projectId,
      episodeId,
      assets: args.assets,
      source: "chatgpt-account"
    });
    const project = markProjectAccountAuthenticated(await readCurrentProject(rootDir), accountAuthenticated);
    await buildPublishBundle({ rootDir, project, episodeId });
    return {
      structuredContent: {
        project_id: manifest.project_id,
        episode_id: manifest.episode_id,
        model: manifest.model,
        auth_method: manifest.auth_method,
        uses_api_key: manifest.uses_api_key,
        asset_count: manifest.asset_count,
        manifest_path: manifest.manifest_path,
        assets: manifest.assets.map((asset) => ({
          shot_id: asset.shot_id,
          mime_type: asset.mime_type,
          size_bytes: asset.size_bytes,
          storage_path: asset.storage_path,
          artifact_path: asset.artifact_path
        }))
      },
      content: [{ type: "text", text: `Attached ${manifest.asset_count} Image 2 asset${manifest.asset_count === 1 ? "" : "s"} for ${episodeId}.` }]
    };
  }

  throw new Error(`No handler registered for ${name}.`);
}

export function buildMcpToolDescriptors({ baseUrl = "http://127.0.0.1:3030", env = process.env } = {}) {
  const createProjectSecuritySchemes = securitySchemesForScopes({ baseUrl, env, scopes: ["shortvideo:write"] });
  const produceSecuritySchemes = securitySchemesForScopes({ baseUrl, env, scopes: ["shortvideo:write", "image2:handoff"] });
  const image2SecuritySchemes = securitySchemesForScopes({ baseUrl, env, scopes: ["image2:handoff"] });
  const image2WriteSecuritySchemes = securitySchemesForScopes({ baseUrl, env, scopes: ["shortvideo:write", "image2:handoff"] });
  return [
    {
      name: "get_product_readiness",
      title: "Get product readiness",
      description: "Use this when you need to check whether generated content, MP4 output, publish bundles, Image 2 handoff files, and the package archive are ready.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false
      },
      securitySchemes: [{ type: "noauth" }],
      _meta: {
        securitySchemes: [{ type: "noauth" }],
        "openai/toolInvocation/invoking": "Checking product readiness",
        "openai/toolInvocation/invoked": "Readiness checked"
      }
    },
    {
      name: "create_short_video_project",
      title: "Create short video project",
      description: "Use this when the user wants original short-video content drafts from a topic, reference video, screenshot, or text idea before rendering MP4.",
      inputSchema: buildContentInputSchema({ includeRender: false }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false
      },
      securitySchemes: createProjectSecuritySchemes,
      requires_account_auth: true,
      required_scopes: ["shortvideo:write"],
      _meta: buildToolMeta({ baseUrl, securitySchemes: createProjectSecuritySchemes, invoking: "Creating drafts", invoked: "Drafts created" })
    },
    {
      name: "produce_short_video",
      title: "Produce short video",
      description: "Use this when the user wants a complete production run: content drafts, local MP4 render, publish bundle, Image 2 handoff, batch manifest, and package archive.",
      inputSchema: buildContentInputSchema({ includeRender: true }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false
      },
      securitySchemes: produceSecuritySchemes,
      requires_account_auth: true,
      required_scopes: ["shortvideo:write", "image2:handoff"],
      _meta: buildToolMeta({ baseUrl, securitySchemes: produceSecuritySchemes, invoking: "Producing video", invoked: "Video produced" })
    },
    {
      name: "get_image2_handoff",
      title: "Get Image 2 handoff",
      description: "Use this when the user needs the gpt-image-2 prompt handoff for a rendered episode through ChatGPT account authentication, without an OpenAI API key.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "Project id, usually demo-reference." },
          episodeId: { type: "string", description: "Episode id, for example episode-001." }
        },
        required: ["episodeId"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false
      },
      securitySchemes: image2SecuritySchemes,
      requires_account_auth: true,
      required_scopes: ["image2:handoff"],
      _meta: buildToolMeta({ baseUrl, securitySchemes: image2SecuritySchemes, invoking: "Reading Image 2 handoff", invoked: "Image 2 handoff ready" })
    },
    {
      name: "attach_image2_assets",
      title: "Attach Image 2 assets",
      description: "Use this after ChatGPT Image 2 generates shot stills through account auth. The backend stores the generated image assets for packaging and later rendering without using an OpenAI Image API key.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "Project id, usually demo-reference." },
          episodeId: { type: "string", description: "Episode id, for example episode-001." },
          assets: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: {
              type: "object",
              properties: {
                shotId: { type: "integer", minimum: 1, maximum: 999, description: "Shot id from the Image 2 handoff." },
                fileName: { type: "string", description: "Original image file name." },
                mimeType: { type: "string", enum: ["image/png", "image/jpeg", "image/webp"] },
                data: { type: "string", description: "Base64 image data or a data URL." }
              },
              required: ["shotId", "fileName", "mimeType", "data"],
              additionalProperties: false
            }
          }
        },
        required: ["episodeId", "assets"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false
      },
      securitySchemes: image2WriteSecuritySchemes,
      requires_account_auth: true,
      required_scopes: ["shortvideo:write", "image2:handoff"],
      _meta: buildToolMeta({ baseUrl, securitySchemes: image2WriteSecuritySchemes, invoking: "Attaching Image 2 assets", invoked: "Image 2 assets attached" })
    }
  ];
}

function buildContentInputSchema({ includeRender }) {
  const properties = {
    topic: { type: "string", description: "Short-video concept or hook. Example: AI cartoon fruit drama." },
    count: { type: "integer", minimum: 1, maximum: 12, description: "Number of content drafts to create." },
    sourceType: { type: "string", enum: ["text idea", "reference video", "screenshot"], description: "Input source type." }
  };

  if (includeRender) {
    properties.renderCount = { type: "integer", minimum: 1, maximum: 12, description: "Number of episodes to render to MP4." };
    properties.renderDuration = { type: "integer", minimum: 3, maximum: 60, description: "Optional duration override in seconds." };
  }

  return {
    type: "object",
    properties,
    required: ["topic"],
    additionalProperties: false
  };
}

function buildToolMeta({ baseUrl, securitySchemes, invoking, invoked }) {
  return {
    securitySchemes,
    ui: {
      resourceUri: CHATGPT_APP_RESOURCE_URI,
      visibility: ["model", "app"]
    },
    "openai/outputTemplate": CHATGPT_APP_RESOURCE_URI,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked
  };
}

function buildSecuritySchemes({ baseUrl, env }) {
  return securitySchemesForScopes({ baseUrl, env, scopes: CHATGPT_APP_SCOPES });
}

function securitySchemesForScopes({ baseUrl, env, scopes }) {
  const oauthConfig = resolveOAuthRuntimeConfig({ baseUrl, env });
  return [
    {
      type: "oauth2",
      scopes,
      authorizationUrl: oauthConfig.authorization_endpoint,
      resource_metadata: `${baseUrl}${OAUTH_PROTECTED_RESOURCE_PATH}`
    }
  ];
}

function buildWidgetResource({ baseUrl }) {
  return {
    uri: CHATGPT_APP_RESOURCE_URI,
    name: "AI Short Video Factory Dashboard",
    title: "AI Short Video Factory",
    description: "Dashboard widget for ChatGPT account-auth short-video production and Image 2 handoff.",
    mimeType: "text/html;profile=mcp-app",
    endpoint: `${baseUrl}${CHATGPT_WIDGET_PATH}`,
    _meta: buildWidgetResourceMetadata({ baseUrl })
  };
}

function buildWidgetResourceMetadata({ baseUrl }) {
  const dashboardUrl = baseUrl.replace(/:3030$/, ":3024");
  const submissionDomain = baseUrl.startsWith("https://") ? baseUrl : undefined;
  const ui = {
    prefersBorder: true,
    csp: {
      connectDomains: [baseUrl],
      resourceDomains: [baseUrl]
    }
  };
  if (submissionDomain) ui.domain = submissionDomain;

  return {
    ui,
    "openai/widgetDescription": "Create short-video content, render MP4 packages, and inspect account-auth Image 2 handoff prompts.",
    "openai/widgetPrefersBorder": true,
    "openai/widgetCSP": {
      connect_domains: [baseUrl],
      resource_domains: [baseUrl],
      redirect_domains: [dashboardUrl]
    }
  };
}

function buildAuthRequiredToolResult({
  baseUrl,
  scope,
  error = "invalid_token",
  description = "Connect a verified ChatGPT account to continue."
}) {
  const challenge = buildWwwAuthenticateChallenge({
    baseUrl,
    scope,
    error,
    description
  });
  return {
    isError: true,
    structuredContent: {
      authentication_required: true,
      scope,
      auth_method: "ChatGPT Apps OAuth 2.1 / MCP",
      uses_api_key: false
    },
    content: [{ type: "text", text: `Authentication required: ${description}` }],
    _meta: {
      "mcp/www_authenticate": [challenge]
    }
  };
}

async function createProjectFromArgs({ args, rootDir, accountAuthenticated = false }) {
  const keyPresence = await readOpenAiKeyPresence({
    envFilePath: path.join(rootDir, ".env.local")
  });
  const accountPresence = await readChatGptAccountPresence({
    envFilePath: path.join(rootDir, ".env.local")
  });
  const chatGptAccountVerified = accountAuthenticated || accountPresence.configured;
  return createFactoryProject({
    topic: normalizeText(args.topic, "AI cartoon fruit drama"),
    count: normalizeCount(args.count, 5),
    sourceType: normalizeText(args.sourceType, "text idea"),
    openAiConfigured: keyPresence.configured,
    openAiSource: keyPresence.source,
    chatGptAccountVerified,
    chatGptAccountSource: accountAuthenticated ? "mcp-oauth-token" : accountPresence.source,
    providerMode: chatGptAccountVerified ? "chatgpt-account" : undefined,
    videoProvider: "local-ffmpeg"
  });
}

async function readOrBuildImage2Handoff({ rootDir, projectId, episodeId, accountAuthenticated = false }) {
  const handoffPath = path.join(rootDir, "outputs", projectId, episodeId, "publish-bundle", "image2-handoff.json");
  try {
    const existing = JSON.parse(await readFile(handoffPath, "utf8"));
    if (!accountAuthenticated || existing.status === "ready") return existing;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const project = markProjectAccountAuthenticated(await readCurrentProject(rootDir), accountAuthenticated);
  await buildPublishBundle({ rootDir, project, episodeId });
  return JSON.parse(await readFile(handoffPath, "utf8"));
}

function markProjectAccountAuthenticated(project, accountAuthenticated) {
  if (!accountAuthenticated) return project;
  const providerStatus = project.provider_status ?? {};
  return {
    ...project,
    provider_mode: "chatgpt-account",
    provider_status: {
      ...providerStatus,
      account_auth: {
        ...(providerStatus.account_auth ?? {}),
        env_name: providerStatus.account_auth?.env_name ?? "CHATGPT_ACCOUNT_VERIFIED",
        local_target: providerStatus.account_auth?.local_target ?? ".env.local",
        configured: true,
        source: "mcp-oauth-token",
        method: "ChatGPT Apps OAuth 2.1"
      }
    }
  };
}

async function readCurrentProject(rootDir) {
  const candidates = [
    path.join(rootDir, "storage", "projects", DEFAULT_PROJECT_ID, "project.json"),
    path.join(rootDir, "public", "factory-state.json")
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(await readFile(candidate, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error("Cannot find project state. Create or produce a project first.");
}

function toEpisodeSummary(episode) {
  return {
    id: episode.id,
    title: episode.title,
    status: episode.status,
    review_gate: episode.review_gate,
    output_path: episode.output_path
  };
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function normalizeText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeCount(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(Math.floor(numeric), 50));
}

function normalizeOptionalCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(3, Math.min(Math.floor(numeric), 60));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
