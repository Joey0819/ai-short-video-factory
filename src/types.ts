export type ProviderMode = "local" | "live" | "chatgpt-account" | "local-llm";

export type JobStatus = "complete" | "active" | "pending";

export type EpisodeStatus = "queued" | "script" | "generated" | "rendering" | "rendered";

export type ReviewGate = "pending" | "approved" | "returned";

export interface VideoRecipe {
  recipe_name: string;
  source_type: string;
  source_summary: string;
  platform: string;
  aspect_ratio: "9:16";
  duration_range_seconds: {
    min: number;
    max: number;
  };
  genre: string;
  visual_style: string;
  character_rules: string[];
  story_structure: Array<{
    beat_name: string;
    purpose: string;
    duration_seconds: number;
  }>;
  shot_style: {
    camera_movements: string[];
    shot_types: string[];
  };
  caption_style: {
    font_style: string;
    position: string;
    words_per_caption: string;
    emphasis_rules: string[];
  };
  audio_style: {
    voice: string;
    music_mood: string;
    sound_effects: string[];
  };
  originality_rules: string[];
}

export interface Caption {
  start: number;
  end: number;
  text: string;
}

export interface Shot {
  shot_id: number;
  duration_seconds: number;
  visual: string;
  image_prompt: string;
  video_prompt: string;
}

export interface Episode {
  id: string;
  title: string;
  source_topic: string;
  hook: string;
  world: string;
  genre: string;
  visual_style: string;
  duration_seconds: number;
  status: EpisodeStatus;
  review_gate: ReviewGate;
  created_at: string;
  output_path: string;
  metadata_path: string;
  captions_path: string;
  poster_path: string;
  hashtags: string[];
  captions: Caption[];
  voiceover: string[];
  shots: Shot[];
  ai_disclosure: string;
  recipe_snapshot: string;
}

export interface GenerationJob {
  id: string;
  label: string;
  status: JobStatus;
  count: number;
}

export interface SourceAsset {
  id: string;
  kind: "image" | "video";
  file_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  storage_path: string;
  artifact_path: string;
  uploaded_at: string;
}

export interface SourceAnalysis {
  status: string;
  source_mode: string;
  source_type: string;
  source_reference: string;
  source_summary_input: string;
  recipe_source_summary: string;
  detected_themes: string[];
  recommended_guidance: string[];
  summary: string;
}

export type ProviderStepStatus = "ready" | "mock" | "needs_key" | "needs_auth" | "adapter_required";

export interface ProviderStep {
  id: string;
  label: string;
  provider: string;
  role: string;
  status: ProviderStepStatus;
}

export interface ProviderStatus {
  recommended_mode: string;
  api_key: {
    env_name: string;
    local_target: string;
    configured: boolean;
    source: string;
  };
  local_llm?: {
    env_name: string;
    local_target: string;
    configured: boolean;
    source: string;
    model: string;
    base_url: string;
  };
  account_auth: {
    env_name: string;
    local_target: string;
    configured: boolean;
    source: string;
    method: string;
  };
  oauth_provider?: {
    mode: string;
    production_configured: boolean;
    issuer: string;
    jwks_uri: string | null;
    source: string;
    missing: string[];
  };
  mcp_app?: {
    configured: boolean;
    endpoint: string;
    app_manifest: string;
    oauth_protected_resource: string;
    oauth_authorization_server?: string;
    oauth_authorize?: string;
    oauth_token?: string;
    oauth_register?: string;
    auth_required: boolean;
    scopes: string[];
  };
  steps: ProviderStep[];
}

export interface OpenAiLiveCheck {
  ok: boolean;
  live_request_sent: boolean;
  live_access: boolean;
  status: "pass" | "fail";
  endpoint?: string;
  model?: string;
  error_class?: "missing_key" | "quota" | "rate_limit" | "auth" | "access" | "network" | "api_error";
  message?: string;
}

export interface OllamaLiveCheck {
  ok: boolean;
  live_request_sent: boolean;
  live_access: boolean;
  status: "pass" | "fail";
  endpoint?: string;
  model?: string;
  available_models?: string[];
  error_class?: "missing_model" | "network" | "api_error";
  message?: string;
}

export type ProductReadinessStatus = "pass" | "warn" | "fail";

export interface ProductReadinessCheck {
  id: string;
  label: string;
  status: ProductReadinessStatus;
  required: boolean;
  commercial?: boolean;
  summary: string;
}

export interface ProductReadiness {
  ok: boolean;
  ready: boolean;
  commercial_ready?: boolean;
  openai_live_ready: boolean;
  chatgpt_account_ready: boolean;
  chatgpt_mcp_app_ready?: boolean;
  chatgpt_app_registered?: boolean;
  project_id: string;
  generated_at: string;
  summary: {
    content_count: number;
    rendered_count: number;
    publish_bundle_count: number;
    image2_handoff_count: number;
    image2_asset_count?: number;
    mcp_tool_count?: number;
    oauth_pkce_ready?: boolean;
    oauth_mode?: string;
    production_oauth_configured?: boolean;
    public_mcp_origin_configured?: boolean;
    public_mcp_origin?: string | null;
    chatgpt_app_registered?: boolean;
    reference_asset_configured?: boolean;
    production_package_bytes: number;
    provider_warnings?: string[];
    launch_blockers?: string[];
  };
  chatgpt_app?: {
    manifest_path: string;
    mcp_endpoint: string;
    oauth_protected_resource: string;
    oauth_authorization_server?: string;
    oauth_authorize?: string;
    oauth_token?: string;
    oauth_register?: string;
    oauth_mode?: string;
    production_oauth_configured?: boolean;
    public_mcp_origin?: string | null;
    registered?: boolean;
    scopes: string[];
    tools: string[];
  };
  checks: ProductReadinessCheck[];
}

export interface LaunchPreflightStage {
  id: string;
  label: string;
  status: "pass" | "fail";
  required: boolean;
  env: string[];
  summary: string;
}

export interface LaunchPreflight {
  ok: boolean;
  generated_at: string;
  launch_ready: boolean;
  local_production_ready: boolean;
  recommended_provider: string;
  auth_method: string;
  image_model: string;
  uses_image_api_key: boolean;
  stages: LaunchPreflightStage[];
  blockers: string[];
  required_env: Array<{
    name: string;
    configured: boolean;
  }>;
  chatgpt_app: {
    mcp_endpoint: string;
    app_manifest: string;
    oauth_protected_resource: string;
    scopes: string[];
    tools: string[];
  };
  artifacts: {
    content_count: number;
    rendered_count: number;
    publish_bundle_count: number;
    image2_handoff_count: number;
    image2_asset_count?: number;
    production_package_bytes: number;
  };
}

export interface LaunchConfig {
  public_mcp_origin: string;
  oauth_issuer: string;
  oauth_jwks_uri: string;
  oauth_authorize_url: string;
  oauth_token_url: string;
  oauth_register_url: string;
  oauth_metadata_url: string;
  oauth_audience: string;
  chatgpt_app_registered: boolean;
  status: {
    public_mcp_origin_configured: boolean;
    production_oauth_configured: boolean;
    chatgpt_app_registered: boolean;
    missing: string[];
  };
}

export type LaunchSmokeStatus = "pass" | "fail" | "skip";

export interface LaunchSmokeCheck {
  id: string;
  label: string;
  status: LaunchSmokeStatus;
  required: boolean;
  summary: string;
}

export interface LaunchSmokeTarget {
  id: string;
  label: string;
  origin: string;
  status: LaunchSmokeStatus;
  ready: boolean;
  checks: LaunchSmokeCheck[];
}

export interface LaunchSmokeTest {
  ok: boolean;
  generated_at: string;
  local_contract_ready: boolean;
  public_contract_ready: boolean;
  oauth_provider_ready: boolean;
  smoke_ready: boolean;
  recommended_provider: string;
  auth_method: string;
  image_model: string;
  uses_image_api_key: boolean;
  targets: LaunchSmokeTarget[];
  blockers: string[];
}

export interface FactoryState {
  id: string;
  name: string;
  generated_at: string;
  provider_mode: ProviderMode;
  video_provider?: string;
  providers: string[];
  source_asset?: SourceAsset | null;
  source_analysis?: SourceAnalysis | null;
  provider_status?: ProviderStatus;
  recipe: VideoRecipe;
  jobs: GenerationJob[];
  episodes: Episode[];
}
