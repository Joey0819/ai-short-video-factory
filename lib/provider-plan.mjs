import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CHATGPT_APP_MANIFEST_PATH,
  CHATGPT_APP_SCOPES,
  MCP_ENDPOINT_PATH,
  OAUTH_AUTHORIZATION_SERVER_METADATA_PATH,
  OAUTH_AUTHORIZE_PATH,
  OAUTH_PROTECTED_RESOURCE_PATH,
  OAUTH_REGISTER_PATH,
  OAUTH_TOKEN_PATH
} from "./chatgpt-app-constants.mjs";

export const DEFAULT_ENV_TARGET = ".env.local";
export const CHATGPT_ACCOUNT_FLAG = "CHATGPT_ACCOUNT_VERIFIED";
export const CHATGPT_APP_REGISTERED_FLAG = "CHATGPT_APP_REGISTERED";
export const LAUNCH_CONFIG_KEYS = [
  "PUBLIC_MCP_ORIGIN",
  "CHATGPT_OAUTH_ISSUER",
  "CHATGPT_OAUTH_JWKS_URI",
  "CHATGPT_OAUTH_AUTHORIZE_URL",
  "CHATGPT_OAUTH_TOKEN_URL",
  "CHATGPT_OAUTH_REGISTER_URL",
  "CHATGPT_OAUTH_METADATA_URL",
  "CHATGPT_OAUTH_AUDIENCE",
  CHATGPT_APP_REGISTERED_FLAG
];

export function parseEnvContent(content) {
  const env = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) env[key] = value;
  }
  return env;
}

export async function readOpenAiKeyPresence({ env = process.env, envFilePath = path.join(process.cwd(), DEFAULT_ENV_TARGET) } = {}) {
  if (hasUsableKey(env.OPENAI_API_KEY)) {
    return { configured: true, source: "environment" };
  }

  try {
    const localEnv = parseEnvContent(await readFile(envFilePath, "utf8"));
    if (hasUsableKey(localEnv.OPENAI_API_KEY)) {
      return { configured: true, source: DEFAULT_ENV_TARGET };
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  return { configured: false, source: "missing" };
}

export async function loadLocalEnv({
  envFilePath = path.join(process.cwd(), DEFAULT_ENV_TARGET),
  env = process.env,
  override = false
} = {}) {
  let parsed = {};
  try {
    parsed = parseEnvContent(await readFile(envFilePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { loaded: false, env_file: envFilePath, keys: [] };
    }
    throw error;
  }

  const keys = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (!key) continue;
    if (override || env[key] === undefined) {
      env[key] = value;
      keys.push(key);
    }
  }

  return {
    loaded: true,
    env_file: envFilePath,
    keys
  };
}

export async function readChatGptAccountPresence({ env = process.env, envFilePath = path.join(process.cwd(), DEFAULT_ENV_TARGET) } = {}) {
  if (isEnabled(env[CHATGPT_ACCOUNT_FLAG])) {
    return { configured: true, source: "environment" };
  }

  try {
    const localEnv = parseEnvContent(await readFile(envFilePath, "utf8"));
    if (isEnabled(localEnv[CHATGPT_ACCOUNT_FLAG])) {
      return { configured: true, source: DEFAULT_ENV_TARGET };
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  return { configured: false, source: "missing" };
}

export async function readChatGptAppRegistrationPresence({ env = process.env, envFilePath = path.join(process.cwd(), DEFAULT_ENV_TARGET) } = {}) {
  if (isEnabled(env[CHATGPT_APP_REGISTERED_FLAG])) {
    return { configured: true, source: "environment" };
  }

  try {
    const localEnv = parseEnvContent(await readFile(envFilePath, "utf8"));
    if (isEnabled(localEnv[CHATGPT_APP_REGISTERED_FLAG])) {
      return { configured: true, source: DEFAULT_ENV_TARGET };
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  return { configured: false, source: "missing" };
}

export async function readChatGptOAuthProviderPresence({ env = process.env, envFilePath = path.join(process.cwd(), DEFAULT_ENV_TARGET) } = {}) {
  let localEnv = {};
  let localSource = "missing";
  try {
    localEnv = parseEnvContent(await readFile(envFilePath, "utf8"));
    localSource = DEFAULT_ENV_TARGET;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const merged = { ...localEnv, ...env };
  const issuer = normalizeUrl(merged.CHATGPT_OAUTH_ISSUER);
  const jwksUri = normalizeUrl(merged.CHATGPT_OAUTH_JWKS_URI);
  const configured = Boolean(issuer && jwksUri);
  return {
    configured,
    mode: configured ? "production" : "development",
    source: configured && (env.CHATGPT_OAUTH_ISSUER || env.CHATGPT_OAUTH_JWKS_URI) ? "environment" : configured ? localSource : "local-dev",
    issuer: configured ? issuer : "local-dev",
    jwks_uri: configured ? jwksUri : null,
    missing: [
      issuer ? null : "CHATGPT_OAUTH_ISSUER",
      jwksUri ? null : "CHATGPT_OAUTH_JWKS_URI"
    ].filter(Boolean)
  };
}

export async function readPublicMcpOriginPresence({ env = process.env, envFilePath = path.join(process.cwd(), DEFAULT_ENV_TARGET) } = {}) {
  let localEnv = {};
  let localSource = "missing";
  try {
    localEnv = parseEnvContent(await readFile(envFilePath, "utf8"));
    localSource = DEFAULT_ENV_TARGET;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const merged = { ...localEnv, ...env };
  const normalized = normalizeUrl(merged.PUBLIC_MCP_ORIGIN);
  const configured = Boolean(normalized && normalized.startsWith("https://") && !isLocalOrigin(normalized));
  return {
    configured,
    origin: configured ? normalized : normalized ?? null,
    source: configured && env.PUBLIC_MCP_ORIGIN ? "environment" : configured ? localSource : "missing",
    missing: configured ? [] : ["PUBLIC_MCP_ORIGIN"],
    reason: normalized && !configured ? "PUBLIC_MCP_ORIGIN must be an HTTPS non-localhost origin." : configured ? "ready" : "PUBLIC_MCP_ORIGIN is not configured."
  };
}

export async function writeChatGptAccountVerification({
  verified,
  envFilePath = path.join(process.cwd(), DEFAULT_ENV_TARGET)
} = {}) {
  if (typeof verified !== "boolean") {
    throw new Error("verified must be a boolean.");
  }

  let content = "";
  try {
    content = await readFile(envFilePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const nextContent = upsertEnvValue(content, CHATGPT_ACCOUNT_FLAG, verified ? "true" : "false");
  await mkdir(path.dirname(envFilePath), { recursive: true });
  await writeFile(envFilePath, nextContent, "utf8");
  return {
    configured: verified,
    source: DEFAULT_ENV_TARGET
  };
}

export async function readLaunchConfig({ env = process.env, envFilePath = path.join(process.cwd(), DEFAULT_ENV_TARGET) } = {}) {
  const localEnv = await readLocalEnv(envFilePath);
  const merged = { ...localEnv, ...env };
  const publicOrigin = await readPublicMcpOriginPresence({ env, envFilePath });
  const oauthProvider = await readChatGptOAuthProviderPresence({ env, envFilePath });
  const appRegistration = await readChatGptAppRegistrationPresence({ env, envFilePath });

  return {
    public_mcp_origin: normalizeText(merged.PUBLIC_MCP_ORIGIN, ""),
    oauth_issuer: normalizeText(merged.CHATGPT_OAUTH_ISSUER, ""),
    oauth_jwks_uri: normalizeText(merged.CHATGPT_OAUTH_JWKS_URI, ""),
    oauth_authorize_url: normalizeText(merged.CHATGPT_OAUTH_AUTHORIZE_URL, ""),
    oauth_token_url: normalizeText(merged.CHATGPT_OAUTH_TOKEN_URL, ""),
    oauth_register_url: normalizeText(merged.CHATGPT_OAUTH_REGISTER_URL, ""),
    oauth_metadata_url: normalizeText(merged.CHATGPT_OAUTH_METADATA_URL, ""),
    oauth_audience: normalizeText(merged.CHATGPT_OAUTH_AUDIENCE, ""),
    chatgpt_app_registered: appRegistration.configured,
    status: {
      public_mcp_origin_configured: publicOrigin.configured,
      production_oauth_configured: oauthProvider.configured,
      chatgpt_app_registered: appRegistration.configured,
      missing: [
        publicOrigin.configured ? null : "PUBLIC_MCP_ORIGIN",
        oauthProvider.configured ? null : "CHATGPT_OAUTH_ISSUER/CHATGPT_OAUTH_JWKS_URI",
        appRegistration.configured ? null : CHATGPT_APP_REGISTERED_FLAG
      ].filter(Boolean)
    }
  };
}

export async function writeLaunchConfig({ config = {}, envFilePath = path.join(process.cwd(), DEFAULT_ENV_TARGET) } = {}) {
  const normalized = normalizeLaunchConfig(config);
  const errors = validateLaunchConfig(normalized);
  if (errors.length > 0) {
    const error = new Error(errors.join(" "));
    error.code = "INVALID_LAUNCH_CONFIG";
    error.validation = errors;
    throw error;
  }

  let content = "";
  try {
    content = await readFile(envFilePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const envValues = {
    PUBLIC_MCP_ORIGIN: normalized.public_mcp_origin,
    CHATGPT_OAUTH_ISSUER: normalized.oauth_issuer,
    CHATGPT_OAUTH_JWKS_URI: normalized.oauth_jwks_uri,
    CHATGPT_OAUTH_AUTHORIZE_URL: normalized.oauth_authorize_url,
    CHATGPT_OAUTH_TOKEN_URL: normalized.oauth_token_url,
    CHATGPT_OAUTH_REGISTER_URL: normalized.oauth_register_url,
    CHATGPT_OAUTH_METADATA_URL: normalized.oauth_metadata_url,
    CHATGPT_OAUTH_AUDIENCE: normalized.oauth_audience,
    [CHATGPT_APP_REGISTERED_FLAG]: normalized.chatgpt_app_registered ? "true" : "false"
  };

  let nextContent = content;
  for (const key of LAUNCH_CONFIG_KEYS) {
    nextContent = upsertEnvValue(nextContent, key, envValues[key] ?? "");
  }

  await mkdir(path.dirname(envFilePath), { recursive: true });
  await writeFile(envFilePath, nextContent, "utf8");
  return readLaunchConfig({ env: {}, envFilePath });
}

export function applyLaunchConfigToEnv(config = {}, env = process.env) {
  const normalized = normalizeLaunchConfig(config);
  const envValues = {
    PUBLIC_MCP_ORIGIN: normalized.public_mcp_origin,
    CHATGPT_OAUTH_ISSUER: normalized.oauth_issuer,
    CHATGPT_OAUTH_JWKS_URI: normalized.oauth_jwks_uri,
    CHATGPT_OAUTH_AUTHORIZE_URL: normalized.oauth_authorize_url,
    CHATGPT_OAUTH_TOKEN_URL: normalized.oauth_token_url,
    CHATGPT_OAUTH_REGISTER_URL: normalized.oauth_register_url,
    CHATGPT_OAUTH_METADATA_URL: normalized.oauth_metadata_url,
    CHATGPT_OAUTH_AUDIENCE: normalized.oauth_audience,
    [CHATGPT_APP_REGISTERED_FLAG]: normalized.chatgpt_app_registered ? "true" : "false"
  };

  for (const key of LAUNCH_CONFIG_KEYS) {
    const value = envValues[key] ?? "";
    if (value) {
      env[key] = value;
    } else {
      delete env[key];
    }
  }

  return {
    keys: LAUNCH_CONFIG_KEYS.filter((key) => Boolean(envValues[key])),
    values: envValues
  };
}

export function createProviderReadiness({
  openAiConfigured = false,
  openAiSource = "missing",
  chatGptAccountVerified = false,
  chatGptAccountSource = "missing",
  localLlmConfigured = false,
  localLlmSource = "missing",
  localLlmModel = process.env.OLLAMA_MODEL || "qwen3.6:latest",
  oauthProvider = { configured: false, mode: "development", issuer: "local-dev", jwks_uri: null, source: "local-dev", missing: ["CHATGPT_OAUTH_ISSUER", "CHATGPT_OAUTH_JWKS_URI"] },
  videoProvider = "local-ffmpeg"
} = {}) {
  const directorStatus = openAiConfigured ? "ready" : "needs_key";
  const accountDirectorStatus = chatGptAccountVerified ? "ready" : "needs_auth";
  const localLlmStatus = localLlmConfigured ? "ready" : "needs_auth";
  const localVideoProvider = videoProvider === "local-ffmpeg" || videoProvider === "mock";
  const openAiVideoProvider = videoProvider === "openai-video";
  const videoStatus = localVideoProvider ? "ready" : openAiVideoProvider ? directorStatus : "adapter_required";
  const videoProviderLabel = localVideoProvider
    ? "Local FFmpeg renderer"
    : openAiVideoProvider
      ? "OpenAI Videos API"
      : videoProvider;

  return {
    recommended_mode: localLlmConfigured ? "local-llm" : chatGptAccountVerified ? "chatgpt-account" : "local-production",
    api_key: {
      env_name: "OPENAI_API_KEY",
      local_target: DEFAULT_ENV_TARGET,
      configured: openAiConfigured,
      source: openAiSource
    },
    local_llm: {
      env_name: "OLLAMA_MODEL",
      local_target: DEFAULT_ENV_TARGET,
      configured: localLlmConfigured,
      source: localLlmSource,
      model: localLlmModel,
      base_url: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"
    },
    account_auth: {
      env_name: CHATGPT_ACCOUNT_FLAG,
      local_target: DEFAULT_ENV_TARGET,
      configured: chatGptAccountVerified,
      source: chatGptAccountSource,
      method: "ChatGPT Apps OAuth 2.1"
    },
    oauth_provider: {
      mode: oauthProvider.mode,
      production_configured: oauthProvider.configured,
      issuer: oauthProvider.issuer,
      jwks_uri: oauthProvider.jwks_uri,
      source: oauthProvider.source,
      missing: oauthProvider.missing
    },
    mcp_app: {
      configured: true,
      endpoint: MCP_ENDPOINT_PATH,
      app_manifest: CHATGPT_APP_MANIFEST_PATH,
      oauth_protected_resource: OAUTH_PROTECTED_RESOURCE_PATH,
      oauth_authorization_server: OAUTH_AUTHORIZATION_SERVER_METADATA_PATH,
      oauth_authorize: OAUTH_AUTHORIZE_PATH,
      oauth_token: OAUTH_TOKEN_PATH,
      oauth_register: OAUTH_REGISTER_PATH,
      auth_required: true,
      scopes: CHATGPT_APP_SCOPES
    },
    steps: [
      {
        id: "chatgpt-mcp-app",
        label: "ChatGPT MCP App",
        provider: "Local MCP connector",
        role: "ChatGPT Apps tool surface with OAuth protected-resource metadata and PKCE token exchange",
        status: "ready"
      },
      {
        id: "production-oauth-verifier",
        label: "Production OAuth",
        provider: oauthProvider.configured ? "External OAuth/OIDC JWKS verifier" : "Local development OAuth issuer",
        role: "Verifies ChatGPT Apps account-auth Bearer tokens without using an OpenAI API key",
        status: oauthProvider.configured ? "ready" : "needs_auth"
      },
      {
        id: "chatgpt-account",
        label: "ChatGPT Account",
        provider: chatGptAccountVerified ? "Verified ChatGPT account" : "Account verification pending",
        role: "Account-auth route for ChatGPT Apps / MCP OAuth integration",
        status: accountDirectorStatus
      },
      {
        id: "llm-director",
        label: "LLM Director",
        provider: localLlmConfigured ? `Ollama ${localLlmModel}` : chatGptAccountVerified ? "ChatGPT account-auth director" : openAiConfigured ? "OpenAI Responses API" : "Local content generator",
        role: "VideoRecipe, scripts, shot prompts, captions, hashtags",
        status: localLlmConfigured ? localLlmStatus : chatGptAccountVerified ? accountDirectorStatus : openAiConfigured ? directorStatus : "ready"
      },
      {
        id: "image-generator",
        label: "Shot Images",
        provider: chatGptAccountVerified ? "Image 2 account-auth handoff" : openAiConfigured ? "OpenAI Image API" : "Local shot prompt builder",
        role: "9:16 reference-safe stills for every shot",
        status: chatGptAccountVerified ? accountDirectorStatus : openAiConfigured ? directorStatus : "ready"
      },
      {
        id: "video-generator",
        label: "Image-to-Video",
        provider: videoProviderLabel,
        role: "Playable MP4 files from generated content and captions",
        status: videoStatus
      },
      {
        id: "voiceover",
        label: "Voiceover",
        provider: openAiConfigured ? "OpenAI TTS" : "Local voiceover script",
        role: "Narration audio from episode voiceover lines",
        status: openAiConfigured ? directorStatus : "ready"
      },
      {
        id: "packager",
        label: "Packager",
        provider: "Local FFmpeg",
        role: "Captions, audio, clips, and metadata assembled into MP4",
        status: "ready"
      }
    ]
  };
}

export async function resolveProviderReadiness(options = {}) {
  const keyPresence = await readOpenAiKeyPresence(options);
  const accountPresence = await readChatGptAccountPresence(options);
  const oauthProvider = await readChatGptOAuthProviderPresence(options);
  return createProviderReadiness({
    openAiConfigured: keyPresence.configured,
    openAiSource: keyPresence.source,
    chatGptAccountVerified: accountPresence.configured,
    chatGptAccountSource: accountPresence.source,
    oauthProvider,
    videoProvider: options.videoProvider ?? process.env.VIDEO_PROVIDER ?? "local-ffmpeg"
  });
}

function hasUsableKey(value) {
  return typeof value === "string" && value.trim().length > 12;
}

function isEnabled(value) {
  return ["1", "true", "yes", "verified"].includes(String(value ?? "").trim().toLowerCase());
}

function normalizeUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return new URL(value.trim()).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function readLocalEnv(envFilePath) {
  try {
    return parseEnvContent(await readFile(envFilePath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {};
  }
}

function normalizeLaunchConfig(config) {
  const publicMcpOrigin = normalizeLaunchUrl(config.public_mcp_origin ?? config.publicMcpOrigin);
  const oauthIssuer = normalizeLaunchUrl(config.oauth_issuer ?? config.oauthIssuer);
  const oauthJwksUri = normalizeLaunchUrl(config.oauth_jwks_uri ?? config.oauthJwksUri);
  const oauthAuthorizeUrl = normalizeLaunchUrl(config.oauth_authorize_url ?? config.oauthAuthorizeUrl);
  const oauthTokenUrl = normalizeLaunchUrl(config.oauth_token_url ?? config.oauthTokenUrl);
  const oauthRegisterUrl = normalizeLaunchUrl(config.oauth_register_url ?? config.oauthRegisterUrl);
  const oauthMetadataUrl = normalizeLaunchUrl(config.oauth_metadata_url ?? config.oauthMetadataUrl);
  const oauthAudience = normalizeLaunchUrl(config.oauth_audience ?? config.oauthAudience);

  return {
    public_mcp_origin: publicMcpOrigin.value,
    oauth_issuer: oauthIssuer.value,
    oauth_jwks_uri: oauthJwksUri.value,
    oauth_authorize_url: oauthAuthorizeUrl.value,
    oauth_token_url: oauthTokenUrl.value,
    oauth_register_url: oauthRegisterUrl.value,
    oauth_metadata_url: oauthMetadataUrl.value,
    oauth_audience: oauthAudience.value,
    chatgpt_app_registered: Boolean(config.chatgpt_app_registered ?? config.chatGptAppRegistered),
    invalid_url_fields: [
      publicMcpOrigin.invalid ? "PUBLIC_MCP_ORIGIN" : null,
      oauthIssuer.invalid ? "CHATGPT_OAUTH_ISSUER" : null,
      oauthJwksUri.invalid ? "CHATGPT_OAUTH_JWKS_URI" : null,
      oauthAuthorizeUrl.invalid ? "CHATGPT_OAUTH_AUTHORIZE_URL" : null,
      oauthTokenUrl.invalid ? "CHATGPT_OAUTH_TOKEN_URL" : null,
      oauthRegisterUrl.invalid ? "CHATGPT_OAUTH_REGISTER_URL" : null,
      oauthMetadataUrl.invalid ? "CHATGPT_OAUTH_METADATA_URL" : null,
      oauthAudience.invalid ? "CHATGPT_OAUTH_AUDIENCE" : null
    ].filter(Boolean)
  };
}

function validateLaunchConfig(config) {
  const errors = [];
  for (const key of config.invalid_url_fields ?? []) {
    errors.push(`${key} must be a valid URL.`);
  }
  const publicFields = [
    ["PUBLIC_MCP_ORIGIN", config.public_mcp_origin],
    ["CHATGPT_OAUTH_ISSUER", config.oauth_issuer],
    ["CHATGPT_OAUTH_JWKS_URI", config.oauth_jwks_uri],
    ["CHATGPT_OAUTH_AUTHORIZE_URL", config.oauth_authorize_url],
    ["CHATGPT_OAUTH_TOKEN_URL", config.oauth_token_url],
    ["CHATGPT_OAUTH_REGISTER_URL", config.oauth_register_url],
    ["CHATGPT_OAUTH_METADATA_URL", config.oauth_metadata_url],
    ["CHATGPT_OAUTH_AUDIENCE", config.oauth_audience]
  ];

  for (const [key, value] of publicFields) {
    if (!value) continue;
    if (!value.startsWith("https://") || isLocalOrigin(value)) {
      errors.push(`${key} must be a public HTTPS URL.`);
    }
  }

  if ((config.oauth_issuer && !config.oauth_jwks_uri) || (!config.oauth_issuer && config.oauth_jwks_uri)) {
    errors.push("CHATGPT_OAUTH_ISSUER and CHATGPT_OAUTH_JWKS_URI must be saved together.");
  }

  if (config.chatgpt_app_registered && (!config.public_mcp_origin || !config.oauth_issuer || !config.oauth_jwks_uri)) {
    errors.push("CHATGPT_APP_REGISTERED requires PUBLIC_MCP_ORIGIN, CHATGPT_OAUTH_ISSUER, and CHATGPT_OAUTH_JWKS_URI.");
  }

  return errors;
}

function normalizeLaunchUrl(value) {
  if (typeof value !== "string" || !value.trim()) return { value: "", invalid: false };
  const normalized = normalizeUrl(value);
  return normalized ? { value: normalized, invalid: false } : { value: value.trim(), invalid: true };
}

function normalizeText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isLocalOrigin(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return ["localhost", "127.0.0.1", "::1"].includes(hostname) || hostname.endsWith(".local");
  } catch {
    return false;
  }
}

function upsertEnvValue(content, key, value) {
  const lines = content ? content.split(/\r?\n/) : [];
  let replaced = false;
  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return line;
    const index = trimmed.indexOf("=");
    if (trimmed.slice(0, index).trim() !== key) return line;
    replaced = true;
    return `${key}=${value}`;
  });

  if (!replaced) {
    if (nextLines.length && nextLines.at(-1) !== "") nextLines.push("");
    nextLines.push(`${key}=${value}`);
  }

  return `${nextLines.join("\n").replace(/\n*$/, "")}\n`;
}
