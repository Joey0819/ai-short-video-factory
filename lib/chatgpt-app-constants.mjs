export const MCP_ENDPOINT_PATH = "/mcp";
export const OAUTH_PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
export const OAUTH_ISSUER_PATH = "/oauth-placeholder";
export const OAUTH_AUTHORIZATION_SERVER_METADATA_PATH = `${OAUTH_ISSUER_PATH}/.well-known/oauth-authorization-server`;
export const OAUTH_AUTHORIZE_PATH = `${OAUTH_ISSUER_PATH}/authorize`;
export const OAUTH_TOKEN_PATH = `${OAUTH_ISSUER_PATH}/token`;
export const OAUTH_REGISTER_PATH = `${OAUTH_ISSUER_PATH}/register`;
export const CHATGPT_APP_MANIFEST_PATH = "/api/chatgpt/app-manifest";
export const CHATGPT_WIDGET_PATH = "/chatgpt-app/widget.html";
export const CHATGPT_APP_RESOURCE_URI = "ui://ai-short-video-factory/dashboard.html?v=1";
export const CHATGPT_APP_SCOPES = ["shortvideo:write", "image2:handoff", "readiness:read"];
export const CHATGPT_MCP_TOOL_NAMES = [
  "get_product_readiness",
  "create_short_video_project",
  "produce_short_video",
  "get_image2_handoff",
  "attach_image2_assets"
];
