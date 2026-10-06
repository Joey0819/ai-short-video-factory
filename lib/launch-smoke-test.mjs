import {
  CHATGPT_APP_MANIFEST_PATH,
  CHATGPT_APP_RESOURCE_URI,
  CHATGPT_MCP_TOOL_NAMES,
  MCP_ENDPOINT_PATH,
  OAUTH_PROTECTED_RESOURCE_PATH
} from "./chatgpt-app-constants.mjs";
import { readLaunchConfig } from "./provider-plan.mjs";

const SMOKE_TIMEOUT_MS = 8000;

export async function resolveLaunchSmokeTest({ rootDir = process.cwd(), baseUrl = "http://127.0.0.1:3030" } = {}) {
  const launchConfig = await readLaunchConfig({ envFilePath: `${rootDir}/.env.local` });
  const local = await smokeTarget({
    origin: normalizeOrigin(baseUrl),
    id: "local-contract",
    label: "Local MCP contract",
    required: true
  });
  const publicOrigin = launchConfig.status.public_mcp_origin_configured ? launchConfig.public_mcp_origin : "";
  const publicContract = publicOrigin
    ? await smokeTarget({
      origin: publicOrigin,
      id: "public-contract",
      label: "Public MCP contract",
      required: true
    })
    : buildSkippedTarget({
      id: "public-contract",
      label: "Public MCP contract",
      origin: "",
      summary: "PUBLIC_MCP_ORIGIN is not configured."
    });
  const oauthProvider = launchConfig.status.production_oauth_configured
    ? await smokeOAuthProvider({ launchConfig })
    : buildSkippedTarget({
      id: "oauth-provider",
      label: "Managed OAuth provider",
      origin: "",
      summary: "CHATGPT_OAUTH_ISSUER and CHATGPT_OAUTH_JWKS_URI are not configured."
    });

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    local_contract_ready: local.ready,
    public_contract_ready: publicContract.ready,
    oauth_provider_ready: oauthProvider.ready,
    smoke_ready: local.ready && publicContract.ready && oauthProvider.ready,
    recommended_provider: "chatgpt-account",
    auth_method: "ChatGPT Apps OAuth 2.1 / MCP",
    image_model: "gpt-image-2",
    uses_image_api_key: false,
    targets: [local, publicContract, oauthProvider],
    blockers: [
      ...local.checks,
      ...publicContract.checks,
      ...oauthProvider.checks
    ]
      .filter((check) => check.required && check.status !== "pass")
      .map((check) => check.summary)
  };
}

async function smokeTarget({ origin, id, label, required }) {
  const checks = [];
  let manifest = null;
  let metadata = null;
  let toolsList = null;
  let widget = null;

  try {
    manifest = await fetchJson(`${origin}${CHATGPT_APP_MANIFEST_PATH}`);
  } catch (error) {
    checks.push(buildCheck({ id: `${id}-manifest`, label: "App manifest", required, passed: false, summary: `Cannot load app manifest: ${error.message}` }));
  }

  if (manifest) {
    checks.push(buildCheck({
      id: `${id}-manifest`,
      label: "App manifest",
      required,
      passed: manifest.ok === true && manifest.app?.mcp_endpoint === `${origin}${MCP_ENDPOINT_PATH}`,
      summary: manifest.ok === true ? "ChatGPT app manifest is reachable." : "ChatGPT app manifest did not return ok=true."
    }));
    checks.push(buildCheck({
      id: `${id}-image2-auth`,
      label: "Image 2 account auth",
      required,
      passed: manifest.app?.image2?.model === "gpt-image-2" && manifest.app?.image2?.uses_api_key === false && manifest.app?.uses_api_key_for_image2 === false,
      summary: "Manifest must declare gpt-image-2 through account auth without API-key usage."
    }));
    checks.push(buildCheck({
      id: `${id}-tool-names`,
      label: "Tool inventory",
      required,
      passed: CHATGPT_MCP_TOOL_NAMES.every((toolName) => manifest.app?.tools?.some((tool) => tool.name === toolName)),
      summary: "Manifest must expose the expected short-video and Image 2 handoff tools."
    }));
  }

  try {
    metadata = await fetchJson(`${origin}${OAUTH_PROTECTED_RESOURCE_PATH}`);
  } catch (error) {
    checks.push(buildCheck({ id: `${id}-oauth-resource`, label: "OAuth resource metadata", required, passed: false, summary: `Cannot load OAuth protected-resource metadata: ${error.message}` }));
  }

  if (metadata) {
    checks.push(buildCheck({
      id: `${id}-oauth-resource`,
      label: "OAuth resource metadata",
      required,
      passed: metadata.resource === `${origin}${MCP_ENDPOINT_PATH}` && Array.isArray(metadata.authorization_servers) && metadata.authorization_servers.length > 0,
      summary: "OAuth protected-resource metadata must point to this MCP endpoint and list an authorization server."
    }));
    checks.push(buildCheck({
      id: `${id}-oauth-scopes`,
      label: "OAuth scopes",
      required,
      passed: Array.isArray(metadata.scopes_supported) && metadata.scopes_supported.includes("shortvideo:write") && metadata.scopes_supported.includes("image2:handoff"),
      summary: "OAuth metadata must expose shortvideo:write and image2:handoff scopes."
    }));
  }

  try {
    await postMcp(origin, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    checks.push(buildCheck({ id: `${id}-mcp-initialize`, label: "MCP initialize", required, passed: true, summary: "MCP initialize returned a valid response." }));
  } catch (error) {
    checks.push(buildCheck({ id: `${id}-mcp-initialize`, label: "MCP initialize", required, passed: false, summary: `MCP initialize failed: ${error.message}` }));
  }

  try {
    toolsList = await postMcp(origin, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  } catch (error) {
    checks.push(buildCheck({ id: `${id}-tools-list`, label: "MCP tools/list", required, passed: false, summary: `MCP tools/list failed: ${error.message}` }));
  }

  if (toolsList) {
    const tools = toolsList.result?.tools ?? [];
    const readinessTool = tools.find((tool) => tool.name === "get_product_readiness");
    const produceTool = tools.find((tool) => tool.name === "produce_short_video");
    const image2Tool = tools.find((tool) => tool.name === "get_image2_handoff");
    const attachImage2Tool = tools.find((tool) => tool.name === "attach_image2_assets");
    checks.push(buildCheck({
      id: `${id}-tools-list`,
      label: "MCP tools/list",
      required,
      passed: CHATGPT_MCP_TOOL_NAMES.every((toolName) => tools.some((tool) => tool.name === toolName)),
      summary: "MCP tools/list must return all expected tool descriptors."
    }));
    checks.push(buildCheck({
      id: `${id}-tool-security`,
      label: "Tool auth scopes",
      required,
      passed:
        readinessTool?.securitySchemes?.[0]?.type === "noauth" &&
        arrayEquals(produceTool?.securitySchemes?.[0]?.scopes, ["shortvideo:write", "image2:handoff"]) &&
        arrayEquals(image2Tool?.securitySchemes?.[0]?.scopes, ["image2:handoff"]) &&
        arrayEquals(attachImage2Tool?.securitySchemes?.[0]?.scopes, ["shortvideo:write", "image2:handoff"]),
      summary: "Readiness must be noauth; production and Image 2 asset intake must require video write plus Image 2 handoff; handoff read must require Image 2 scope."
    }));
  }

  try {
    widget = await postMcp(origin, {
      jsonrpc: "2.0",
      id: 3,
      method: "resources/read",
      params: { uri: CHATGPT_APP_RESOURCE_URI }
    });
  } catch (error) {
    checks.push(buildCheck({ id: `${id}-widget-resource`, label: "Widget resource", required, passed: false, summary: `Widget resource failed: ${error.message}` }));
  }

  if (widget) {
    const content = widget.result?.contents?.[0];
    checks.push(buildCheck({
      id: `${id}-widget-resource`,
      label: "Widget resource",
      required,
      passed: content?.uri === CHATGPT_APP_RESOURCE_URI && content?.mimeType === "text/html;profile=mcp-app" && content?._meta?.ui?.csp,
      summary: "Widget resource must use the MCP app MIME type and include UI CSP metadata."
    }));
  }

  return {
    id,
    label,
    origin,
    status: checks.every((check) => check.status === "pass") ? "pass" : "fail",
    ready: checks.every((check) => check.status === "pass"),
    checks
  };
}

async function smokeOAuthProvider({ launchConfig }) {
  const issuer = normalizeOrigin(launchConfig.oauth_issuer);
  const jwksUri = launchConfig.oauth_jwks_uri;
  const metadataUrl = launchConfig.oauth_metadata_url || `${issuer}/.well-known/oauth-authorization-server`;
  const checks = [];
  let metadata = null;
  let jwks = null;

  checks.push(buildCheck({
    id: "oauth-provider-public-urls",
    label: "OAuth public URLs",
    required: true,
    passed: isPublicHttpsUrl(issuer) && isPublicHttpsUrl(jwksUri) && isPublicHttpsUrl(metadataUrl),
    summary: "OAuth issuer, metadata, and JWKS URLs must be public HTTPS URLs."
  }));

  try {
    metadata = await fetchJson(metadataUrl);
  } catch (error) {
    checks.push(buildCheck({
      id: "oauth-provider-metadata",
      label: "Authorization server metadata",
      required: true,
      passed: false,
      summary: `Cannot load authorization-server metadata: ${error.message}`
    }));
  }

  if (metadata) {
    checks.push(buildCheck({
      id: "oauth-provider-metadata",
      label: "Authorization server metadata",
      required: true,
      passed:
        metadata.issuer === issuer &&
        isPublicHttpsUrl(metadata.authorization_endpoint) &&
        isPublicHttpsUrl(metadata.token_endpoint) &&
        Array.isArray(metadata.response_types_supported) &&
        metadata.response_types_supported.includes("code") &&
        Array.isArray(metadata.grant_types_supported) &&
        metadata.grant_types_supported.includes("authorization_code"),
      summary: "OAuth metadata must match the issuer and expose authorization-code endpoints."
    }));
    checks.push(buildCheck({
      id: "oauth-provider-scopes",
      label: "OAuth provider scopes",
      required: true,
      passed:
        Array.isArray(metadata.scopes_supported) &&
        metadata.scopes_supported.includes("shortvideo:write") &&
        metadata.scopes_supported.includes("image2:handoff"),
      summary: "Authorization-server metadata must expose shortvideo:write and image2:handoff scopes."
    }));
    checks.push(buildCheck({
      id: "oauth-provider-jwks-link",
      label: "JWKS metadata link",
      required: true,
      passed: !metadata.jwks_uri || normalizeOrigin(metadata.jwks_uri) === normalizeOrigin(jwksUri),
      summary: "Authorization-server metadata JWKS URI must match CHATGPT_OAUTH_JWKS_URI when present."
    }));
  }

  try {
    jwks = await fetchJson(jwksUri);
  } catch (error) {
    checks.push(buildCheck({
      id: "oauth-provider-jwks",
      label: "JWKS",
      required: true,
      passed: false,
      summary: `Cannot load OAuth JWKS: ${error.message}`
    }));
  }

  if (jwks) {
    checks.push(buildCheck({
      id: "oauth-provider-jwks",
      label: "JWKS",
      required: true,
      passed: Array.isArray(jwks.keys) && jwks.keys.some(isUsableRs256Jwk),
      summary: "JWKS must expose at least one RSA signing key usable for RS256 token verification."
    }));
  }

  return {
    id: "oauth-provider",
    label: "Managed OAuth provider",
    origin: issuer,
    status: checks.every((check) => check.status === "pass") ? "pass" : "fail",
    ready: checks.every((check) => check.status === "pass"),
    checks
  };
}

function buildSkippedTarget({ id, label, origin, summary }) {
  return {
    id,
    label,
    origin,
    status: "skip",
    ready: false,
    checks: [
      {
        id: `${id}-configured`,
        label,
        status: "skip",
        required: true,
        summary
      }
    ]
  };
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url, {
    headers: { Accept: "application/json" }
  });
  return parseJsonResponse(response, url);
}

async function postMcp(origin, message) {
  const response = await fetchWithTimeout(`${origin}${MCP_ENDPOINT_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(message)
  });
  const payload = await parseJsonResponse(response, `${origin}${MCP_ENDPOINT_PATH}`);
  if (payload.error) {
    throw new Error(payload.error.message ?? "MCP returned an error response.");
  }
  return payload;
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SMOKE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function parseJsonResponse(response, url) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${url} did not return valid JSON`);
  }
}

function buildCheck({ id, label, required, passed, summary }) {
  return {
    id,
    label,
    status: passed ? "pass" : "fail",
    required: Boolean(required),
    summary
  };
}

function normalizeOrigin(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function isPublicHttpsUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(hostname) && !hostname.endsWith(".local");
  } catch {
    return false;
  }
}

function isUsableRs256Jwk(key) {
  return (
    key &&
    key.kty === "RSA" &&
    typeof key.kid === "string" &&
    typeof key.n === "string" &&
    typeof key.e === "string" &&
    (!key.use || key.use === "sig") &&
    (!key.alg || key.alg === "RS256")
  );
}

function arrayEquals(left, right) {
  if (!Array.isArray(left) || left.length !== right.length) return false;
  return right.every((value, index) => left[index] === value);
}
