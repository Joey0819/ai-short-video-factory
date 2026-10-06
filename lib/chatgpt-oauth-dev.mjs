import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CHATGPT_APP_SCOPES,
  MCP_ENDPOINT_PATH,
  OAUTH_AUTHORIZATION_SERVER_METADATA_PATH,
  OAUTH_AUTHORIZE_PATH,
  OAUTH_ISSUER_PATH,
  OAUTH_PROTECTED_RESOURCE_PATH,
  OAUTH_REGISTER_PATH,
  OAUTH_TOKEN_PATH
} from "./chatgpt-app-constants.mjs";
import { DEFAULT_ENV_TARGET, parseEnvContent, readChatGptAccountPresence } from "./provider-plan.mjs";

const authorizationCodes = new Map();
const jwksCache = new Map();
const AUTHORIZATION_CODE_TTL_SECONDS = 300;
const ACCESS_TOKEN_TTL_SECONDS = 3600;
const JWKS_CACHE_TTL_SECONDS = 300;
const DEFAULT_DEV_SECRET = "ai-short-video-factory-local-oauth-dev-secret";
const SUPPORTED_PRODUCTION_ALGS = ["RS256"];

export function buildOAuthAuthorizationServerMetadata({ baseUrl = "http://127.0.0.1:3030" } = {}) {
  return {
    issuer: getOAuthIssuerUrl({ baseUrl }),
    authorization_endpoint: `${baseUrl}${OAUTH_AUTHORIZE_PATH}`,
    token_endpoint: `${baseUrl}${OAUTH_TOKEN_PATH}`,
    registration_endpoint: `${baseUrl}${OAUTH_REGISTER_PATH}`,
    jwks_uri: null,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
    scopes_supported: CHATGPT_APP_SCOPES,
    resource_documentation: `${baseUrl}/api/chatgpt/app-manifest`,
    protected_resource_metadata: `${baseUrl}${OAUTH_PROTECTED_RESOURCE_PATH}`,
    mcp_server: `${baseUrl}${MCP_ENDPOINT_PATH}`,
    development_only: true
  };
}

export async function readOAuthRuntimeEnv({ env = process.env, rootDir = process.cwd(), envFilePath = path.join(rootDir, DEFAULT_ENV_TARGET) } = {}) {
  let fileEnv = {};
  try {
    fileEnv = parseEnvContent(await readFile(envFilePath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { ...fileEnv, ...env };
}

export function resolveOAuthRuntimeConfig({ baseUrl = "http://127.0.0.1:3030", env = process.env } = {}) {
  const issuer = normalizeUrl(env.CHATGPT_OAUTH_ISSUER);
  const jwksUri = normalizeUrl(env.CHATGPT_OAUTH_JWKS_URI);
  const productionConfigured = Boolean(issuer && jwksUri);
  const developmentIssuer = getOAuthIssuerUrl({ baseUrl });
  const runtimeIssuer = productionConfigured ? issuer : developmentIssuer;

  return {
    mode: productionConfigured ? "production" : "development",
    production_configured: productionConfigured,
    issuer: runtimeIssuer,
    authorization_endpoint: normalizeUrl(env.CHATGPT_OAUTH_AUTHORIZE_URL) ?? (productionConfigured ? `${issuer}/authorize` : `${baseUrl}${OAUTH_AUTHORIZE_PATH}`),
    token_endpoint: normalizeUrl(env.CHATGPT_OAUTH_TOKEN_URL) ?? (productionConfigured ? `${issuer}/token` : `${baseUrl}${OAUTH_TOKEN_PATH}`),
    registration_endpoint: normalizeUrl(env.CHATGPT_OAUTH_REGISTER_URL) ?? (productionConfigured ? `${issuer}/register` : `${baseUrl}${OAUTH_REGISTER_PATH}`),
    authorization_server_metadata: normalizeUrl(env.CHATGPT_OAUTH_METADATA_URL) ?? (productionConfigured ? `${issuer}/.well-known/oauth-authorization-server` : `${baseUrl}${OAUTH_AUTHORIZATION_SERVER_METADATA_PATH}`),
    jwks_uri: jwksUri,
    audience: normalizeText(env.CHATGPT_OAUTH_AUDIENCE, `${baseUrl}${MCP_ENDPOINT_PATH}`),
    resource: `${baseUrl}${MCP_ENDPOINT_PATH}`,
    supported_algs: productionConfigured ? SUPPORTED_PRODUCTION_ALGS : ["HS256"],
    token_endpoint_auth_methods_supported: productionConfigured ? ["client_secret_basic", "client_secret_post", "none"] : ["none"]
  };
}

export function createOAuthClientRegistration({ body = {}, baseUrl = "http://127.0.0.1:3030" } = {}) {
  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((uri) => typeof uri === "string" && isValidUrl(uri))
    : [];
  const requestedScopes = normalizeScopes(body.scope).filter((scope) => CHATGPT_APP_SCOPES.includes(scope));
  const clientId = normalizeText(body.client_id, "") || normalizeText(body.client_uri, "") || `${baseUrl}${OAUTH_ISSUER_PATH}/clients/${randomToken(12)}`;

  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: normalizeText(body.client_name, "ChatGPT"),
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
    scope: (requestedScopes.length ? requestedScopes : CHATGPT_APP_SCOPES).join(" "),
    application_type: "web"
  };
}

export async function createAuthorizationRedirect({
  url,
  baseUrl = "http://127.0.0.1:3030",
  rootDir = process.cwd()
} = {}) {
  const params = url?.searchParams;
  if (!params) {
    return buildAuthorizationError(400, "invalid_request", "Missing authorization request parameters.");
  }

  const responseType = params.get("response_type");
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const codeChallenge = params.get("code_challenge");
  const codeChallengeMethod = params.get("code_challenge_method");
  const state = params.get("state");
  const resource = params.get("resource") || `${baseUrl}${MCP_ENDPOINT_PATH}`;
  const requestedScopes = normalizeScopes(params.get("scope"));
  const scopes = requestedScopes.length ? requestedScopes : CHATGPT_APP_SCOPES;

  if (responseType !== "code") {
    return buildAuthorizationError(400, "unsupported_response_type", "Only authorization code flow is supported.");
  }
  if (!clientId || !redirectUri || !isValidUrl(redirectUri)) {
    return buildAuthorizationError(400, "invalid_request", "A client_id and valid redirect_uri are required.");
  }
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return buildAuthorizationError(400, "invalid_request", "PKCE S256 code_challenge is required.");
  }
  if (resource !== `${baseUrl}${MCP_ENDPOINT_PATH}`) {
    return buildAuthorizationError(400, "invalid_target", "The requested resource does not match this MCP server.");
  }
  const unsupportedScope = scopes.find((scope) => !CHATGPT_APP_SCOPES.includes(scope));
  if (unsupportedScope) {
    return buildAuthorizationError(400, "invalid_scope", `Unsupported scope: ${unsupportedScope}.`);
  }

  const accountPresence = await readChatGptAccountPresence({
    envFilePath: path.join(rootDir, ".env.local")
  });
  if (!accountPresence.configured) {
    return buildAuthorizationError(403, "access_denied", "Save ChatGPT account verification before authorizing this local MCP app.");
  }

  const now = Math.floor(Date.now() / 1000);
  const code = randomToken(32);
  authorizationCodes.set(code, {
    clientId,
    redirectUri,
    codeChallenge,
    resource,
    scope: scopes,
    issuedAt: now,
    expiresAt: now + AUTHORIZATION_CODE_TTL_SECONDS
  });

  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  if (state) redirect.searchParams.set("state", state);

  return {
    statusCode: 302,
    headers: {
      Location: redirect.toString(),
      "Cache-Control": "no-store"
    }
  };
}

export function exchangeAuthorizationCode({
  body = {},
  baseUrl = "http://127.0.0.1:3030",
  env = process.env
} = {}) {
  const grantType = normalizeText(body.grant_type, "");
  const code = normalizeText(body.code, "");
  const redirectUri = normalizeText(body.redirect_uri, "");
  const codeVerifier = normalizeText(body.code_verifier, "");
  const clientId = normalizeText(body.client_id, "");
  const resource = normalizeText(body.resource, "") || `${baseUrl}${MCP_ENDPOINT_PATH}`;

  if (grantType !== "authorization_code") {
    return buildTokenError(400, "unsupported_grant_type", "Only authorization_code grant is supported.");
  }
  if (!code || !redirectUri || !codeVerifier) {
    return buildTokenError(400, "invalid_request", "code, redirect_uri, and code_verifier are required.");
  }

  const record = authorizationCodes.get(code);
  authorizationCodes.delete(code);
  if (!record) {
    return buildTokenError(400, "invalid_grant", "Authorization code is invalid or already used.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (record.expiresAt < now) {
    return buildTokenError(400, "invalid_grant", "Authorization code has expired.");
  }
  if (record.redirectUri !== redirectUri) {
    return buildTokenError(400, "invalid_grant", "redirect_uri does not match the authorization request.");
  }
  if (clientId && record.clientId !== clientId) {
    return buildTokenError(400, "invalid_grant", "client_id does not match the authorization request.");
  }
  if (record.resource !== resource || resource !== `${baseUrl}${MCP_ENDPOINT_PATH}`) {
    return buildTokenError(400, "invalid_target", "resource does not match the protected MCP server.");
  }
  if (toPkceS256(codeVerifier) !== record.codeChallenge) {
    return buildTokenError(400, "invalid_grant", "PKCE verifier did not match the authorization request.");
  }

  const accessToken = signAccessToken({
    payload: {
      iss: getOAuthIssuerUrl({ baseUrl }),
      aud: `${baseUrl}${MCP_ENDPOINT_PATH}`,
      resource,
      sub: "verified-chatgpt-account",
      client_id: record.clientId,
      scope: record.scope.join(" "),
      iat: now,
      nbf: now,
      exp: now + ACCESS_TOKEN_TTL_SECONDS,
      jti: randomToken(12)
    },
    env
  });

  return {
    statusCode: 200,
    body: {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: record.scope.join(" "),
      resource
    }
  };
}

export async function verifyMcpAuthorization({
  authorization = "",
  requiredScope = "",
  requiredScopes,
  baseUrl = "http://127.0.0.1:3030",
  env = process.env,
  rootDir = process.cwd()
} = {}) {
  const runtimeEnv = await readOAuthRuntimeEnv({ env, rootDir });
  const config = resolveOAuthRuntimeConfig({ baseUrl, env: runtimeEnv });
  const match = /^Bearer\s+(.+)$/i.exec(String(authorization ?? "").trim());
  if (!match) {
    return { ok: false, error: "missing_token", description: "A valid OAuth bearer token is required." };
  }

  const token = match[1];
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, error: "invalid_token", description: "Bearer token is not a valid JWT access token." };
  }

  if (config.mode === "production") {
    return verifyProductionJwtAccessToken({ token, parts, requiredScopes: normalizeRequiredScopes(requiredScopes, requiredScope), config });
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const signedInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = hmacBase64Url(signedInput, getSigningSecret(env));
  if (!timingSafeEqual(signature, expectedSignature)) {
    return { ok: false, error: "invalid_token", description: "Bearer token signature is invalid." };
  }

  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlDecode(encodedHeader).toString("utf8"));
    payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8"));
  } catch {
    return { ok: false, error: "invalid_token", description: "Bearer token payload cannot be decoded." };
  }

  if (header.alg !== "HS256" || header.typ !== "JWT") {
    return { ok: false, error: "invalid_token", description: "Bearer token algorithm is unsupported." };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Number(payload.nbf ?? 0) > now || Number(payload.exp ?? 0) <= now) {
    return { ok: false, error: "invalid_token", description: "Bearer token is not currently valid." };
  }

  const resource = `${baseUrl}${MCP_ENDPOINT_PATH}`;
  if (payload.iss !== getOAuthIssuerUrl({ baseUrl }) || payload.aud !== resource || payload.resource !== resource) {
    return { ok: false, error: "invalid_token", description: "Bearer token audience does not match this MCP server." };
  }

  const scopes = normalizeScopes(payload.scope);
  const missingScope = firstMissingScope(scopes, normalizeRequiredScopes(requiredScopes, requiredScope));
  if (missingScope) {
    return { ok: false, error: "insufficient_scope", description: `Bearer token is missing scope ${missingScope}.` };
  }

  return {
    ok: true,
    subject: normalizeText(payload.sub, ""),
    client_id: normalizeText(payload.client_id, ""),
    scopes
  };
}

async function verifyProductionJwtAccessToken({ token, parts, requiredScopes = [], config }) {
  const [encodedHeader, encodedPayload, signature] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlDecode(encodedHeader).toString("utf8"));
    payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8"));
  } catch {
    return { ok: false, error: "invalid_token", description: "Bearer token payload cannot be decoded." };
  }

  if (!SUPPORTED_PRODUCTION_ALGS.includes(header.alg)) {
    return { ok: false, error: "invalid_token", description: `Bearer token algorithm ${String(header.alg)} is not supported for production verification.` };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Number(payload.nbf ?? 0) > now || Number(payload.exp ?? 0) <= now) {
    return { ok: false, error: "invalid_token", description: "Bearer token is not currently valid." };
  }
  if (payload.iss !== config.issuer) {
    return { ok: false, error: "invalid_token", description: "Bearer token issuer does not match the configured OAuth issuer." };
  }
  if (!audienceMatches(payload.aud, config.audience) && !audienceMatches(payload.aud, config.resource)) {
    return { ok: false, error: "invalid_token", description: "Bearer token audience does not match this MCP server." };
  }
  if (payload.resource && payload.resource !== config.resource && payload.resource !== config.audience) {
    return { ok: false, error: "invalid_token", description: "Bearer token resource does not match this MCP server." };
  }

  let jwks;
  try {
    jwks = await fetchJwks(config.jwks_uri);
  } catch {
    return { ok: false, error: "invalid_token", description: "Could not load the configured OAuth JWKS." };
  }

  const key = selectJwk({ jwks, header });
  if (!key) {
    return { ok: false, error: "invalid_token", description: "Bearer token key id was not found in the configured JWKS." };
  }

  let publicKey;
  try {
    publicKey = crypto.createPublicKey({ key, format: "jwk" });
  } catch {
    return { ok: false, error: "invalid_token", description: "Configured JWKS key cannot verify this token." };
  }

  const signedInput = `${encodedHeader}.${encodedPayload}`;
  const verified = crypto.verify("RSA-SHA256", Buffer.from(signedInput), publicKey, base64UrlDecode(signature));
  if (!verified) {
    return { ok: false, error: "invalid_token", description: "Bearer token signature is invalid." };
  }

  const scopes = normalizeScopes(payload.scope ?? payload.scp);
  const missingScope = firstMissingScope(scopes, requiredScopes);
  if (missingScope) {
    return { ok: false, error: "insufficient_scope", description: `Bearer token is missing scope ${missingScope}.` };
  }

  return {
    ok: true,
    subject: normalizeText(payload.sub, ""),
    client_id: normalizeText(payload.client_id, ""),
    scopes,
    mode: "production",
    issuer: config.issuer
  };
}

async function fetchJwks(jwksUri) {
  if (!jwksUri) {
    throw new Error("JWKS URI is not configured.");
  }

  const now = Math.floor(Date.now() / 1000);
  const cached = jwksCache.get(jwksUri);
  if (cached && cached.expiresAt > now) {
    return cached.jwks;
  }

  const response = await fetch(jwksUri, {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`JWKS request failed with ${response.status}.`);
  }
  const jwks = await response.json();
  if (!Array.isArray(jwks.keys)) {
    throw new Error("JWKS response does not contain keys.");
  }

  jwksCache.set(jwksUri, {
    jwks,
    expiresAt: now + JWKS_CACHE_TTL_SECONDS
  });
  return jwks;
}

function selectJwk({ jwks, header }) {
  const keys = jwks.keys.filter((key) => key?.kty === "RSA" && (!key.alg || key.alg === header.alg));
  if (header.kid) {
    return keys.find((key) => key.kid === header.kid) ?? null;
  }
  return keys.length === 1 ? keys[0] : null;
}

function audienceMatches(audience, expected) {
  if (!expected) return false;
  if (Array.isArray(audience)) return audience.includes(expected);
  return audience === expected;
}

export function buildWwwAuthenticateChallenge({
  baseUrl = "http://127.0.0.1:3030",
  scope = "",
  error = "invalid_token",
  description = "A valid OAuth bearer token is required."
} = {}) {
  const params = [
    `resource_metadata="${escapeChallengeValue(`${baseUrl}${OAUTH_PROTECTED_RESOURCE_PATH}`)}"`,
    `scope="${escapeChallengeValue(scope)}"`,
    `error="${escapeChallengeValue(error)}"`,
    `error_description="${escapeChallengeValue(description)}"`
  ].join(", ");
  return `Bearer ${params}`;
}

export function getOAuthIssuerUrl({ baseUrl = "http://127.0.0.1:3030" } = {}) {
  return `${baseUrl}${OAUTH_ISSUER_PATH}`;
}

export function getOAuthMetadataPath() {
  return OAUTH_AUTHORIZATION_SERVER_METADATA_PATH;
}

function buildAuthorizationError(statusCode, error, description) {
  return {
    statusCode,
    error,
    description,
    html: `<!doctype html><html><head><meta charset="utf-8"><title>OAuth error</title></head><body><h1>${escapeHtml(error)}</h1><p>${escapeHtml(description)}</p></body></html>`
  };
}

function buildTokenError(statusCode, error, description) {
  return {
    statusCode,
    body: {
      error,
      error_description: description
    }
  };
}

function signAccessToken({ payload, env }) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signedInput = `${encodedHeader}.${encodedPayload}`;
  return `${signedInput}.${hmacBase64Url(signedInput, getSigningSecret(env))}`;
}

function toPkceS256(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function hmacBase64Url(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url");
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getSigningSecret(env = process.env) {
  return normalizeText(env.CHATGPT_OAUTH_DEV_SECRET, DEFAULT_DEV_SECRET);
}

function normalizeScopes(value) {
  if (Array.isArray(value)) return value.flatMap(normalizeScopes);
  return String(value ?? "")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function normalizeRequiredScopes(requiredScopes, requiredScope) {
  const normalized = Array.isArray(requiredScopes) ? normalizeScopes(requiredScopes) : [];
  if (normalized.length > 0) return normalized;
  return normalizeScopes(requiredScope);
}

function firstMissingScope(grantedScopes, requiredScopes) {
  return requiredScopes.find((scope) => !grantedScopes.includes(scope)) ?? null;
}

function normalizeText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return new URL(value.trim()).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function isValidUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function randomToken(bytes) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function escapeChallengeValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
