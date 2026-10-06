import {
  CHATGPT_APP_MANIFEST_PATH,
  MCP_ENDPOINT_PATH,
  OAUTH_PROTECTED_RESOURCE_PATH
} from "./chatgpt-app-constants.mjs";
import { resolveProductReadiness } from "./product-readiness.mjs";

export async function resolveLaunchPreflight({ rootDir = process.cwd() } = {}) {
  const readiness = await resolveProductReadiness({ rootDir });
  const summary = readiness.summary ?? {};
  const launchStages = [
    buildStage({
      id: "local-production-handoff",
      label: "Local production handoff",
      passed: readiness.ready,
      summary: readiness.ready
        ? `${summary.content_count ?? 0} drafts, ${summary.rendered_count ?? 0} MP4s, ${summary.image2_handoff_count ?? 0} Image 2 handoff files.`
        : "Generate content, render MP4, build publish bundle, and rebuild production package."
    }),
    buildStage({
      id: "chatgpt-account-auth",
      label: "ChatGPT account auth",
      passed: readiness.chatgpt_account_ready,
      env: ["CHATGPT_ACCOUNT_VERIFIED"],
      summary: readiness.chatgpt_account_ready
        ? "ChatGPT account verification marker is present."
        : "Complete ChatGPT account verification before launch."
    }),
    buildStage({
      id: "image2-account-handoff",
      label: "Image 2 account handoff",
      passed: Number(summary.image2_handoff_count) > 0,
      summary: Number(summary.image2_handoff_count) > 0
        ? "gpt-image-2 handoff is packaged without API-key usage."
        : "Produce a publish bundle with image2-handoff.json."
    }),
    buildStage({
      id: "image2-asset-intake",
      label: "Image 2 asset intake",
      passed: Number(summary.image2_asset_count) > 0,
      required: false,
      summary: Number(summary.image2_asset_count) > 0
        ? `${summary.image2_asset_count} Image 2 generated asset manifest${Number(summary.image2_asset_count) === 1 ? "" : "s"} attached without API-key usage.`
        : "Optional: attach ChatGPT/Image 2 generated shot stills through the account-auth MCP tool."
    }),
    buildStage({
      id: "public-https-mcp",
      label: "Public HTTPS MCP",
      passed: summary.public_mcp_origin_configured,
      env: ["PUBLIC_MCP_ORIGIN"],
      summary: summary.public_mcp_origin_configured
        ? `Public MCP origin configured: ${summary.public_mcp_origin}.`
        : "Expose the MCP API at a public HTTPS origin and set PUBLIC_MCP_ORIGIN."
    }),
    buildStage({
      id: "managed-oauth-jwks",
      label: "Managed OAuth/JWKS",
      passed: summary.production_oauth_configured,
      env: ["CHATGPT_OAUTH_ISSUER", "CHATGPT_OAUTH_JWKS_URI"],
      summary: summary.production_oauth_configured
        ? "Managed OAuth/OIDC issuer and JWKS verifier are configured."
        : "Configure CHATGPT_OAUTH_ISSUER and CHATGPT_OAUTH_JWKS_URI for production token verification."
    }),
    buildStage({
      id: "chatgpt-developer-registration",
      label: "ChatGPT app registration",
      passed: summary.chatgpt_app_registered,
      env: ["CHATGPT_APP_REGISTERED"],
      summary: summary.chatgpt_app_registered
        ? "ChatGPT Developer Mode registration marker is present."
        : "Register the public MCP server in ChatGPT Developer Mode, verify OAuth, then set CHATGPT_APP_REGISTERED=true."
    })
  ];

  const blockers = launchStages
    .filter((stage) => stage.required && stage.status !== "pass")
    .map((stage) => stage.summary);

  const publicOrigin = summary.public_mcp_origin;
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    launch_ready: readiness.commercial_ready,
    local_production_ready: readiness.ready,
    recommended_provider: "chatgpt-account",
    auth_method: "ChatGPT Apps OAuth 2.1 / MCP",
    image_model: "gpt-image-2",
    uses_image_api_key: false,
    stages: launchStages,
    blockers,
    required_env: [
      buildEnv("PUBLIC_MCP_ORIGIN", summary.public_mcp_origin_configured),
      buildEnv("CHATGPT_OAUTH_ISSUER", summary.production_oauth_configured),
      buildEnv("CHATGPT_OAUTH_JWKS_URI", summary.production_oauth_configured),
      buildEnv("CHATGPT_ACCOUNT_VERIFIED", readiness.chatgpt_account_ready),
      buildEnv("CHATGPT_APP_REGISTERED", summary.chatgpt_app_registered)
    ],
    chatgpt_app: {
      mcp_endpoint: publicOrigin ? `${publicOrigin}${MCP_ENDPOINT_PATH}` : MCP_ENDPOINT_PATH,
      app_manifest: publicOrigin ? `${publicOrigin}${CHATGPT_APP_MANIFEST_PATH}` : CHATGPT_APP_MANIFEST_PATH,
      oauth_protected_resource: publicOrigin ? `${publicOrigin}${OAUTH_PROTECTED_RESOURCE_PATH}` : OAUTH_PROTECTED_RESOURCE_PATH,
      scopes: readiness.chatgpt_app?.scopes ?? [],
      tools: readiness.chatgpt_app?.tools ?? []
    },
    artifacts: {
      content_count: summary.content_count ?? 0,
      rendered_count: summary.rendered_count ?? 0,
      publish_bundle_count: summary.publish_bundle_count ?? 0,
      image2_handoff_count: summary.image2_handoff_count ?? 0,
      image2_asset_count: summary.image2_asset_count ?? 0,
      production_package_bytes: summary.production_package_bytes ?? 0
    }
  };
}

function buildStage({ id, label, passed, summary, env = [], required = true }) {
  return {
    id,
    label,
    status: passed ? "pass" : "fail",
    required,
    env,
    summary
  };
}

function buildEnv(name, configured) {
  return {
    name,
    configured: Boolean(configured)
  };
}
