import {
  ArrowDownToLine,
  BadgeCheck,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Columns3,
  Copy,
  FileJson2,
  Film,
  FolderOpen,
  Hash,
  ListChecks,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareStack,
  Upload,
  WandSparkles
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fallbackFactoryState } from "./data/fallbackFactory";
import type {
  Episode,
  EpisodeStatus,
  FactoryState,
  GenerationJob,
  LaunchConfig,
  LaunchPreflight,
  LaunchSmokeTest,
  OllamaLiveCheck,
  OpenAiLiveCheck,
  ProductReadiness,
  ProviderStatus,
  ProviderStepStatus,
  ReviewGate,
  SourceAnalysis,
  SourceAsset
} from "./types";

type ApiRequestOptions = RequestInit & { timeoutMs?: number };

const DEFAULT_API_BASES = getApiBaseCandidates();
let activeApiBase = DEFAULT_API_BASES[0];

function getApiBaseCandidates(): string[] {
  const candidates: string[] = [];
  const configured =
    typeof import.meta !== "undefined" &&
    ((import.meta as unknown as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE?.trim() ?? null);
  if (configured) {
    const normalized = configured.replace(/\/+$/, "");
    candidates.push(normalized.endsWith("/api") ? normalized : `${normalized}/api`);
  }

  if (typeof window !== "undefined") {
    const originBase = `${window.location.origin}/api`;
    candidates.push(originBase);

    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      const candidatesByPort = new Set<number>([3030, 3031]);
      const rawApiPort = new URLSearchParams(window.location.search).get("apiPort");
      const currentPort = Number.parseInt(window.location.port || "", 10);

      if (Number.isFinite(currentPort) && currentPort > 0 && currentPort < 65536) {
        candidatesByPort.add(currentPort);
      }

      const parsedApiPort = Number.parseInt(rawApiPort ?? "", 10);
      if (Number.isFinite(parsedApiPort) && parsedApiPort > 0 && parsedApiPort < 65536) {
        candidatesByPort.add(parsedApiPort);
      }

      for (const port of Array.from(candidatesByPort).sort((left, right) => left - right)) {
        candidates.push(`http://127.0.0.1:${port}/api`);
        candidates.push(`http://localhost:${port}/api`);
      }
    } else {
      candidates.push("http://127.0.0.1:3030/api");
      candidates.push("http://localhost:3030/api");
    }
  } else {
    candidates.push("http://127.0.0.1:3030/api");
    candidates.push("http://localhost:3030/api");
  }

  const deduplicated: string[] = [];
  for (const candidate of candidates) {
    if (!deduplicated.includes(candidate)) deduplicated.push(candidate);
  }
  return deduplicated;
}

function ensureApiBase(base: string): string {
  return base.replace(/\/+$/, "");
}

function apiOrigin(apiBase: string): string {
  return ensureApiBase(apiBase).replace(/\/api$/, "");
}
type RequestedProviderMode = "local" | "chatgpt" | "openai" | "ollama";
type WorkspaceKey = "recipe" | "episodes" | "queue" | "assets" | "exports";
type LaunchConfigDraft = Omit<LaunchConfig, "status">;

const emptyLaunchConfig: LaunchConfig = {
  public_mcp_origin: "",
  oauth_issuer: "",
  oauth_jwks_uri: "",
  oauth_authorize_url: "",
  oauth_token_url: "",
  oauth_register_url: "",
  oauth_metadata_url: "",
  oauth_audience: "",
  chatgpt_app_registered: false,
  status: {
    public_mcp_origin_configured: false,
    production_oauth_configured: false,
    chatgpt_app_registered: false,
    missing: ["PUBLIC_MCP_ORIGIN", "CHATGPT_OAUTH_ISSUER/CHATGPT_OAUTH_JWKS_URI", "CHATGPT_APP_REGISTERED"]
  }
};

const workspaceLabels: Record<WorkspaceKey, string> = {
  recipe: "Recipe",
  episodes: "Episodes",
  queue: "Queue",
  assets: "Assets",
  exports: "Exports"
};

const statusLabels: Record<EpisodeStatus, string> = {
  queued: "Queued",
  script: "Script",
  generated: "Generated",
  rendering: "Rendering",
  rendered: "Rendered"
};

const reviewLabels: Record<ReviewGate, string> = {
  pending: "Pending",
  approved: "Approved",
  returned: "Returned"
};

const providerStepLabels: Record<ProviderStepStatus, string> = {
  ready: "Ready",
  mock: "Local",
  needs_key: "Needs key",
  needs_auth: "Verify",
  adapter_required: "Adapter"
};

export default function App() {
  const [factory, setFactory] = useState<FactoryState>(fallbackFactoryState);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState(fallbackFactoryState.episodes[0]?.id ?? "");
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">("checking");
  const [apiBase, setApiBase] = useState(activeApiBase);
  const [requestedProviderMode, setRequestedProviderMode] = useState<RequestedProviderMode>("chatgpt");
  const [sourceMode, setSourceMode] = useState("Reference video");
  const [draftTopic, setDraftTopic] = useState(fallbackFactoryState.recipe.source_summary);
  const [episodeCount, setEpisodeCount] = useState(String(fallbackFactoryState.episodes.length));
  const [renderCount, setRenderCount] = useState("");
  const [renderDuration, setRenderDuration] = useState("");
  const [videoProvider, setVideoProvider] = useState("local-ffmpeg");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showRuleManager, setShowRuleManager] = useState(false);
  const [editedRulesText, setEditedRulesText] = useState(fallbackFactoryState.recipe.originality_rules.join("\n"));
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceKey>("recipe");
  const [notice, setNotice] = useState("Local production ready. Create content and rendered videos.");
  const [providerDiagnostic, setProviderDiagnostic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isProducing, setIsProducing] = useState(false);
  const [isCheckingProviderLive, setIsCheckingProviderLive] = useState(false);
  const [isUploadingReference, setIsUploadingReference] = useState(false);
  const [isUploadingImage2Assets, setIsUploadingImage2Assets] = useState(false);
  const [readiness, setReadiness] = useState<ProductReadiness | null>(null);
  const [launchPreflight, setLaunchPreflight] = useState<LaunchPreflight | null>(null);
  const [launchConfig, setLaunchConfig] = useState<LaunchConfig>(emptyLaunchConfig);
  const [launchConfigDraft, setLaunchConfigDraft] = useState<LaunchConfigDraft>(launchConfigToDraft(emptyLaunchConfig));
  const [isSavingLaunchConfig, setIsSavingLaunchConfig] = useState(false);
  const [launchSmokeTest, setLaunchSmokeTest] = useState<LaunchSmokeTest | null>(null);
  const [isRunningLaunchSmokeTest, setIsRunningLaunchSmokeTest] = useState(false);
  const referenceInputRef = useRef<HTMLInputElement | null>(null);

  const request = async <T = unknown>(path: string, options: ApiRequestOptions = {}) => apiRequest<T>(path, options, setApiBase);

  useEffect(() => {
    let cancelled = false;
    const generationParams = readGenerationParams();
    loadInitialState(request)
      .then(({ state, backend, readiness: loadedReadiness, launchPreflight: loadedPreflight, launchConfig: loadedLaunchConfig }) => {
        if (cancelled) return;
        const usableState = state.episodes?.length ? state : fallbackFactoryState;
        setFactory(usableState);
        setSelectedEpisodeId(usableState.episodes[0]?.id ?? "");
        setRequestedProviderMode(preferredRequestedProviderMode(usableState));
        setDraftTopic(generationParams.topic ?? usableState.recipe.source_summary);
        setEpisodeCount(generationParams.count ?? String(usableState.episodes.length));
        if (generationParams.sourceMode) setSourceMode(generationParams.sourceMode);
        setBackendStatus(backend ? "online" : "offline");
        setReadiness(loadedReadiness ?? null);
        setLaunchPreflight(loadedPreflight ?? null);
        setLaunchConfig(loadedLaunchConfig ?? emptyLaunchConfig);
        setLaunchConfigDraft(launchConfigToDraft(loadedLaunchConfig ?? emptyLaunchConfig));
        setNotice(backend ? "Backend API connected. Local generation writes project files." : "Static dashboard mode. Start npm run api for backend generation.");
      })
      .catch(() => {
        if (!cancelled) {
          setFactory(fallbackFactoryState);
          setBackendStatus("offline");
          setReadiness(null);
          setLaunchPreflight(null);
          setLaunchConfig(emptyLaunchConfig);
          setLaunchConfigDraft(launchConfigToDraft(emptyLaunchConfig));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedEpisode = useMemo(() => {
    return factory.episodes.find((episode) => episode.id === selectedEpisodeId) ?? factory.episodes[0];
  }, [factory.episodes, selectedEpisodeId]);

  const filteredEpisodes = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return factory.episodes.filter((episode) => {
      const matchesSearch = !normalized || `${episode.title} ${episode.world} ${episode.genre}`.toLowerCase().includes(normalized);
      const matchesFilter = filter === "all" || episode.status === filter || episode.review_gate === filter;
      return matchesSearch && matchesFilter;
    });
  }, [factory.episodes, filter, search]);

  const providerStatus = getProviderStatus(factory);
  const providerNotice =
    requestedProviderMode === "chatgpt"
      ? providerStatus.api_key.configured
        ? "OpenAI director will create web prompt content. ChatGPT account-auth remains available for Image 2 handoff."
        : providerStatus.account_auth.configured
          ? "ChatGPT account verified. Account-auth provider route is ready."
          : "ChatGPT account mode selected. Local production continues until account verification is saved."
      : requestedProviderMode === "openai"
        ? providerStatus.api_key.configured
          ? "OpenAI key configured. Live director layer is available only when explicitly selecting OpenAI mode."
          : "OpenAI mode is an optional fallback. Commercial path uses ChatGPT account-auth + Image 2 handoff."
        : requestedProviderMode === "ollama"
          ? "Local LLM mode uses Ollama to create recipe, captions, shot prompts, and voiceover before local MP4 rendering."
        : "Local production mode is active with local FFmpeg render.";
  const requestedEpisodeCount = clampEpisodeCount(episodeCount);
  const productionRenderCount = clampProductionCount(renderCount, requestedEpisodeCount);
  const productionRenderDuration = clampOptionalDuration(renderDuration);
  const generationTopic = draftTopic.trim() || factory.recipe.source_summary;
  const sourceType = sourceMode.toLowerCase();
  const renderedEpisodeCount = factory.episodes.filter((episode) => episode.status === "rendered").length;
  const productionReady = backendStatus === "online";
  const productionDisabled = isProducing || isGenerating;
  const batchManifestUrl = backendStatus === "online" ? buildBatchManifestUrl(apiBase, factory.id, factory.generated_at) : "";
  const productionPackageUrl = backendStatus === "online" ? buildProductionPackageUrl(apiBase, factory.id, factory.generated_at) : "";
  const chatGptAppManifestUrl = backendStatus === "online" ? buildChatGptAppManifestUrl(apiBase, factory.generated_at) : "";
  const oauthMetadataUrl = backendStatus === "online" ? buildOAuthMetadataUrl(apiBase, factory.generated_at) : "";
  const oauthServerMetadataUrl = backendStatus === "online" ? buildOAuthServerMetadataUrl(apiBase, factory.generated_at) : "";
  const sourceAsset = factory.source_asset ?? null;
  const referenceAssetUrl = backendStatus === "online" && sourceAsset ? buildReferenceAssetUrl(apiBase, factory.id, sourceAsset.stored_name, factory.generated_at) : "";

  async function refreshReadiness() {
    if (backendStatus !== "online") {
      setReadiness(null);
      return null;
    }

    try {
      const [nextReadiness, nextPreflight] = await Promise.all([
        request<ProductReadiness>("/readiness"),
        request<LaunchPreflight>("/launch-preflight").catch(() => null)
      ]);
      setReadiness(nextReadiness);
      setLaunchPreflight(nextPreflight);
      return nextReadiness;
    } catch {
      setReadiness(null);
      setLaunchPreflight(null);
      return null;
    }
  }

  async function ensureBackendConnected() {
    if (backendStatus === "online") return true;

    try {
      await request<ProductReadiness>("/readiness", { timeoutMs: 12_000 });
      setBackendStatus("online");
      await refreshReadiness();
      return true;
    } catch {
      setBackendStatus("offline");
      return false;
    }
  }

  async function handleAnalyzeReference() {
    if (backendStatus !== "online") {
      setNotice("Start npm run api to analyze reference files or text ideas on the backend.");
      return;
    }

    try {
      const result = await request<{ analysis: SourceAnalysis; project: FactoryState }>("/reference/analyze", {
        method: "POST",
        body: JSON.stringify({
          topic: generationTopic,
          sourceType,
          sourceAsset
        })
      });
      setFactory(result.project);
      setNotice(`Reference analyzed: ${result.analysis.summary}`);
      await refreshReadiness();
    } catch {
      setNotice("Reference analysis failed. Upload a source and try again.");
    }
  }

  async function handleReferenceUpload(file: File | null) {
    if (!file) return;
    if (backendStatus !== "online") {
      setNotice("Start npm run api to upload and persist a reference file.");
      return;
    }

    setIsUploadingReference(true);
    setNotice(`Uploading ${file.name} as the production reference...`);
    try {
      const data = await fileToBase64(file);
      const result = await request<{ project: FactoryState; source_asset: SourceAsset }>("/reference", {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          data
        })
      });
      setFactory(result.project);
      setSourceMode(result.source_asset.kind === "image" ? "Screenshot" : "Reference video");
      await refreshReadiness();
      setNotice(`Reference uploaded: ${result.source_asset.file_name}. Create content + video will keep this source in the batch manifest.`);
    } catch {
      setNotice("Reference upload failed. Use a PNG, JPG, WEBP, GIF, MP4, MOV, or WEBM under 50 MB.");
    } finally {
      setIsUploadingReference(false);
      if (referenceInputRef.current) referenceInputRef.current.value = "";
    }
  }

  async function handleImage2AssetUpload(episodeId: string, files: FileList | null) {
    const selectedFiles = Array.from(files ?? []);
    if (selectedFiles.length === 0) return;
    if (backendStatus !== "online") {
      setNotice("Start the backend API to attach ChatGPT/Image 2 stills and rerender the episode.");
      return;
    }

    setIsUploadingImage2Assets(true);
    setNotice(`Attaching ${selectedFiles.length} Image 2 still${selectedFiles.length === 1 ? "" : "s"} and rerendering ${episodeId}...`);
    try {
      const assets = await Promise.all(selectedFiles.map(async (file, index) => ({
        shotId: index + 1,
        fileName: file.name,
        mimeType: imageMimeTypeForFile(file),
        data: await fileToBase64(file)
      })));
      const result = await request<{
        project: FactoryState;
        asset_manifest: { asset_count: number; manifest_path: string; uses_api_key: boolean };
        render?: { image2_asset_count?: number };
        artifact?: { image2_assets_used?: number };
        production_package_path: string;
      }>("/image2-assets", {
        method: "POST",
        body: JSON.stringify({
          episodeId,
          render: true,
          assets
        })
      });
      setFactory(result.project);
      await refreshReadiness();
      const used = Number(result.artifact?.image2_assets_used ?? result.render?.image2_asset_count ?? result.asset_manifest.asset_count) || result.asset_manifest.asset_count;
      setNotice(`Attached ${result.asset_manifest.asset_count} Image 2 still${result.asset_manifest.asset_count === 1 ? "" : "s"}, rerendered ${episodeId}, and refreshed ${result.production_package_path}. ${used} still${used === 1 ? " was" : "s were"} composited into the MP4.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload PNG, JPG, or WEBP Image 2 stills and try again.";
      setNotice(`Image 2 asset attachment failed: ${message}`);
    } finally {
      setIsUploadingImage2Assets(false);
    }
  }

  async function handleGenerateBatch() {
    setIsGenerating(true);
    setNotice(backendStatus === "online" ? "Generating batch through local backend..." : "Generating batch with in-browser local providers...");

    let providerValidationNotice = "";
    if (backendStatus === "online" && requestedProviderMode === "openai" && !providerStatus.api_key.configured) {
      try {
        await request("/openai/dry-run", {
          method: "POST",
          body: JSON.stringify({
            topic: generationTopic,
            count: requestedEpisodeCount,
            sourceType
          })
        });
        providerValidationNotice = "OpenAI dry-run validated; local generation used until key approval. ";
      } catch {
        providerValidationNotice = "OpenAI dry-run failed; local generation used. ";
      }
    }

    if (backendStatus === "online" && requestedProviderMode === "chatgpt") {
      try {
        const report = await request<{ account_verified: boolean }>("/chatgpt/account-dry-run", {
          method: "POST",
          body: JSON.stringify({
            topic: generationTopic,
            count: requestedEpisodeCount,
            sourceType
          })
        });
        providerValidationNotice = report.account_verified
          ? "ChatGPT account-auth plan validated. "
          : "ChatGPT account-auth plan validated; local generation used until verification. ";
      } catch {
        providerValidationNotice = "ChatGPT account-auth validation failed; local generation used. ";
      }
    }

    if (backendStatus !== "online" && requestedProviderMode === "openai") {
      setNotice("OpenAI mode needs npm run api and an approved OPENAI_API_KEY before live generation. Using browser-local generation.");
    }

    if (backendStatus !== "online" && requestedProviderMode === "chatgpt") {
      setNotice("ChatGPT account mode needs npm run api for validation. Using browser-local generation.");
    }

    if (backendStatus !== "online" && requestedProviderMode === "ollama") {
      setNotice("Local LLM mode needs npm run api and Ollama running. Using browser-local generation.");
    }

    if (backendStatus === "online") {
      try {
        const generated = await request<{ project: FactoryState; warnings?: string[] }>("/generate", {
          method: "POST",
          body: JSON.stringify({
            topic: generationTopic,
            count: requestedEpisodeCount,
            sourceType,
            providerMode: requestedProviderMode,
            forceLiveDirector: ["chatgpt", "openai"].includes(requestedProviderMode) && providerStatus.api_key.configured,
            videoProvider,
            sourceAsset
          })
        });
        setFactory(generated.project);
        setSelectedEpisodeId(generated.project.episodes[0]?.id ?? "");
        setDraftTopic(generated.project.recipe.source_summary);
        setEpisodeCount(String(generated.project.episodes.length));
        await refreshReadiness();
        const fallbackNotice = generated.warnings?.length
          ? `${generated.warnings.join(" ")} `
          : "";
        setProviderDiagnostic(generated.warnings?.[0] ?? "");
        setNotice(`${providerValidationNotice}${fallbackNotice}Backend generated batch and wrote project state to disk.`);
        setIsGenerating(false);
        return;
      } catch {
        setBackendStatus("offline");
        setNotice("Backend API unavailable. Falling back to in-browser mock generation.");
      }
    }

    window.setTimeout(() => {
      setFactory((current) => {
        const episodes = Array.from({ length: requestedEpisodeCount }, (_, index) => createUiEpisode(index + 1, current.id, generationTopic));
        return {
          ...current,
          generated_at: new Date().toISOString(),
          recipe: {
            ...current.recipe,
            source_type: sourceType,
            source_summary: generationTopic
          },
          jobs: recalculateJobs(episodes),
          episodes
        };
      });
      setSelectedEpisodeId("episode-001");
      setReadiness(null);
      setLaunchPreflight(null);
      setNotice("Batch generated locally. Review gates are ready before expensive provider steps.");
      setIsGenerating(false);
    }, 650);
  }

  async function handleProduceVideos() {
    if (isProducing) {
      setNotice("A production job is already running. Wait for the MP4 artifacts to finish.");
      return;
    }

    if (isGenerating) {
      setNotice("Batch generation is still running. Wait for the draft content before producing video.");
      return;
    }

    if (backendStatus !== "online") {
      setNotice("Connecting to the backend API before starting content and video production...");
    }

    const connected = productionReady || await ensureBackendConnected();
    if (!connected) {
      setNotice("Backend API is offline. Start npm run api, then click Create content + video again.");
      return;
    }

    const canUseRequestedVideoProvider =
      ["local-ffmpeg", "mock"].includes(videoProvider) ||
      (videoProvider === "openai-video" && providerStatus.api_key.configured);
    const resolvedVideoProvider = canUseRequestedVideoProvider
      ? videoProvider
      : "local-ffmpeg";
    const requestedCount = clampEpisodeCount(String(productionRenderCount || requestedEpisodeCount || 1));
    const estimatedDuration = productionRenderDuration && Number.isFinite(productionRenderDuration) ? productionRenderDuration : 24;
    const estimatedTimeoutMs = resolvedVideoProvider === "openai-video"
      ? Math.max(8 * 60_000, Math.min(24 * 60_000, requestedCount * 8 * 60_000))
      : Math.max(120_000, Math.min(8 * 60_000, requestedCount * estimatedDuration * 5_000));
    setIsProducing(true);

    if (resolvedVideoProvider !== videoProvider) {
      setNotice(`Renderer "${videoProvider}" is not ready. Falling back to local FFmpeg for this run.`);
    }

    setNotice(
      resolvedVideoProvider === "openai-video"
        ? "Creating prompt-driven content and starting OpenAI video rendering. This can take several minutes..."
        : `Creating content and rendering MP4 video artifacts${productionRenderDuration ? ` for ~${productionRenderDuration}s clips` : "..."}`
    );

    try {
      const produced = await request<{
        project: FactoryState;
        artifacts?: Array<{
          episode_id: string;
          output_path: string;
          manifest_path: string;
          image2_asset_count?: number;
          image2_assets_used?: number;
          publish_ready: boolean;
        }>;
        warnings?: string[];
      }>("/produce", {
        method: "POST",
        body: JSON.stringify({
          topic: generationTopic,
          count: requestedCount,
          renderCount: productionRenderCount,
          renderDuration: productionRenderDuration,
          sourceType,
          providerMode: requestedProviderMode,
          forceLiveDirector: ["chatgpt", "openai"].includes(requestedProviderMode) && providerStatus.api_key.configured,
          videoProvider: resolvedVideoProvider,
          sourceAsset
        }),
        timeoutMs: estimatedTimeoutMs
      });
      const artifacts = Array.isArray(produced.artifacts) ? produced.artifacts : [];
      setFactory(produced.project);
      setSelectedEpisodeId(
        artifacts[0]?.episode_id
          ?? produced.project.episodes.find((episode) => episode.status === "rendered")?.id
          ?? produced.project.episodes[0]?.id
          ?? ""
      );
      setDraftTopic(produced.project.recipe.source_summary);
      setEpisodeCount(String(produced.project.episodes.length));
      await refreshReadiness();
      const fallbackNotice = produced.warnings?.length
        ? `${produced.warnings.join(" ")} `
        : "";
      setProviderDiagnostic(produced.warnings?.[0] ?? "");
      if (artifacts.length === 0) {
        const renderedCount = produced.project.episodes.filter((episode) => episode.status === "rendered").length;
        setNotice(
          `${fallbackNotice}Production completed, but no MP4 artifacts were generated. ` +
          `Drafts: ${produced.project.episodes.length}, rendered: ${renderedCount}. Check backend logs for render errors and verify ffmpeg is available.`
        );
        return;
      }
      const image2AssetsUsed = artifacts.reduce((sum, artifact) => sum + (Number(artifact.image2_assets_used) || 0), 0);
      const image2Summary = image2AssetsUsed
        ? ` ${image2AssetsUsed} Image 2 still${image2AssetsUsed === 1 ? " was" : "s were"} composited into the render.`
        : "";
      setNotice(`${fallbackNotice}Created ${produced.project.episodes.length} content drafts and rendered ${artifacts.length} MP4 video file${artifacts.length === 1 ? "" : "s"}. Batch manifest is ready.${image2Summary}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown backend error.";
      setNotice(`Production job failed in the backend: ${message}`);
    } finally {
      setIsProducing(false);
    }
  }

  async function handleValidateProviderPlan() {
    if (backendStatus !== "online") {
      setNotice("Start npm run api to validate the selected provider plan with the backend.");
      return;
    }
    try {
      if (requestedProviderMode === "local") {
        const localReadiness = await request<ProductReadiness>("/readiness");
        setReadiness(localReadiness);
        setNotice(localReadiness.ready ? "Local production plan validated. MP4 packaging and handoff artifacts are ready." : "Local production plan needs generated content or render artifacts.");
        return;
      }

      const endpoint = requestedProviderMode === "chatgpt" ? "/chatgpt/account-dry-run" : "/openai/dry-run";
      if (requestedProviderMode === "openai") {
        setIsCheckingProviderLive(true);
        const report = await request<OpenAiLiveCheck>("/openai/live-check", {
          method: "POST",
          body: JSON.stringify({
            topic: generationTopic,
            count: requestedEpisodeCount,
            sourceType
          }),
          timeoutMs: 45_000
        });
        if (report.live_access) {
          setProviderDiagnostic("");
          setNotice(`OpenAI live check passed. ${report.model ?? "Configured model"} can create prompt content through ${report.endpoint ?? "/v1/responses"}.`);
        } else {
          const message = report.message ?? "OpenAI live check did not pass.";
          setProviderDiagnostic(message);
          setNotice(`OpenAI live check failed: ${providerFailureLabel(report.error_class)}. Local FFmpeg fallback remains available.`);
        }
        return;
      }

      if (requestedProviderMode === "ollama") {
        setIsCheckingProviderLive(true);
        const report = await request<OllamaLiveCheck>("/ollama/live-check", {
          method: "POST",
          body: JSON.stringify({
            topic: generationTopic,
            count: requestedEpisodeCount,
            sourceType
          }),
          timeoutMs: 20_000
        });
        if (report.live_access) {
          setProviderDiagnostic("");
          setNotice(`Ollama live check passed. ${report.model ?? "Configured local model"} can create prompt content before MP4 rendering.`);
        } else {
          const message = report.message ?? "Ollama live check did not pass.";
          setProviderDiagnostic(message);
          setNotice(`Ollama live check failed: ${ollamaFailureLabel(report.error_class)}. Local deterministic fallback remains available.`);
        }
        return;
      }

      const report = await request<{ account_verified?: boolean }>(endpoint, {
        method: "POST",
        body: JSON.stringify({
          topic: generationTopic,
          count: requestedEpisodeCount,
          sourceType
        })
      });
      if (requestedProviderMode === "chatgpt") {
        setNotice(report.account_verified ? "ChatGPT account-auth plan validated. Account mode is ready." : "ChatGPT account-auth plan validated. Verification marker is still required.");
      }
    } catch {
      setNotice("Provider plan validation failed in the backend.");
    } finally {
      setIsCheckingProviderLive(false);
    }
  }

  async function handleSaveAccountVerification(verified: boolean) {
    if (backendStatus !== "online") {
      setNotice("Start npm run api to save ChatGPT account verification.");
      return;
    }

    try {
      const result = await request<{ project: FactoryState; provider_status: ProviderStatus; account_verified: boolean }>("/chatgpt/account-verification", {
        method: "POST",
        body: JSON.stringify({ verified })
      });
      setFactory(result.project);
      if (result.account_verified) setRequestedProviderMode("chatgpt");
      await refreshReadiness();
      setNotice(result.account_verified ? "ChatGPT account verification saved. Image 2 handoff is ready." : "ChatGPT account verification cleared. Local production remains available.");
    } catch {
      setNotice("Could not save ChatGPT account verification in the backend.");
    }
  }

  async function handleSaveLaunchConfig() {
    if (backendStatus !== "online") {
      setNotice("Start npm run api to save commercial launch settings.");
      return;
    }

    setIsSavingLaunchConfig(true);
    try {
      const result = await request<{
        launch_config: LaunchConfig;
        provider_status: ProviderStatus;
        readiness: ProductReadiness;
        launch_preflight: LaunchPreflight;
      }>("/launch-config", {
        method: "POST",
        body: JSON.stringify(launchConfigDraft)
      });
      setLaunchConfig(result.launch_config);
      setLaunchConfigDraft(launchConfigToDraft(result.launch_config));
      setLaunchSmokeTest(null);
      setReadiness(result.readiness);
      setLaunchPreflight(result.launch_preflight);
      setFactory((current) => ({
        ...current,
        generated_at: new Date().toISOString(),
        provider_status: result.provider_status,
        providers: result.provider_status.steps.map((step) => step.provider)
      }));
      setNotice(result.launch_preflight.launch_ready ? "Commercial launch configuration saved. Launch gates are ready." : "Commercial launch configuration saved. Remaining gates are visible in launch preflight.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid launch configuration.";
      setNotice(`Launch configuration was not saved: ${message}`);
    } finally {
      setIsSavingLaunchConfig(false);
    }
  }

  async function handleRunLaunchSmokeTest() {
    if (backendStatus !== "online") {
      setNotice("Start npm run api to run the ChatGPT app smoke test.");
      return;
    }

    setIsRunningLaunchSmokeTest(true);
    try {
      const result = await request<LaunchSmokeTest>("/launch-smoke-test");
      setLaunchSmokeTest(result);
      setNotice(result.smoke_ready
        ? "Launch smoke test passed for local and public ChatGPT app contracts."
        : `Launch smoke test completed. ${result.local_contract_ready ? "Local contract ready." : "Local contract has gates."} ${result.public_contract_ready ? "Public contract ready." : "Public launch gate remains."}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown smoke-test failure.";
      setNotice(`Launch smoke test failed: ${message}`);
    } finally {
      setIsRunningLaunchSmokeTest(false);
    }
  }

  function openRuleManager() {
    setEditedRulesText(factory.recipe.originality_rules.join("\n"));
    setShowRuleManager(true);
  }

  async function handleSaveOriginalityRules() {
    const nextRules = editedRulesText
      .split(/\r?\n/)
      .map((rule) => rule.trim())
      .filter(Boolean);

    if (!nextRules.length) {
      setNotice("At least one originality rule is required.");
      return;
    }

    if (backendStatus !== "online") {
      setFactory((current) => ({
        ...current,
        generated_at: new Date().toISOString(),
        recipe: {
          ...current.recipe,
          originality_rules: nextRules
        }
      }));
      setShowRuleManager(false);
      setNotice("Offline mode: rules updated in local state only. Start backend to persist.");
      return;
    }

    try {
      const result = await request<{ project: FactoryState }>("/project/rules", {
        method: "POST",
        body: JSON.stringify({
          originalityRules: nextRules
        })
      });
      setFactory(result.project);
      setShowRuleManager(false);
      setNotice("Originality rules saved.");
      await refreshReadiness();
    } catch {
      setNotice("Failed to save originality rules.");
    }
  }

  async function updateReview(episodeId: string, reviewGate: ReviewGate) {
    if (backendStatus === "online") {
      try {
        const updated = await request<{ project: FactoryState }>("/episode", {
          method: "POST",
          body: JSON.stringify({ episodeId, reviewGate })
        });
        setFactory(updated.project);
        setSelectedEpisodeId(episodeId);
        setNotice(`Review gate persisted as ${reviewLabels[reviewGate]}.`);
        return;
      } catch {
        setBackendStatus("offline");
        setNotice("Backend review update failed. Review gate updated locally.");
      }
    }

    setFactory((current) => {
      const episodes = current.episodes.map((episode) => (episode.id === episodeId ? { ...episode, review_gate: reviewGate } : episode));
      return { ...current, jobs: recalculateJobs(episodes), episodes };
    });
    setNotice(`Review gate set to ${reviewLabels[reviewGate]}.`);
  }

  async function markRendered(episodeId: string) {
    if (backendStatus === "online") {
      try {
        const rendered = await request<{ project: FactoryState }>("/render", {
          method: "POST",
          body: JSON.stringify({ episodeId })
        });
        setFactory(rendered.project);
        setSelectedEpisodeId(episodeId);
        await refreshReadiness();
        setNotice("Backend rendered the MP4 package on disk.");
        return;
      } catch {
        setBackendStatus("offline");
        setNotice("Backend render failed. UI state updated locally; run npm run render to rebuild on disk.");
      }
    } else {
      setReadiness(null);
      setLaunchPreflight(null);
      setNotice("MP4 render marked complete. Start npm run api or run npm run render to rebuild the file on disk.");
    }

    setFactory((current) => {
      const episodes = current.episodes.map((episode) =>
        episode.id === episodeId ? { ...episode, status: "rendered" as EpisodeStatus, review_gate: "approved" as ReviewGate } : episode
      );
      return { ...current, jobs: recalculateJobs(episodes), episodes };
    });
  }

  function exportCaptions(episode: Episode) {
    const content = captionsToSrt(episode.captions);
    const url = window.URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${episode.id}-captions.srt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    setNotice(`Captions exported for ${episode.id}.`);
  }

  async function copyHashtags(episode: Episode) {
    const hashtags = episode.hashtags.join(" ");
    if (await copyTextToClipboard(hashtags)) {
      setNotice(`Hashtags copied for ${episode.id}.`);
    } else {
      setNotice(`Hashtags ready: ${hashtags}`);
    }
  }

  async function buildBundle(episodeId: string) {
    if (backendStatus !== "online") {
      setNotice("Start npm run api to build the publish bundle on disk.");
      return;
    }
    try {
      const result = await request<{ manifest: { files: { manifest: string } } }>("/bundle", {
        method: "POST",
        body: JSON.stringify({ episodeId })
      });
      await refreshReadiness();
      setNotice(`Publish bundle built: ${result.manifest.files.manifest}`);
    } catch {
      setNotice("Publish bundle failed in the backend.");
    }
  }

  async function handleSaveProject() {
    if (backendStatus !== "online") {
      setNotice("Start npm run api to save the project on disk.");
      return;
    }
    try {
      const result = await request<{
        project: FactoryState;
        files: {
          project_state: string;
          save_receipt: string;
        };
      }>("/project/save", {
        method: "POST"
      });
      setFactory(result.project);
      setNotice(`Project saved: ${result.files.project_state}; receipt ${result.files.save_receipt}.`);
    } catch {
      setNotice("Project save failed in the backend.");
    }
  }

  async function handleDuplicateProject() {
    if (backendStatus !== "online") {
      setNotice("Start npm run api to duplicate the project snapshot.");
      return;
    }
    try {
      const result = await request<{
        duplicate: {
          id: string;
          project_snapshot: string;
          manifest_path: string;
        };
      }>("/project/duplicate", {
        method: "POST"
      });
      setNotice(`Duplicate snapshot created: ${result.duplicate.project_snapshot}.`);
    } catch {
      setNotice("Project duplicate failed in the backend.");
    }
  }

  function handleOpenSettings() {
    setShowAdvanced(true);
    window.requestAnimationFrame(() => {
      document.getElementById("workspace-settings")?.scrollIntoView({
        behavior: "auto",
        block: "start"
      });
    });
    setNotice("Settings opened in the generation panel.");
  }

  function handleToggleNotifications() {
    setShowNotifications((current) => !current);
    setNotice(showNotifications ? "Notifications closed." : "Notifications opened.");
  }

  function handleWorkspaceSelect(workspace: WorkspaceKey) {
    setActiveWorkspace(workspace);
    window.requestAnimationFrame(() => {
      document.getElementById(`workspace-${workspace}`)?.scrollIntoView({
        behavior: "auto",
        block: "start"
      });
    });
    setNotice(`${workspaceLabels[workspace]} workspace selected.`);
  }

  if (!selectedEpisode) {
    return <div className="empty-app">No episode state found.</div>;
  }

  return (
    <div className="app-shell">
      <Sidebar
        activeWorkspace={activeWorkspace}
        factory={factory}
        onNotice={setNotice}
        onWorkspaceSelect={handleWorkspaceSelect}
      />
      <div className="workspace">
        <Topbar
          factory={factory}
          providerStatus={providerStatus}
          backendStatus={backendStatus}
          productionReady={productionReady}
          productionDisabled={productionDisabled}
          onGenerateBatch={handleGenerateBatch}
          onProduceVideos={handleProduceVideos}
          onSaveProject={handleSaveProject}
          onDuplicateProject={handleDuplicateProject}
          onOpenSettings={handleOpenSettings}
          onToggleNotifications={handleToggleNotifications}
          isGenerating={isGenerating}
          isProducing={isProducing}
          notificationsOpen={showNotifications}
          onNotice={setNotice}
        />
        {showNotifications && (
          <NotificationsPanel
            backendStatus={backendStatus}
            readiness={readiness}
            launchPreflight={launchPreflight}
            onClose={() => {
              setShowNotifications(false);
              setNotice("Notifications closed.");
            }}
          />
        )}
        <main className="main-grid">
          <section className="panel recipe-panel workspace-target" id="workspace-recipe" aria-label="VideoRecipe editor">
            <div className="panel-header">
              <div>
                <p className="eyebrow">VideoRecipe</p>
                <h2>{factory.recipe.recipe_name}</h2>
              </div>
              <button className="ghost-button" onClick={() => setNotice("Recipe state is already saved in the active backend project.")} type="button">
                <Save size={16} />
                Saved
              </button>
            </div>

            <div className="source-tabs" role="tablist" aria-label="Reference source">
              {["Reference video", "Screenshot", "Text idea"].map((mode) => (
                <button className={sourceMode === mode ? "active" : ""} key={mode} onClick={() => setSourceMode(mode)} type="button">
                  {mode === "Reference video" ? <Film size={15} /> : mode === "Screenshot" ? <Clapperboard size={15} /> : <FileJson2 size={15} />}
                  {mode}
                </button>
              ))}
            </div>

            <div className="reference-block workspace-target" id="workspace-assets">
              <div className="reference-media">
                {sourceAsset?.kind === "video" && referenceAssetUrl ? (
                  <video src={referenceAssetUrl} controls muted playsInline poster="/assets/fruit-drama-preview.png" />
                ) : (
                  <img src={sourceAsset?.kind === "image" && referenceAssetUrl ? referenceAssetUrl : "/assets/fruit-drama-preview.png"} alt="AI fruit drama reference preview" />
                )}
              </div>
              <div>
                <strong>{sourceAsset?.file_name ?? (sourceMode === "Text idea" ? "AI cartoon fruit drama" : "fruit_drama_reference.mp4")}</strong>
                <span>{sourceAsset ? `${sourceAsset.kind} · ${formatBytes(sourceAsset.size_bytes)} · ${sourceAsset.mime_type}` : "1080x1920 · 0:28 · sample source"}</span>
                {factory.source_analysis?.summary ? <p className="analysis-summary">{factory.source_analysis.summary}</p> : null}
                {factory.source_analysis?.recommended_guidance?.length ? (
                  <ul className="analysis-guidance">
                    {factory.source_analysis.recommended_guidance.slice(0, 3).map((guidance) => (
                      <li key={guidance}>{guidance}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="reference-actions">
                  <button className="primary-soft" onClick={handleAnalyzeReference} type="button">
                    <WandSparkles size={16} />
                    Analyze reference
                  </button>
                  <button className="ghost-button upload-reference" onClick={() => referenceInputRef.current?.click()} type="button" disabled={isUploadingReference}>
                    {isUploadingReference ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}
                    Upload source
                  </button>
                  <input
                    ref={referenceInputRef}
                    className="hidden-file-input"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
                    onChange={(event) => void handleReferenceUpload(event.currentTarget.files?.[0] ?? null)}
                  />
                </div>
                {referenceAssetUrl && (
                  <a className="reference-link" href={referenceAssetUrl} target="_blank" rel="noreferrer">
                    Open uploaded source
                  </a>
                )}
              </div>
            </div>

            <label className="field-block">
              <span>Concept / Hook</span>
              <textarea value={draftTopic} onChange={(event) => setDraftTopic(event.target.value)} maxLength={300} />
              <small>Recipe extracts structure and style, then forces original variations.</small>
            </label>

            <div className="compact-fields">
              <label>
                Tone
                <select defaultValue="Dramatic">
                  <option>Dramatic</option>
                  <option>Motivational</option>
                  <option>Investigative</option>
                </select>
              </label>
              <label>
                Aspect ratio
                <select defaultValue="9:16">
                  <option>9:16</option>
                </select>
              </label>
              <label>
                Duration
                <select defaultValue="20-35s">
                  <option>20-35s</option>
                  <option>35-45s</option>
                </select>
              </label>
            </div>
          </section>

          <section className="panel rules-panel" aria-label="Originality and caption rules">
            <div className="panel-header">
              <div className="inline-title">
                <ShieldCheck size={18} />
                <h2>Originality rules</h2>
              </div>
              <button className="ghost-button" onClick={() => void openRuleManager()} type="button">Manage</button>
            </div>
            {showRuleManager && (
              <div className="rule-editor">
                <div className="panel-header nested">
                  <h3>Edit originality rules</h3>
                  <button className="icon-button" aria-label="Close rule manager" onClick={() => setShowRuleManager(false)} type="button">
                    ×
                  </button>
                </div>
                <p className="field-help">One rule per line. Keep prompts short and specific.</p>
                <textarea
                  value={editedRulesText}
                  onChange={(event) => setEditedRulesText(event.target.value)}
                  placeholder="Use concise transformation rules\nAvoid copyrighted character names\nKeep generated visuals unique"
                />
                <div className="rule-editor-actions">
                  <button className="ghost-button" onClick={() => setShowRuleManager(false)} type="button">Cancel</button>
                  <button className="primary-button" onClick={() => void handleSaveOriginalityRules()} type="button">Save rules</button>
                </div>
              </div>
            )}
            <div className="rule-list">
              {factory.recipe.originality_rules.map((rule) => (
                <div className="rule-row" key={rule}>
                  <Check size={16} />
                  <span>{rule}</span>
                </div>
              ))}
            </div>

            <div className="caption-card">
              <div className="panel-header nested">
                <h3>Caption style</h3>
                <button className="ghost-button" onClick={() => setNotice("Caption preview is visible in the phone preview panel.")} type="button">Preview</button>
              </div>
              <dl className="meta-grid">
                <div>
                  <dt>Font</dt>
                  <dd>{factory.recipe.caption_style.font_style}</dd>
                </div>
                <div>
                  <dt>Position</dt>
                  <dd>{factory.recipe.caption_style.position}</dd>
                </div>
                <div>
                  <dt>Chunk</dt>
                  <dd>{factory.recipe.caption_style.words_per_caption} words</dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="panel generation-panel workspace-target" id="workspace-settings" aria-label="Generation controls">
            <div className="panel-header">
              <h2>Generation</h2>
              <Sparkles size={18} />
            </div>
            <label>
              Total episodes
              <input value={episodeCount} onChange={(event) => setEpisodeCount(event.target.value)} inputMode="numeric" />
            </label>
            <label>
              Voice
              <select defaultValue="Energetic narrator">
                <option>Energetic narrator</option>
                <option>Suspense narrator</option>
                <option>Documentary voice</option>
              </select>
            </label>
            <label>
              Provider mode
              <select value={requestedProviderMode} onChange={(event) => setRequestedProviderMode(event.target.value as RequestedProviderMode)}>
                <option value="chatgpt">ChatGPT account</option>
                <option value="local">Local production</option>
                <option value="openai">OpenAI API fallback</option>
                <option value="ollama">Local LLM (Ollama)</option>
              </select>
            </label>
            <button
              className="wide-production-command"
              id="produce-button-panel"
              onClick={handleProduceVideos}
              type="button"
              aria-disabled={productionDisabled}
              title={productionDisabled
                ? "Production workflow is busy..."
                : productionReady
                  ? "Create content, render MP4 files, and build production artifacts"
                  : "Connect to the backend API and create content plus video"
              }
              aria-label="Create content and render videos"
              data-testid="produce-button-panel"
            >
              {isProducing ? <Loader2 className="spin" size={17} /> : <Clapperboard size={17} />}
              Create content + video
            </button>
            <ProviderReadinessCard providerStatus={providerStatus} />
            <ProviderDiagnosticsCard diagnostic={providerDiagnostic} />
            <ProductReadinessCard readiness={readiness} backendStatus={backendStatus} />
            <LaunchPreflightCard preflight={launchPreflight} backendStatus={backendStatus} />
            <button className="wide-command" onClick={handleValidateProviderPlan} type="button" disabled={isCheckingProviderLive}>
              {isCheckingProviderLive && requestedProviderMode === "openai"
                ? "Checking OpenAI access..."
                : isCheckingProviderLive && requestedProviderMode === "ollama"
                  ? "Checking Ollama model..."
                  : requestedProviderMode === "chatgpt"
                    ? "Validate ChatGPT account plan"
                    : requestedProviderMode === "openai"
                      ? "Validate OpenAI fallback plan"
                      : requestedProviderMode === "ollama"
                        ? "Validate Local LLM plan"
                        : "Validate local production plan"}
              <ChevronRight size={16} />
            </button>
            {requestedProviderMode === "chatgpt" && (
              <button
                className="wide-command"
                onClick={() => void handleSaveAccountVerification(!providerStatus.account_auth.configured)}
                type="button"
              >
                {providerStatus.account_auth.configured ? "Clear account verification" : "Save account verification"}
                <ChevronRight size={16} />
              </button>
            )}
            <button className={`wide-command ${showAdvanced ? "active" : ""}`} onClick={() => setShowAdvanced((current) => !current)} type="button">
              Advanced options
              <ChevronRight size={16} />
            </button>
            {showAdvanced && (
              <div className="advanced-production">
                <div className="compact-fields two">
                  <label>
                    Render count
                    <input value={renderCount} onChange={(event) => setRenderCount(event.target.value)} inputMode="numeric" placeholder={`All ${requestedEpisodeCount}`} />
                  </label>
                  <label>
                    Duration override
                    <input value={renderDuration} onChange={(event) => setRenderDuration(event.target.value)} inputMode="numeric" placeholder="Auto" />
                  </label>
                </div>
                <label>
                  Video renderer
                  <select value={videoProvider} onChange={(event) => setVideoProvider(event.target.value)}>
                    <option value="local-ffmpeg">Local FFmpeg</option>
                    <option value="openai-video">OpenAI Videos API</option>
                    <option value="mock">Mock renderer</option>
                  </select>
                </label>
                <LaunchConfigEditor
                  draft={launchConfigDraft}
                  config={launchConfig}
                  smokeTest={launchSmokeTest}
                  disabled={isSavingLaunchConfig || backendStatus !== "online"}
                  saving={isSavingLaunchConfig}
                  runningSmokeTest={isRunningLaunchSmokeTest}
                  onChange={setLaunchConfigDraft}
                  onSave={() => void handleSaveLaunchConfig()}
                  onRunSmokeTest={() => void handleRunLaunchSmokeTest()}
                />
              </div>
            )}
            <div className="cost-box">
              <span>Estimated cost</span>
              <strong>0.0 credits</strong>
              <small>{providerNotice}</small>
            </div>
            <div className="production-handoff">
              <div>
                <span>Production handoff</span>
                <strong>{renderedEpisodeCount}/{factory.episodes.length} rendered</strong>
              </div>
              {batchManifestUrl ? (
                <div className="handoff-actions">
                  <a href={batchManifestUrl} target="_blank" rel="noreferrer">
                    <FileJson2 size={16} />
                    Batch manifest
                  </a>
                  <a href={productionPackageUrl} download="production-package.tar.gz">
                    <ArrowDownToLine size={16} />
                    Download package
                  </a>
                  <a href={chatGptAppManifestUrl} target="_blank" rel="noreferrer">
                    <Sparkles size={16} />
                    ChatGPT app
                  </a>
                  <a href={oauthMetadataUrl} target="_blank" rel="noreferrer">
                    <ShieldCheck size={16} />
                    OAuth metadata
                  </a>
                  <a href={oauthServerMetadataUrl} target="_blank" rel="noreferrer">
                    <ShieldCheck size={16} />
                    Auth server
                  </a>
                </div>
              ) : (
                <span className="muted-handoff">Start backend API for artifacts</span>
              )}
            </div>
          </section>

          <JobTimeline jobs={factory.jobs} onNotice={setNotice} />

          <section className="panel episodes-panel workspace-target" id="workspace-episodes" aria-label="Episodes review table">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Episodes ({filteredEpisodes.length})</p>
                <h2>Review queue</h2>
              </div>
              <div className="table-tools">
                <label className="search-box">
                  <Search size={16} />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search episodes..." />
                </label>
                <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                  <option value="all">All status</option>
                  <option value="rendered">Rendered</option>
                  <option value="generated">Generated</option>
                  <option value="rendering">Rendering</option>
                  <option value="queued">Queued</option>
                  <option value="approved">Approved</option>
                  <option value="pending">Pending gate</option>
                </select>
                <button className="icon-button" aria-label="Refresh" onClick={() => void refreshReadiness().then(() => setNotice("Queue and product readiness refreshed."))} type="button">
                  <RefreshCw size={17} />
                </button>
              </div>
            </div>
            <div className="episode-table">
              <div className="episode-head">
                <span>#</span>
                <span>Episode title</span>
                <span>Duration</span>
                <span>Status</span>
                <span>Review gate</span>
                <span>Actions</span>
              </div>
              {filteredEpisodes.map((episode, index) => {
                const episodeVideoUrl = backendStatus === "online" ? buildArtifactUrl(apiBase, episode.output_path, factory.generated_at) : "";
                return (
                <div
                  className={`episode-row ${selectedEpisode.id === episode.id ? "selected" : ""}`}
                  key={episode.id}
                  onClick={() => setSelectedEpisodeId(episode.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedEpisodeId(episode.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <span className="episode-title">
                    <img src={episode.poster_path} alt="" />
                    <strong>{episode.title}</strong>
                  </span>
                  <span>0:{String(episode.duration_seconds).padStart(2, "0")}</span>
                  <StatusPill status={episode.status} />
                  <ReviewPill gate={episode.review_gate} />
                  <span className="row-actions" onClick={(event) => event.stopPropagation()}>
                    <button type="button" aria-label={`Preview ${episode.title}`} onClick={() => {
                      setSelectedEpisodeId(episode.id);
                      setNotice(`${episode.title} selected in preview.`);
                    }}>
                      <Play size={16} />
                    </button>
                    {episode.status === "rendered" && episodeVideoUrl ? (
                      <a href={episodeVideoUrl} download={`${episode.id}.mp4`} aria-label={`Download ${episode.title} MP4`}>
                        <ArrowDownToLine size={16} />
                      </a>
                    ) : (
                      <button type="button" aria-label={`Render ${episode.title}`} onClick={() => void markRendered(episode.id)}>
                        <ArrowDownToLine size={16} />
                      </button>
                    )}
                  </span>
                </div>
                );
              })}
            </div>
          </section>

          <aside className="preview-column" aria-label="Video preview and export">
            <PreviewPanel
              episode={selectedEpisode}
              onRender={markRendered}
              onReview={updateReview}
              onExportCaptions={exportCaptions}
              onCopyHashtags={copyHashtags}
              onBuildBundle={buildBundle}
              onAttachImage2Assets={(episodeId, files) => void handleImage2AssetUpload(episodeId, files)}
              isUploadingImage2Assets={isUploadingImage2Assets}
              artifactVideoUrl={backendStatus === "online" ? buildArtifactUrl(apiBase, selectedEpisode.output_path, factory.generated_at) : ""}
              bundleManifestUrl={backendStatus === "online" ? buildBundleManifestUrl(apiBase, factory.id, selectedEpisode.id, factory.generated_at) : ""}
              image2HandoffUrl={backendStatus === "online" ? buildImage2HandoffUrl(apiBase, factory.id, selectedEpisode.id, factory.generated_at) : ""}
              image2AssetManifestUrl={backendStatus === "online" ? buildImage2AssetManifestUrl(apiBase, factory.id, selectedEpisode.id, factory.generated_at) : ""}
              onNotice={setNotice}
            />
          </aside>
        </main>
        <div className="toast" role="status">
          <BadgeCheck size={16} />
          {notice}
        </div>
      </div>
    </div>
  );
}

function Sidebar({
  activeWorkspace,
  factory,
  onNotice,
  onWorkspaceSelect
}: {
  activeWorkspace: WorkspaceKey;
  factory: FactoryState;
  onNotice: (message: string) => void;
  onWorkspaceSelect: (workspace: WorkspaceKey) => void;
}) {
  const navItems: Array<{ key: WorkspaceKey; label: string; Icon: LucideIcon }> = [
    { key: "recipe", label: "Recipe", Icon: FileJson2 },
    { key: "episodes", label: "Episodes", Icon: Film },
    { key: "queue", label: "Queue", Icon: ListChecks },
    { key: "assets", label: "Assets", Icon: FolderOpen },
    { key: "exports", label: "Exports", Icon: Upload }
  ];

  const providerStatus = getProviderStatus(factory);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Clapperboard size={24} />
        </div>
        <span>AI Short Video Factory</span>
      </div>
      <nav className="nav-list" aria-label="Primary">
        {navItems.map(({ key, label, Icon }) => (
          <button
            aria-current={activeWorkspace === key ? "page" : undefined}
            className={activeWorkspace === key ? "active" : ""}
            key={key}
            onClick={() => onWorkspaceSelect(key)}
            type="button"
          >
            <Icon size={19} />
            {label}
            {label === "Queue" && <span className="count-badge">{factory.jobs.filter((job) => job.status === "active").length}</span>}
          </button>
        ))}
      </nav>
      <div className="project-list">
        <div className="section-label">
          Projects
          <Plus size={16} />
        </div>
        {["Reference Batch 001", "Fruit drama tests", "Animal court pilots"].map((project, index) => (
          <button className={index === 0 ? "active" : ""} key={project} onClick={() => onNotice(`${project} selected.`)} type="button">
            <span className="project-dot" />
            {project}
          </button>
        ))}
      </div>
      <div className="provider-box">
        <strong>{providerStatus.account_auth.configured ? "ChatGPT account ready" : providerStatus.api_key.configured ? "OpenAI director ready" : "Local production active"}</strong>
        {providerStatus.steps.map((step) => (
          <span key={step.id}>
            <span className={`live-dot ${step.status}`} />
            {step.provider}
          </span>
        ))}
      </div>
    </aside>
  );
}

function Topbar({
  factory,
  providerStatus,
  backendStatus,
  productionReady,
  productionDisabled,
  onGenerateBatch,
  onProduceVideos,
  onSaveProject,
  onDuplicateProject,
  onOpenSettings,
  onToggleNotifications,
  isGenerating,
  isProducing,
  notificationsOpen,
  onNotice
}: {
  factory: FactoryState;
  providerStatus: ProviderStatus;
  backendStatus: "checking" | "online" | "offline";
  productionReady: boolean;
  productionDisabled: boolean;
  onGenerateBatch: () => void | Promise<void>;
  onProduceVideos: () => void | Promise<void>;
  onSaveProject: () => void | Promise<void>;
  onDuplicateProject: () => void | Promise<void>;
  onOpenSettings: () => void;
  onToggleNotifications: () => void;
  isGenerating: boolean;
  isProducing: boolean;
  notificationsOpen: boolean;
  onNotice: (message: string) => void;
}) {
  const configured = providerStatus.api_key.configured || providerStatus.account_auth.configured || Boolean(providerStatus.local_llm?.configured);
  const providerLabel = providerStatus.account_auth.configured
    ? "ChatGPT account ready"
    : providerStatus.api_key.configured
      ? "OpenAI director ready"
      : providerStatus.local_llm?.configured
        ? "Local LLM ready"
        : "Local production active";
  const backendLabel = backendStatus === "online" ? "API online" : backendStatus === "checking" ? "API checking" : "API offline";
  return (
    <header className="topbar">
      <div className="current-recipe">
        <span>Current Recipe</span>
        <strong>{factory.recipe.source_summary}</strong>
        <ChevronDown size={16} />
      </div>
      <div className="topbar-actions">
        <button className="provider-chip" onClick={() => onNotice(providerLabel)} type="button">
          <span className={`live-dot ${configured ? "ready" : "mock"}`} />
          {providerLabel}
          <ChevronDown size={15} />
        </button>
        <button className="provider-chip backend-chip" onClick={() => onNotice(backendLabel)} type="button">
          <span className={`live-dot ${backendStatus === "online" ? "ready" : "mock"}`} />
          {backendLabel}
        </button>
        <button className="icon-button" aria-label="Settings" onClick={onOpenSettings} type="button">
          <Settings size={18} />
        </button>
        <button className={`icon-button ${notificationsOpen ? "active" : ""}`} aria-label="Notifications" onClick={onToggleNotifications} type="button">
          <Bell size={18} />
        </button>
        <button className="ghost-button" onClick={() => void onDuplicateProject()} type="button">
          <Copy size={16} />
          Duplicate
        </button>
        <button className="ghost-button" onClick={() => void onSaveProject()} type="button">
          <Save size={16} />
          Save
        </button>
        <button className="primary-button" onClick={onGenerateBatch} type="button" disabled={isGenerating}>
          {isGenerating ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
          Generate batch
        </button>
            <button
              className="primary-button production-button"
              id="produce-button-topbar"
              onClick={onProduceVideos}
              type="button"
              aria-disabled={productionDisabled}
              title={productionDisabled
                ? "Production workflow is busy..."
                : productionReady
                  ? "Create and render all requested episodes"
                  : "Connect to the backend API and create content plus video"
              }
              aria-label="Create content and render videos"
              data-testid="produce-button-topbar"
            >
          {isProducing ? <Loader2 className="spin" size={17} /> : <Clapperboard size={17} />}
          Create content + video
        </button>
      </div>
    </header>
  );
}

function NotificationsPanel({
  backendStatus,
  readiness,
  launchPreflight,
  onClose
}: {
  backendStatus: "checking" | "online" | "offline";
  readiness: ProductReadiness | null;
  launchPreflight: LaunchPreflight | null;
  onClose: () => void;
}) {
  const blockers = launchPreflight?.blockers ?? readiness?.summary.launch_blockers ?? [];
  const artifacts = launchPreflight?.artifacts;
  const generatedAt = launchPreflight?.generated_at ?? readiness?.generated_at;
  const status = backendStatus !== "online"
    ? "Backend offline"
    : launchPreflight?.launch_ready
      ? "Commercial ready"
      : readiness?.ready
        ? "Local production ready"
        : "Needs production";

  return (
    <section className="notification-panel" aria-label="Notifications">
      <div className="notification-header">
        <div>
          <span>Notifications</span>
          <strong>{status}</strong>
        </div>
        <button className="icon-button" aria-label="Close notifications" onClick={onClose} type="button">
          <ChevronRight size={18} />
        </button>
      </div>
      {backendStatus !== "online" ? (
        <p>Start the backend API to inspect production artifacts and launch gates.</p>
      ) : (
        <>
          <div className="notification-metrics">
            <span>{artifacts?.content_count ?? readiness?.summary.content_count ?? 0} drafts</span>
            <span>{artifacts?.rendered_count ?? readiness?.summary.rendered_count ?? 0} MP4s</span>
            <span>{artifacts?.image2_handoff_count ?? readiness?.summary.image2_handoff_count ?? 0} Image 2 handoffs</span>
            <span>{artifacts?.image2_asset_count ?? readiness?.summary.image2_asset_count ?? 0} Image 2 assets</span>
            <span>{formatBytes(artifacts?.production_package_bytes ?? readiness?.summary.production_package_bytes ?? 0)} package</span>
          </div>
          {blockers.length > 0 ? (
            <div className="notification-list">
              {blockers.map((blocker) => (
                <div className="notification-item" key={blocker}>
                  <span className="readiness-state warn" />
                  <span>{blocker}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="notification-item">
              <span className="readiness-state pass" />
              <span>No launch blockers reported.</span>
            </div>
          )}
          {generatedAt && <small>Last check {new Date(generatedAt).toLocaleString()}</small>}
        </>
      )}
    </section>
  );
}

function ProviderReadinessCard({ providerStatus }: { providerStatus: ProviderStatus }) {
  return (
    <div className="provider-readiness">
      <div>
        <span>Recommended method</span>
        <strong>{providerStatus.recommended_mode}</strong>
      </div>
      <div className="provider-steps">
        {providerStatus.steps.map((step) => (
          <div className="provider-step" key={step.id} title={step.role}>
            <span className={`live-dot ${step.status}`} />
            <span>{step.label}</span>
            <strong>{providerStepLabels[step.status]}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProviderDiagnosticsCard({ diagnostic }: { diagnostic: string }) {
  if (!diagnostic) return null;

  const normalized = diagnostic.toLowerCase();
  const label = normalized.includes("insufficient_quota")
    ? "OpenAI quota/billing"
    : normalized.includes("rate_limit")
      ? "OpenAI rate limit"
      : normalized.includes("openai")
        ? "OpenAI fallback"
        : "Provider fallback";

  return (
    <div className="provider-diagnostic" role="status" title={diagnostic}>
      <div>
        <span>Provider diagnostic</span>
        <strong>{label}</strong>
      </div>
      <p>{diagnostic}</p>
    </div>
  );
}

function providerFailureLabel(errorClass?: OpenAiLiveCheck["error_class"]) {
  switch (errorClass) {
    case "missing_key":
      return "OPENAI_API_KEY is not configured";
    case "quota":
      return "quota or billing is not available";
    case "rate_limit":
      return "the provider is rate limited";
    case "auth":
      return "the API key was rejected";
    case "access":
      return "the selected model or endpoint is not available";
    case "network":
      return "the backend could not reach OpenAI";
    default:
      return "the provider returned an API error";
  }
}

function ollamaFailureLabel(errorClass?: OllamaLiveCheck["error_class"]) {
  switch (errorClass) {
    case "missing_model":
      return "the configured model is not installed";
    case "network":
      return "Ollama is not reachable";
    default:
      return "the local LLM returned an API error";
  }
}

function ProductReadinessCard({
  readiness,
  backendStatus
}: {
  readiness: ProductReadiness | null;
  backendStatus: "checking" | "online" | "offline";
}) {
  const checks = readiness?.checks ?? [];
  const launchBlockers = readiness?.summary.launch_blockers ?? [];
  const readyLabel = backendStatus !== "online"
    ? "API offline"
    : readiness?.commercial_ready
      ? "Commercial ready"
      : readiness?.ready
        ? "Local production ready"
        : "Needs artifacts";

  return (
    <div className={`product-readiness ${readiness?.ready ? "ready" : "needs-work"}`}>
      <div className="readiness-heading">
        <span>Product readiness</span>
        <strong>{readyLabel}</strong>
      </div>
      {backendStatus !== "online" ? (
        <p>Start the backend API to inspect generated content, MP4 files, bundles, and package output.</p>
      ) : checks.length ? (
        <>
          {launchBlockers.length > 0 && (
            <p className="launch-note">Commercial launch gates remain: {launchBlockers.join(" ")}</p>
          )}
          <div className="readiness-checks">
            {checks.map((check) => (
              <div className={`readiness-check ${check.commercial ? "commercial" : ""}`} key={check.id} title={check.summary}>
                <span className={`readiness-state ${check.status}`} />
                <span>{check.label}</span>
                <strong>{formatReadinessStatus(check)}</strong>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p>Checking production artifacts...</p>
      )}
    </div>
  );
}

function LaunchPreflightCard({
  preflight,
  backendStatus
}: {
  preflight: LaunchPreflight | null;
  backendStatus: "checking" | "online" | "offline";
}) {
  const statusLabel = backendStatus !== "online"
    ? "API offline"
    : preflight?.launch_ready
      ? "Launch ready"
      : preflight?.local_production_ready
        ? "Gates pending"
        : "Needs production";

  return (
    <div className={`launch-preflight ${preflight?.launch_ready ? "ready" : "pending"}`}>
      <div className="readiness-heading">
        <span>Launch preflight</span>
        <strong>{statusLabel}</strong>
      </div>
      {backendStatus !== "online" ? (
        <p>Start the backend API to inspect ChatGPT launch gates.</p>
      ) : preflight ? (
        <>
          <div className="launch-meta">
            <span>{preflight.recommended_provider}</span>
            <span>{preflight.image_model}</span>
            <span>{preflight.uses_image_api_key ? "API image" : "Account image"}</span>
          </div>
          <div className="readiness-checks">
            {preflight.stages.map((stage) => (
              <div className="readiness-check commercial" key={stage.id} title={stage.summary}>
                <span className={`readiness-state ${stage.status === "pass" ? "pass" : "warn"}`} />
                <span>{stage.label}</span>
                <strong>{stage.status === "pass" ? "Ready" : "Gate"}</strong>
              </div>
            ))}
          </div>
          {preflight.blockers.length > 0 && (
            <p className="launch-note">{preflight.blockers.slice(0, 2).join(" ")}</p>
          )}
        </>
      ) : (
        <p>Checking launch preflight...</p>
      )}
    </div>
  );
}

function LaunchConfigEditor({
  draft,
  config,
  smokeTest,
  disabled,
  saving,
  runningSmokeTest,
  onChange,
  onSave,
  onRunSmokeTest
}: {
  draft: LaunchConfigDraft;
  config: LaunchConfig;
  smokeTest: LaunchSmokeTest | null;
  disabled: boolean;
  saving: boolean;
  runningSmokeTest: boolean;
  onChange: (draft: LaunchConfigDraft) => void;
  onSave: () => void;
  onRunSmokeTest: () => void;
}) {
  const updateField = <Key extends keyof LaunchConfigDraft>(field: Key, value: LaunchConfigDraft[Key]) => {
    onChange({ ...draft, [field]: value });
  };
  const localSmoke = smokeTest?.targets.find((target) => target.id === "local-contract") ?? null;
  const publicSmoke = smokeTest?.targets.find((target) => target.id === "public-contract") ?? null;
  const oauthSmoke = smokeTest?.targets.find((target) => target.id === "oauth-provider") ?? null;
  const smokeBlockers = smokeTest?.blockers ?? [];

  return (
    <div className="launch-config-editor" aria-label="Commercial launch configuration">
      <div className="readiness-heading">
        <span>Commercial launch</span>
        <strong>{config.status.missing.length === 0 ? "Configured" : `${config.status.missing.length} gates`}</strong>
      </div>
      <div className="launch-config-grid">
        <label>
          Public MCP origin
          <input
            data-testid="public-mcp-origin-input"
            type="url"
            value={draft.public_mcp_origin}
            onChange={(event) => updateField("public_mcp_origin", event.target.value)}
            placeholder="https://mcp.example.com"
          />
        </label>
        <label>
          OAuth issuer
          <input
            type="url"
            value={draft.oauth_issuer}
            onChange={(event) => updateField("oauth_issuer", event.target.value)}
            placeholder="https://auth.example.com"
          />
        </label>
        <label>
          OAuth JWKS URI
          <input
            type="url"
            value={draft.oauth_jwks_uri}
            onChange={(event) => updateField("oauth_jwks_uri", event.target.value)}
            placeholder="https://auth.example.com/.well-known/jwks.json"
          />
        </label>
        <label>
          OAuth audience
          <input
            type="url"
            value={draft.oauth_audience}
            onChange={(event) => updateField("oauth_audience", event.target.value)}
            placeholder="https://mcp.example.com/mcp"
          />
        </label>
      </div>
      <details className="launch-config-optional">
        <summary>OAuth endpoints</summary>
        <div className="launch-config-grid">
          <label>
            Authorize URL
            <input type="url" value={draft.oauth_authorize_url} onChange={(event) => updateField("oauth_authorize_url", event.target.value)} placeholder="https://auth.example.com/authorize" />
          </label>
          <label>
            Token URL
            <input type="url" value={draft.oauth_token_url} onChange={(event) => updateField("oauth_token_url", event.target.value)} placeholder="https://auth.example.com/token" />
          </label>
          <label>
            Register URL
            <input type="url" value={draft.oauth_register_url} onChange={(event) => updateField("oauth_register_url", event.target.value)} placeholder="https://auth.example.com/register" />
          </label>
          <label>
            Metadata URL
            <input type="url" value={draft.oauth_metadata_url} onChange={(event) => updateField("oauth_metadata_url", event.target.value)} placeholder="https://auth.example.com/.well-known/oauth-authorization-server" />
          </label>
        </div>
      </details>
      <label className="launch-toggle">
        <input
          type="checkbox"
          checked={draft.chatgpt_app_registered}
          onChange={(event) => updateField("chatgpt_app_registered", event.target.checked)}
        />
        <span>ChatGPT app registered</span>
      </label>
      <div className="launch-config-status">
        <span><span className={`readiness-state ${config.status.public_mcp_origin_configured ? "pass" : "warn"}`} /> Public MCP</span>
        <span><span className={`readiness-state ${config.status.production_oauth_configured ? "pass" : "warn"}`} /> OAuth/JWKS</span>
        <span><span className={`readiness-state ${config.status.chatgpt_app_registered ? "pass" : "warn"}`} /> ChatGPT registration</span>
      </div>
      <div className={`launch-smoke-status ${smokeTest?.smoke_ready ? "ready" : ""}`} aria-label="Launch smoke test status">
        <div className="readiness-heading">
          <span>ChatGPT app smoke test</span>
          <strong>{smokeTest ? (smokeTest.smoke_ready ? "Passed" : "Gates") : "Not run"}</strong>
        </div>
        <div className="launch-meta">
          <span>{smokeTest?.recommended_provider ?? "chatgpt-account"}</span>
          <span>{smokeTest?.image_model ?? "gpt-image-2"}</span>
          <span>{smokeTest?.uses_image_api_key ? "API image" : "Account image"}</span>
        </div>
        <div className="launch-config-status smoke">
          <span><span className={`readiness-state ${localSmoke?.ready ? "pass" : "warn"}`} /> Local MCP</span>
          <span><span className={`readiness-state ${publicSmoke?.ready ? "pass" : "warn"}`} /> Public MCP</span>
          <span><span className={`readiness-state ${oauthSmoke?.ready ? "pass" : "warn"}`} /> OAuth provider</span>
          <span><span className={`readiness-state ${smokeTest && !smokeTest.uses_image_api_key ? "pass" : "warn"}`} /> Image 2 auth</span>
        </div>
        {smokeBlockers.length > 0 ? (
          <p className="launch-note">{smokeBlockers.slice(0, 2).join(" ")}</p>
        ) : smokeTest ? (
          <p className="launch-note pass">Local MCP, public MCP, and OAuth provider are smoke-tested.</p>
        ) : (
          <p className="launch-note">Run this after saving launch metadata to verify the ChatGPT app manifest, MCP tools, OAuth provider metadata/JWKS, and widget resource.</p>
        )}
      </div>
      <button className="primary-button full" data-testid="save-launch-config" type="button" disabled={disabled} onClick={onSave}>
        {saving ? <Loader2 className="spin" size={17} /> : <Save size={17} />}
        Save launch config
      </button>
      <button className="wide-command" data-testid="run-launch-smoke-test" type="button" disabled={disabled || runningSmokeTest} onClick={onRunSmokeTest}>
        <span>
          {runningSmokeTest ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
          Run launch smoke test
        </span>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

function JobTimeline({ jobs, onNotice }: { jobs: GenerationJob[]; onNotice: (message: string) => void }) {
  return (
    <section className="panel timeline-panel workspace-target" id="workspace-queue" aria-label="Job timeline">
      <div className="panel-header">
        <h2>Job state timeline</h2>
        <button className="ghost-button" onClick={() => onNotice("Queue timeline is visible in this panel.")} type="button">View in Queue</button>
      </div>
      <div className="timeline">
        {jobs.map((job) => (
          <div className={`timeline-step ${job.status}`} key={job.id}>
            <span className="timeline-dot">{job.status === "complete" ? <Check size={16} /> : job.status === "active" ? <Loader2 size={16} /> : job.count}</span>
            <strong>{job.label}</strong>
            <small>{job.count} item{job.count === 1 ? "" : "s"}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function PreviewPanel({
  episode,
  onRender,
  onReview,
  onExportCaptions,
  onCopyHashtags,
  onBuildBundle,
  onAttachImage2Assets,
  isUploadingImage2Assets,
  artifactVideoUrl,
  bundleManifestUrl,
  image2HandoffUrl,
  image2AssetManifestUrl,
  onNotice
}: {
  episode: Episode;
  onRender: (episodeId: string) => void | Promise<void>;
  onReview: (episodeId: string, gate: ReviewGate) => void | Promise<void>;
  onExportCaptions: (episode: Episode) => void;
  onCopyHashtags: (episode: Episode) => void | Promise<void>;
  onBuildBundle: (episodeId: string) => void | Promise<void>;
  onAttachImage2Assets: (episodeId: string, files: FileList | null) => void | Promise<void>;
  isUploadingImage2Assets: boolean;
  artifactVideoUrl: string;
  bundleManifestUrl: string;
  image2HandoffUrl: string;
  image2AssetManifestUrl: string;
  onNotice: (message: string) => void;
}) {
  const image2InputRef = useRef<HTMLInputElement | null>(null);
  const canOpenRenderedArtifact = Boolean(artifactVideoUrl && episode.status === "rendered");
  return (
    <section className="panel preview-panel workspace-target" id="workspace-exports">
      <div className="panel-header">
        <h2>Preview</h2>
        <div className="ratio-chip">9:16</div>
      </div>
      <div className="phone-preview">
        {artifactVideoUrl && episode.status === "rendered" ? (
          <video className="rendered-video" src={artifactVideoUrl} controls poster={episode.poster_path} />
        ) : (
          <>
            <img src={episode.poster_path} alt={`${episode.title} preview`} />
            <div className="video-overlay">
              <button className="play-button" aria-label="Play preview" onClick={() => onNotice("Static preview selected. Render MP4 to play the generated video artifact.")} type="button">
                <Play size={28} fill="currentColor" />
              </button>
              <div className="caption-burn">
                <span>{episode.captions[1]?.text ?? "UNFORTUNATELY"}</span>
                <strong>{episode.captions[2]?.text ?? "ONE DETAIL"}</strong>
              </div>
            </div>
          </>
        )}
        {artifactVideoUrl && episode.status === "rendered" && (
          <div className="production-note">
            <BadgeCheck size={15} />
            Playable backend MP4
          </div>
        )}
      </div>
      <div className="episode-inspector">
        <div className="inspector-title">
          <div>
            <span>{episode.id.replace("episode-", "Episode ")}</span>
            <strong>{episode.title}</strong>
          </div>
          <select value={episode.review_gate} onChange={(event) => onReview(episode.id, event.target.value as ReviewGate)}>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="returned">Returned</option>
          </select>
        </div>
        <dl className="meta-grid">
          <div>
            <dt>Duration</dt>
            <dd>0:{String(episode.duration_seconds).padStart(2, "0")}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{statusLabels[episode.status]}</dd>
          </div>
          <div>
            <dt>Output</dt>
            <dd>{episode.output_path}</dd>
          </div>
        </dl>
      </div>
      <button className="primary-button full" onClick={() => onRender(episode.id)} type="button">
        <ArrowDownToLine size={17} />
        Render MP4
      </button>
      <div className="export-actions">
        <button onClick={() => onExportCaptions(episode)} type="button">
          <Columns3 size={16} />
          Export captions
        </button>
        <button onClick={() => onCopyHashtags(episode)} type="button">
          <Hash size={16} />
          Copy hashtags
        </button>
        <button className="bundle-action" onClick={() => onBuildBundle(episode.id)} type="button">
          <FolderOpen size={16} />
          Build publish bundle
        </button>
        <button
          className="image2-asset-action"
          onClick={() => image2InputRef.current?.click()}
          type="button"
          disabled={isUploadingImage2Assets}
        >
          {isUploadingImage2Assets ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
          {isUploadingImage2Assets ? "Attaching Image 2" : "Attach Image 2 stills"}
        </button>
        <input
          ref={image2InputRef}
          className="hidden-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={(event) => {
            const files = event.currentTarget.files;
            void onAttachImage2Assets(episode.id, files);
            event.currentTarget.value = "";
          }}
        />
        {canOpenRenderedArtifact && (
          <>
            <a className="artifact-action" href={artifactVideoUrl} target="_blank" rel="noreferrer">
              <Play size={16} />
              Open MP4
            </a>
            <a className="artifact-action" href={artifactVideoUrl} download={`${episode.id}.mp4`}>
              <ArrowDownToLine size={16} />
              Download MP4
            </a>
          </>
        )}
        {bundleManifestUrl && episode.status === "rendered" && (
          <a className="artifact-action" href={bundleManifestUrl} target="_blank" rel="noreferrer">
            <FileJson2 size={16} />
            Open manifest
          </a>
        )}
        {image2HandoffUrl && episode.status === "rendered" && (
          <a className="artifact-action" href={image2HandoffUrl} target="_blank" rel="noreferrer">
            <Sparkles size={16} />
            Image 2 handoff
          </a>
        )}
        {image2AssetManifestUrl && episode.status === "rendered" && (
          <a className="artifact-action image2-manifest-action" href={image2AssetManifestUrl} target="_blank" rel="noreferrer">
            <FileJson2 size={16} />
            Image 2 assets
          </a>
        )}
      </div>
      <div className="hashtag-list">
        {episode.hashtags.map((hashtag) => (
          <span key={hashtag}>{hashtag}</span>
        ))}
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: EpisodeStatus }) {
  return <span className={`status-pill ${status}`}>{statusLabels[status]}</span>;
}

function ReviewPill({ gate }: { gate: ReviewGate }) {
  return <span className={`review-pill ${gate}`}>{reviewLabels[gate]}</span>;
}

function recalculateJobs(episodes: Episode[]): GenerationJob[] {
  return [
    { id: "queued", label: "Queued", status: "complete", count: episodes.length },
    { id: "analyzing", label: "Analyzing", status: "complete", count: 1 },
    { id: "generating", label: "Generating", status: episodes.some((episode) => episode.status === "generated") ? "active" : "pending", count: episodes.filter((episode) => episode.status === "generated").length },
    { id: "rendering", label: "Rendering", status: episodes.some((episode) => episode.status === "rendering") ? "active" : "pending", count: episodes.filter((episode) => episode.status === "rendering").length },
    { id: "review", label: "Review gate", status: episodes.some((episode) => episode.review_gate === "pending") ? "pending" : "complete", count: episodes.filter((episode) => episode.review_gate === "pending").length },
    { id: "completed", label: "Completed", status: "pending", count: episodes.filter((episode) => episode.status === "rendered").length }
  ];
}

function createUiEpisode(index: number, projectId: string, topic: string): Episode {
  const id = `episode-${String(index).padStart(3, "0")}`;
  const world = buildUiTopicWorld(topic);
  const subject = toUiTitleCase(world);
  const templates = [
    {
      title: `The ${subject} Hid the First Clue`,
      hook: `Nobody expected the ${world} to reveal the missing detail.`
    },
    {
      title: `A ${subject} Witness Changed Everything`,
      hook: `The room froze when the ${world} told a different story.`
    },
    {
      title: `The ${subject} Had No Alibi`,
      hook: "Every answer made sense until the smallest clue disappeared."
    }
  ];
  const template = templates[(index - 1) % templates.length];
  const topicLabel = buildUiTopicLabel(topic);

  return {
    id,
    title: template.title,
    source_topic: topic,
    hook: template.hook,
    world,
    genre: `${topicLabel} short drama`,
    visual_style: `vertical 3D ${topicLabel} short-drama scene`,
    duration_seconds: 26,
    status: "generated",
    review_gate: "pending",
    created_at: new Date().toISOString(),
    output_path: `outputs/${projectId}/${id}/final.mp4`,
    metadata_path: `outputs/${projectId}/${id}/metadata.json`,
    captions_path: `outputs/${projectId}/${id}/captions.srt`,
    poster_path: "/assets/fruit-drama-preview.png",
    hashtags: ["#aistory", "#shorts", "#originalvideo", `#${world.replace(/[^a-z0-9]+/g, "")}`, "#recipefactory"],
    captions: [
      { start: 0, end: 3.2, text: "NEW RECIPE" },
      { start: 4.5, end: 7.7, text: "SAME GENRE" },
      { start: 9, end: 12.2, text: "NEW STORY" }
    ],
    voiceover: [`In the ${world}, nobody expected this.`, template.hook, "The answer is in part two."],
    shots: [],
    ai_disclosure: "This draft contains AI-generated visuals, voice, and captions.",
    recipe_snapshot: "Reference-to-Video Factory"
  };
}

function buildUiTopicWorld(topic: string): string {
  const words = normalizeUiTopic(topic)
    .split(" ")
    .filter((word) => !["ai", "short", "video", "vertical", "drama", "story"].includes(word));
  return words.slice(0, 4).join(" ") || buildUiTopicLabel(topic);
}

function buildUiTopicLabel(topic: string): string {
  return normalizeUiTopic(topic).replace(/^ai\s+/, "").trim() || "original remix drama";
}

function normalizeUiTopic(topic: string): string {
  return String(topic || "AI cartoon fruit drama")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toUiTitleCase(text: string): string {
  return text
    .split(" ")
    .filter(Boolean)
    .map((word) => (word === "ai" ? "AI" : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join(" ");
}

function getProviderStatus(factory: FactoryState): ProviderStatus {
  const fallback = fallbackFactoryState.provider_status!;
  const providerStatus = factory.provider_status ?? fallback;
  return {
    ...providerStatus,
    api_key: providerStatus.api_key ?? fallback.api_key,
    local_llm: providerStatus.local_llm ?? fallback.local_llm,
    account_auth: providerStatus.account_auth ?? fallback.account_auth,
    oauth_provider: providerStatus.oauth_provider ?? fallback.oauth_provider,
    mcp_app: providerStatus.mcp_app ?? fallback.mcp_app,
    steps: providerStatus.steps?.length ? providerStatus.steps : fallback.steps
  };
}

function formatReadinessStatus(check: ProductReadiness["checks"][number]) {
  if (check.status === "pass") return "Ready";
  if (check.commercial) return "Launch gate";
  if (!check.required) return "Optional";
  return "Missing";
}

function preferredRequestedProviderMode(factory: FactoryState): RequestedProviderMode {
  const providerStatus = getProviderStatus(factory);
  if (providerStatus.local_llm?.configured || factory.provider_mode === "local-llm") return "ollama";
  if (providerStatus.api_key.configured || factory.provider_mode === "live") return "openai";
  if (providerStatus.account_auth.configured || factory.provider_mode === "chatgpt-account") return "chatgpt";
  return "local";
}

function launchConfigToDraft(config: LaunchConfig): LaunchConfigDraft {
  return {
    public_mcp_origin: config.public_mcp_origin ?? "",
    oauth_issuer: config.oauth_issuer ?? "",
    oauth_jwks_uri: config.oauth_jwks_uri ?? "",
    oauth_authorize_url: config.oauth_authorize_url ?? "",
    oauth_token_url: config.oauth_token_url ?? "",
    oauth_register_url: config.oauth_register_url ?? "",
    oauth_metadata_url: config.oauth_metadata_url ?? "",
    oauth_audience: config.oauth_audience ?? "",
    chatgpt_app_registered: Boolean(config.chatgpt_app_registered)
  };
}

function buildArtifactUrl(apiBase: string, outputPath: string, version: string): string {
  const match = outputPath.match(/^outputs\/([^/]+)\/([^/]+)\/final\.mp4$/);
  if (!match) return "";
  return `${buildApiUrl(apiBase, `/artifact/${match[1]}/${match[2]}/final.mp4?v=${encodeURIComponent(version)}`)}`;
}

function buildBundleManifestUrl(apiBase: string, projectId: string, episodeId: string, version: string): string {
  return `${buildApiUrl(apiBase, `/artifact/${encodeURIComponent(projectId)}/${encodeURIComponent(episodeId)}/publish-bundle/manifest.json?v=${encodeURIComponent(version)}`)}`;
}

function buildImage2HandoffUrl(apiBase: string, projectId: string, episodeId: string, version: string): string {
  return `${buildApiUrl(apiBase, `/artifact/${encodeURIComponent(projectId)}/${encodeURIComponent(episodeId)}/publish-bundle/image2-handoff.json?v=${encodeURIComponent(version)}`)}`;
}

function buildImage2AssetManifestUrl(apiBase: string, projectId: string, episodeId: string, version: string): string {
  return `${buildApiUrl(apiBase, `/artifact/${encodeURIComponent(projectId)}/${encodeURIComponent(episodeId)}/image2-assets/manifest.json?v=${encodeURIComponent(version)}`)}`;
}

function buildReferenceAssetUrl(apiBase: string, projectId: string, storedName: string, version: string): string {
  return `${buildApiUrl(apiBase, `/artifact/${encodeURIComponent(projectId)}/reference/${encodeURIComponent(storedName)}?v=${encodeURIComponent(version)}`)}`;
}

function buildBatchManifestUrl(apiBase: string, projectId: string, version: string): string {
  return `${buildApiUrl(apiBase, `/artifact/${encodeURIComponent(projectId)}/production-manifest.json?v=${encodeURIComponent(version)}`)}`;
}

function buildProductionPackageUrl(apiBase: string, projectId: string, version: string): string {
  return `${buildApiUrl(apiBase, `/artifact/${encodeURIComponent(projectId)}/production-package.tar.gz?v=${encodeURIComponent(version)}`)}`;
}

function buildChatGptAppManifestUrl(apiBase: string, version: string): string {
  return `${buildApiUrl(apiBase, `/chatgpt/app-manifest?v=${encodeURIComponent(version)}`)}`;
}

function buildOAuthMetadataUrl(apiBase: string, version: string): string {
  return `${apiOrigin(apiBase)}/.well-known/oauth-protected-resource?v=${encodeURIComponent(version)}`;
}

function buildOAuthServerMetadataUrl(apiBase: string, version: string): string {
  return `${apiOrigin(apiBase)}/oauth-placeholder/.well-known/oauth-authorization-server?v=${encodeURIComponent(version)}`;
}

function buildApiUrl(apiBase: string, path: string): string {
  const origin = apiOrigin(ensureApiBase(apiBase));
  const normalizedPath = String(path).replace(/^\/+/, "");
  return `${origin}/api/${normalizedPath}`;
}

async function loadInitialState(request: <T = unknown>(path: string, options?: RequestInit) => Promise<T>): Promise<{ state: FactoryState; backend: boolean; readiness: ProductReadiness | null; launchPreflight: LaunchPreflight | null; launchConfig: LaunchConfig | null }> {
  try {
    const backendProject = await request<{ project: FactoryState }>("/project");
    const [readinessResult, launchPreflightResult, providersResult, launchConfigResult] = await Promise.allSettled([
      request<ProductReadiness>("/readiness"),
      request<LaunchPreflight>("/launch-preflight"),
      request<{ provider_status: ProviderStatus }>("/providers"),
      request<{ launch_config: LaunchConfig }>("/launch-config")
    ]);

    const readiness = readinessResult.status === "fulfilled" ? readinessResult.value : null;
    const launchPreflight = launchPreflightResult.status === "fulfilled" ? launchPreflightResult.value : null;
    const providers = providersResult.status === "fulfilled" ? providersResult.value : null;
    const launchConfig = launchConfigResult.status === "fulfilled" ? launchConfigResult.value.launch_config : null;
    return {
      state: providers?.provider_status ? { ...backendProject.project, provider_status: providers.provider_status } : backendProject.project,
      backend: true,
      readiness,
      launchPreflight,
      launchConfig
    };
  } catch {
    const response = await fetch("/factory-state.json", { cache: "no-store" });
    return { state: response.ok ? await response.json() : fallbackFactoryState, backend: false, readiness: null, launchPreflight: null, launchConfig: null };
  }
}

async function apiRequest<T = unknown>(path: string, options: ApiRequestOptions = {}, setBase?: (base: string) => void): Promise<T> {
  const candidates = getApiBaseCandidates();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  let lastError: Error | null = null;
  const tried = new Set<string>();
  const method = (options.method || "GET").toUpperCase();
  const headers = options.headers && typeof options.headers === "object"
    ? { ...(options.headers as Record<string, string>) }
    : {};
  const { timeoutMs, ...requestOptions } = options;

  const requestHeaders = method === "GET" || method === "HEAD"
    ? headers
    : { "Content-Type": "application/json", ...headers };

  for (const candidate of [ensureApiBase(activeApiBase), ...candidates]) {
    const apiBaseCandidate = ensureApiBase(candidate);
    if (tried.has(apiBaseCandidate)) continue;
    tried.add(apiBaseCandidate);

    const controller = timeoutMs && Number.isFinite(timeoutMs) && timeoutMs > 0 ? new AbortController() : null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    if (controller && timeoutMs != null) {
      timeoutHandle = setTimeout(() => {
        controller.abort(new DOMException("Request timed out", "TimeoutError"));
      }, timeoutMs);
    }

    try {
      const response = await fetch(`${apiBaseCandidate}${normalizedPath}`, {
        cache: "no-store",
        ...requestOptions,
        signal: controller?.signal,
        method,
        headers: requestHeaders
      });
      if (timeoutHandle) clearTimeout(timeoutHandle);

      const bodyText = await response.text().catch(() => "");

      if (!response.ok) {
        const shouldRetry = response.status === 404 || response.status >= 500;
        if (shouldRetry) {
          lastError = new Error(`API request failed with ${response.status}: ${bodyText}`);
          continue;
        }

        throw new Error(`API request failed with ${response.status}: ${bodyText}`);
      }

      try {
        const payload = bodyText ? (JSON.parse(bodyText) as T) : ({} as T);
        activeApiBase = apiBaseCandidate;
        if (setBase) setBase(apiBaseCandidate);
        return payload;
      } catch {
        lastError = new Error(`Invalid JSON response from ${apiBaseCandidate}: ${bodyText}`);
        continue;
      }
    } catch (error) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (
        error instanceof DOMException
        && (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        lastError = new Error(`API request timed out after ${timeoutMs}ms on ${apiBaseCandidate}`);
        continue;
      }
      lastError = error instanceof Error ? error : new Error("Unknown API request failure");
      const text = `${lastError.message}`;
      if (
        text.includes("Failed to fetch") ||
        text.includes("NetworkError") ||
        text.includes("Network request failed") ||
        text.includes("timed out") ||
        text.includes("TimeoutError")
      ) {
        continue;
      }
      // Unexpected errors for a reachable backend are surfaced immediately.
      break;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  throw lastError ?? new Error("API request failed for all configured bases");
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
}

function imageMimeTypeForFile(file: File): string {
  if (["image/png", "image/jpeg", "image/webp"].includes(file.type)) return file.type;
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) return "image/jpeg";
  if (lowerName.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function captionsToSrt(captions: Episode["captions"]) {
  return captions
    .map((caption, index) => `${index + 1}\n${formatSrtTime(caption.start)} --> ${formatSrtTime(caption.end)}\n${caption.text}\n`)
    .join("\n");
}

function formatSrtTime(seconds: number) {
  const ms = Math.round((seconds % 1) * 1000);
  const whole = Math.floor(seconds);
  const s = whole % 60;
  const m = Math.floor(whole / 60) % 60;
  const h = Math.floor(whole / 3600);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function clampEpisodeCount(value: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 5;
  return Math.max(1, Math.min(Math.floor(numeric), 12));
}

function clampProductionCount(value: string, episodeCount: number) {
  if (!value.trim()) return episodeCount;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return episodeCount;
  return Math.max(1, Math.min(Math.floor(numeric), episodeCount));
}

function clampOptionalDuration(value: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.max(1, Math.min(Math.floor(numeric), 60));
}

function readGenerationParams() {
  const params = new URLSearchParams(window.location.search);
  const source = params.get("source")?.toLowerCase();
  const sourceMode =
    source === "text" || source === "text idea"
      ? "Text idea"
      : source === "screenshot"
        ? "Screenshot"
        : source === "video" || source === "reference video"
          ? "Reference video"
          : null;

  return {
    topic: params.get("topic")?.trim() || null,
    count: params.get("count")?.trim() || null,
    sourceMode
  };
}

async function copyTextToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}
