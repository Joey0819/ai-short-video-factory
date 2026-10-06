import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { buildPublishBundle } from "./artifact-bundle.mjs";
import {
  CHATGPT_APP_MANIFEST_PATH,
  CHATGPT_WIDGET_PATH,
  MCP_ENDPOINT_PATH,
  OAUTH_PROTECTED_RESOURCE_PATH,
  buildChatGptAppManifest,
  buildChatGptWidgetHtml,
  buildOAuthProtectedResourceMetadata,
  handleMcpJsonRpc
} from "./chatgpt-app-mcp.mjs";
import {
  OAUTH_AUTHORIZATION_SERVER_METADATA_PATH,
  OAUTH_AUTHORIZE_PATH,
  OAUTH_REGISTER_PATH,
  OAUTH_TOKEN_PATH
} from "./chatgpt-app-constants.mjs";
import {
  buildOAuthAuthorizationServerMetadata,
  createAuthorizationRedirect,
  createOAuthClientRegistration,
  exchangeAuthorizationCode,
  readOAuthRuntimeEnv
} from "./chatgpt-oauth-dev.mjs";
import { DEFAULT_PROJECT_ID, buildJobs, createFactoryProject, writeFactoryProject } from "./factory-core.mjs";
import { applyLaunchConfigToEnv, readChatGptAccountPresence, readLaunchConfig, readOpenAiKeyPresence, resolveProviderReadiness, writeChatGptAccountVerification, writeLaunchConfig } from "./provider-plan.mjs";
import { checkOpenAiLiveAccess, createChatGptAccountDryRunReport, createOpenAiDryRunReport, generateProjectWithOpenAi } from "./openai-director.mjs";
import { checkOllamaLiveAccess, generateProjectWithOllama } from "./ollama-director.mjs";
import { attachImage2Assets } from "./image2-assets.mjs";
import { produceVideos, refreshProductionArtifact } from "./production-pipeline.mjs";
import { resolveProductReadiness } from "./product-readiness.mjs";
import { resolveLaunchPreflight } from "./launch-preflight.mjs";
import { resolveLaunchSmokeTest } from "./launch-smoke-test.mjs";
import { renderMockVideo } from "../scripts/render-mock-video.mjs";

const MAX_REFERENCE_UPLOAD_BYTES = 50 * 1024 * 1024;
const ALLOWED_REFERENCE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "video/webm"
]);

export function createApiServer({ rootDir = process.cwd() } = {}) {
  return http.createServer((request, response) => {
    handleApiRequest(request, response, { rootDir }).catch((error) => {
      sendJson(response, 500, {
        ok: false,
        error: "backend_error",
        message: error instanceof Error ? error.message : "Unknown backend error"
      });
    });
  });
}

export async function handleApiRequest(request, response, { rootDir = process.cwd() } = {}) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method === "OPTIONS") {
    sendJson(response, 204, null);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      service: "ai-short-video-factory",
      project_id: DEFAULT_PROJECT_ID,
      generated_at: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/providers") {
    const readiness = await resolveProviderReadiness({
      envFilePath: path.join(rootDir, ".env.local")
    });
    sendJson(response, 200, { ok: true, provider_status: readiness });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/readiness") {
    sendJson(response, 200, await resolveProductReadiness({ rootDir }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/launch-preflight") {
    sendJson(response, 200, await resolveLaunchPreflight({ rootDir }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/launch-smoke-test") {
    sendJson(response, 200, await resolveLaunchSmokeTest({
      rootDir,
      baseUrl: resolveBaseUrl(request)
    }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/launch-config") {
    sendJson(response, 200, {
      ok: true,
      launch_config: await readLaunchConfig({ envFilePath: path.join(rootDir, ".env.local") })
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/launch-config") {
    const body = await readJsonBody(request);
    try {
      const launchConfig = await writeLaunchConfig({
        config: body,
        envFilePath: path.join(rootDir, ".env.local")
      });
      applyLaunchConfigToEnv(launchConfig);
      const [providerStatus, readiness, launchPreflight] = await Promise.all([
        resolveProviderReadiness({ envFilePath: path.join(rootDir, ".env.local") }),
        resolveProductReadiness({ rootDir }),
        resolveLaunchPreflight({ rootDir })
      ]);
      sendJson(response, 200, {
        ok: true,
        launch_config: launchConfig,
        provider_status: providerStatus,
        readiness,
        launch_preflight: launchPreflight
      });
    } catch (error) {
      if (error?.code === "INVALID_LAUNCH_CONFIG") {
        sendJson(response, 400, {
          ok: false,
          error: "invalid_launch_config",
          message: error.message,
          validation: error.validation ?? []
        });
        return;
      }
      throw error;
    }
    return;
  }

  if (request.method === "GET" && url.pathname === CHATGPT_APP_MANIFEST_PATH) {
    const oauthEnv = await readOAuthRuntimeEnv({ rootDir });
    sendJson(response, 200, {
      ok: true,
      app: buildChatGptAppManifest({ baseUrl: resolveBaseUrl(request), env: oauthEnv })
    });
    return;
  }

  if (request.method === "GET" && url.pathname === OAUTH_PROTECTED_RESOURCE_PATH) {
    const oauthEnv = await readOAuthRuntimeEnv({ rootDir });
    sendJson(response, 200, buildOAuthProtectedResourceMetadata({ baseUrl: resolveBaseUrl(request), env: oauthEnv }));
    return;
  }

  if (request.method === "GET" && url.pathname === OAUTH_AUTHORIZATION_SERVER_METADATA_PATH) {
    sendJson(response, 200, buildOAuthAuthorizationServerMetadata({ baseUrl: resolveBaseUrl(request) }));
    return;
  }

  if (request.method === "GET" && url.pathname === OAUTH_AUTHORIZE_PATH) {
    const result = await createAuthorizationRedirect({
      url: new URL(request.url ?? "/", resolveBaseUrl(request)),
      baseUrl: resolveBaseUrl(request),
      rootDir
    });
    if (result.statusCode === 302) {
      sendRedirect(response, result.statusCode, result.headers);
      return;
    }
    sendHtml(response, result.statusCode, result.html);
    return;
  }

  if (request.method === "POST" && url.pathname === OAUTH_TOKEN_PATH) {
    const body = await readBodyByContentType(request);
    const result = exchangeAuthorizationCode({
      body,
      baseUrl: resolveBaseUrl(request)
    });
    sendJson(response, result.statusCode, result.body);
    return;
  }

  if (request.method === "POST" && url.pathname === OAUTH_REGISTER_PATH) {
    const body = await readBodyByContentType(request);
    sendJson(response, 201, createOAuthClientRegistration({
      body,
      baseUrl: resolveBaseUrl(request)
    }));
    return;
  }

  if (request.method === "GET" && url.pathname === CHATGPT_WIDGET_PATH) {
    sendHtml(response, 200, buildChatGptWidgetHtml({ baseUrl: resolveBaseUrl(request) }), "text/html;profile=mcp-app; charset=utf-8");
    return;
  }

  if (request.method === "POST" && url.pathname === MCP_ENDPOINT_PATH) {
    const body = await readJsonBody(request);
    const oauthEnv = await readOAuthRuntimeEnv({ rootDir });
    const result = await handleMcpJsonRpc({
      message: body,
      rootDir,
      baseUrl: resolveBaseUrl(request),
      authorization: request.headers.authorization ?? "",
      env: oauthEnv
    });
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/openai/dry-run") {
    const body = await readJsonBody(request);
    const keyPresence = await readOpenAiKeyPresence({
      envFilePath: path.join(rootDir, ".env.local")
    });
    sendJson(response, 200, createOpenAiDryRunReport({
      topic: normalizeText(body.topic, "AI cartoon fruit drama"),
      count: normalizeCount(body.count, 5),
      sourceType: normalizeText(body.sourceType, "text idea"),
      openAiConfigured: keyPresence.configured
    }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/openai/live-check") {
    const keyPresence = await readOpenAiKeyPresence({
      envFilePath: path.join(rootDir, ".env.local")
    });
    if (!keyPresence.configured) {
      sendJson(response, 200, await checkOpenAiLiveAccess({ apiKey: "" }));
      return;
    }

    sendJson(response, 200, await checkOpenAiLiveAccess({
      apiKey: await readOpenAiKey({ rootDir })
    }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/ollama/live-check") {
    sendJson(response, 200, await checkOllamaLiveAccess());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/chatgpt/account-dry-run") {
    const body = await readJsonBody(request);
    const accountPresence = await readChatGptAccountPresence({
      envFilePath: path.join(rootDir, ".env.local")
    });
    sendJson(response, 200, createChatGptAccountDryRunReport({
      topic: normalizeText(body.topic, "AI cartoon fruit drama"),
      count: normalizeCount(body.count, 5),
      sourceType: normalizeText(body.sourceType, "text idea"),
      accountVerified: accountPresence.configured
    }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/chatgpt/account-verification") {
    const body = await readJsonBody(request);
    if (typeof body.verified !== "boolean") {
      sendJson(response, 400, {
        ok: false,
        error: "invalid_account_verification",
        message: "Provide a boolean verified value."
      });
      return;
    }

    await writeChatGptAccountVerification({
      verified: body.verified,
      envFilePath: path.join(rootDir, ".env.local")
    });
    const providerStatus = await resolveProviderReadiness({
      envFilePath: path.join(rootDir, ".env.local")
    });
    const project = await readCurrentProject(rootDir);
    const updatedProject = {
      ...project,
      generated_at: new Date().toISOString(),
      provider_status: providerStatus,
      providers: providerStatus.steps.map((step) => step.provider),
      provider_mode: providerStatus.account_auth.configured ? "chatgpt-account" : project.provider_mode === "chatgpt-account" ? "local" : project.provider_mode
    };
    await writeFactoryProject(updatedProject, rootDir);
    sendJson(response, 200, {
      ok: true,
      account_verified: providerStatus.account_auth.configured,
      provider_status: providerStatus,
      project: updatedProject
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/project") {
    const project = await readCurrentProject(rootDir);
    sendJson(response, 200, { ok: true, project });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/project/save") {
    const project = await readCurrentProject(rootDir);
    const savedAt = new Date().toISOString();
    const savedProject = {
      ...project,
      generated_at: savedAt
    };
    await writeFactoryProject(savedProject, rootDir);
    const receiptPath = await writeProjectSaveReceipt({ rootDir, project: savedProject, savedAt });
    sendJson(response, 200, {
      ok: true,
      saved_at: savedAt,
      project: savedProject,
      files: {
        dashboard_state: "public/factory-state.json",
        project_state: `storage/projects/${savedProject.id ?? DEFAULT_PROJECT_ID}/project.json`,
        save_receipt: receiptPath
      }
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/project/duplicate") {
    const project = await readCurrentProject(rootDir);
    const duplicatedAt = new Date().toISOString();
    const duplicate = await writeProjectDuplicateSnapshot({ rootDir, project, duplicatedAt });
    sendJson(response, 200, {
      ok: true,
      duplicated_at: duplicatedAt,
      duplicate
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/reference") {
    const body = await readJsonBody(request);
    const project = await readCurrentProject(rootDir);
    const upload = decodeReferenceUpload(body);
    if (!upload.ok) {
      sendJson(response, 400, {
        ok: false,
        error: "invalid_reference_upload",
        message: upload.message
      });
      return;
    }

    const sourceAsset = await writeReferenceAsset({
      rootDir,
      projectId: project.id ?? DEFAULT_PROJECT_ID,
      upload: upload.value
    });
    const updatedProject = {
      ...project,
      generated_at: new Date().toISOString(),
      source_asset: sourceAsset,
      recipe: {
        ...project.recipe,
        source_type: sourceAsset.kind === "image" ? "screenshot" : "reference video"
      }
    };
    await writeFactoryProject(updatedProject, rootDir);
    sendJson(response, 200, {
      ok: true,
      source_asset: sourceAsset,
      project: updatedProject
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/reference/analyze") {
    const body = await readJsonBody(request);
    const project = await readCurrentProject(rootDir);
    const sourceAsset = normalizeSourceAsset(body.sourceAsset) ?? project.source_asset ?? null;
    const topic = normalizeText(body.topic, project.recipe?.source_summary ?? "AI cartoon fruit drama");
    const sourceType = normalizeText(body.sourceType, project.recipe?.source_type ?? "text idea");
    const analysis = buildReferenceAnalysis({
      project,
      topic,
      sourceType,
      sourceAsset
    });
    const nextProject = {
      ...project,
      generated_at: new Date().toISOString(),
      source_asset: sourceAsset ?? project.source_asset ?? null,
      recipe: {
        ...project.recipe,
        source_type: sourceType,
        source_summary: analysis.recipe_source_summary
      },
      source_analysis: analysis
    };
    await writeFactoryProject(nextProject, rootDir);
    sendJson(response, 200, {
      ok: true,
      analysis,
      project: nextProject
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/project/rules") {
    const body = await readJsonBody(request);
    const project = await readCurrentProject(rootDir);
    if (!Array.isArray(body?.originalityRules) || body.originalityRules.length === 0) {
      sendJson(response, 400, {
        ok: false,
        error: "invalid_rules",
        message: "Provide a non-empty array of originalityRules."
      });
      return;
    }

    const originalityRules = body.originalityRules
      .map((rule) => String(rule ?? "").trim())
      .filter((rule) => rule.length > 0);

    if (originalityRules.length === 0) {
      sendJson(response, 400, {
        ok: false,
        error: "invalid_rules",
        message: "Provide at least one non-empty rule."
      });
      return;
    }

    const nextProject = {
      ...project,
      generated_at: new Date().toISOString(),
      recipe: {
        ...(project.recipe ?? {}),
        originality_rules: Array.from(new Set(originalityRules))
      }
    };
    await writeFactoryProject(nextProject, rootDir);
    sendJson(response, 200, { ok: true, project: nextProject });
    return;
  }

  if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/api/artifact/")) {
    await sendArtifact(request, response, { rootDir, url });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/generate") {
    const body = await readJsonBody(request);
    const { project, warnings } = await createProjectFromBody(body, { rootDir });

    await writeFactoryProject(project, rootDir);
    sendJson(response, 200, buildGenerateResponse(project, warnings));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/produce") {
    const body = await readJsonBody(request);
    const { project, warnings } = await createProjectFromBody(body, { rootDir });
    const requestedVideoProvider = normalizeText(body.videoProvider, project.video_provider ?? "local-ffmpeg");
    let openAiApiKey = null;
    if (requestedVideoProvider === "openai-video" && project.provider_status?.api_key?.configured) {
      try {
        openAiApiKey = await readOpenAiKey({ rootDir });
      } catch {
        openAiApiKey = null;
      }
    }
    const production = await produceVideos({
      rootDir,
      project,
      renderCount: normalizeCount(body.renderCount, project.episodes.length),
      renderDuration: normalizeOptionalCount(body.renderDuration),
      videoProvider: requestedVideoProvider,
      openAiApiKey,
      initialWarnings: warnings
    });
    sendJson(response, 200, buildProduceResponse({
      project: production.project,
      artifacts: production.artifacts,
      production_manifest_path: production.production_manifest_path,
      production_package_path: production.production_package_path,
      warnings: production.warnings
    }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/render") {
    const body = await readJsonBody(request);
    const project = await readCurrentProject(rootDir);
    const episodeId = normalizeText(body.episodeId, project.episodes?.[0]?.id ?? "episode-001");
    const render = await renderMockVideo({
      cwd: rootDir,
      project: project.id ?? DEFAULT_PROJECT_ID,
      episode: episodeId,
      duration: normalizeCount(body.duration, 9)
    });
    const updatedProject = updateProjectEpisode(project, episodeId, {
      status: "rendered",
      review_gate: "approved"
    });
    await writeFactoryProject(updatedProject, rootDir);
    sendJson(response, 200, { ok: true, render, project: updatedProject });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/image2-assets") {
    const body = await readJsonBody(request);
    const project = await readCurrentProject(rootDir);
    const projectId = project.id ?? DEFAULT_PROJECT_ID;
    const episodeId = normalizeText(body.episodeId ?? body.episode_id, project.episodes?.[0]?.id ?? "episode-001");
    const shouldRender = body.render !== false;

    try {
      const assetManifest = await attachImage2Assets({
        rootDir,
        projectId,
        episodeId,
        assets: Array.isArray(body.assets) ? body.assets : [],
        source: "web-chatgpt-account"
      });
      const render = shouldRender
        ? await renderMockVideo({
          cwd: rootDir,
          project: projectId,
          episode: episodeId,
          duration: normalizeOptionalCount(body.duration) ?? project.episodes?.find((episode) => episode.id === episodeId)?.duration_seconds ?? 9
        })
        : null;
      const updatedProject = shouldRender
        ? updateProjectEpisode(project, episodeId, {
          status: "rendered",
          review_gate: "approved"
        })
        : project;
      await writeFactoryProject(updatedProject, rootDir);
      const production = await refreshProductionArtifact({
        rootDir,
        project: updatedProject,
        episodeId,
        renderResult: render
      });
      const readiness = await resolveProductReadiness({ rootDir });
      sendJson(response, 200, {
        ok: true,
        project: updatedProject,
        asset_manifest: assetManifest,
        render,
        artifact: production.artifact,
        manifest: production.manifest,
        production_manifest_path: production.production_manifest_path,
        production_package_path: production.production_package_path,
        readiness
      });
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: "invalid_image2_assets",
        message: error instanceof Error ? error.message : "Image 2 asset attachment failed."
      });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/episode") {
    const body = await readJsonBody(request);
    const project = await readCurrentProject(rootDir);
    const episodeId = normalizeText(body.episodeId, "");
    const patch = {};

    if (isAllowedStatus(body.status)) patch.status = body.status;
    if (isAllowedReviewGate(body.reviewGate)) patch.review_gate = body.reviewGate;
    if (!episodeId || Object.keys(patch).length === 0) {
      sendJson(response, 400, {
        ok: false,
        error: "invalid_episode_update",
        message: "Provide episodeId plus status or reviewGate."
      });
      return;
    }

    const updatedProject = updateProjectEpisode(project, episodeId, patch);
    await writeFactoryProject(updatedProject, rootDir);
    sendJson(response, 200, { ok: true, project: updatedProject });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/bundle") {
    const body = await readJsonBody(request);
    const project = await readCurrentProject(rootDir);
    const manifest = await buildPublishBundle({
      rootDir,
      project,
      episodeId: normalizeText(body.episodeId, project.episodes?.[0]?.id ?? "episode-001")
    });
    sendJson(response, 200, { ok: true, manifest });
    return;
  }

  sendJson(response, 404, {
    ok: false,
    error: "not_found",
    message: `${request.method} ${url.pathname} is not an AI Short Video Factory endpoint.`
  });
}

async function createProjectFromBody(body, { rootDir }) {
  const keyPresence = await readOpenAiKeyPresence({
    envFilePath: path.join(rootDir, ".env.local")
  });
  const accountPresence = await readChatGptAccountPresence({
    envFilePath: path.join(rootDir, ".env.local")
  });
  const topic = normalizeText(body.topic, "AI cartoon fruit drama");
  const count = normalizeCount(body.count, 5);
  const sourceType = normalizeText(body.sourceType, "text idea");
  const currentProject = await readCurrentProject(rootDir);
  const sourceAsset = normalizeSourceAsset(body.sourceAsset) ?? currentProject.source_asset ?? null;
  const wantsOpenAi = body.providerMode === "openai";
  const wantsChatGpt = body.providerMode === "chatgpt";
  const wantsOllama = body.providerMode === "ollama";
  const forceLiveDirector = body.forceLiveDirector === true;
  const shouldUseOpenAiFallback = wantsChatGpt && !accountPresence.configured && keyPresence.configured;
  const shouldUseOpenAiDirector = (wantsOpenAi || shouldUseOpenAiFallback || forceLiveDirector) && keyPresence.configured;
  const warnings = [];

  if (shouldUseOpenAiFallback) {
    warnings.push("ChatGPT account mode selected, but CHATGPT_ACCOUNT_VERIFIED is not set. Using OpenAI API director fallback for prompt content.");
  }

  if (forceLiveDirector && wantsChatGpt && accountPresence.configured) {
    warnings.push("Using OpenAI API director for web prompt content while keeping ChatGPT account-auth ready for Image 2 handoff.");
  }

  if (wantsOllama) {
    try {
      return {
        project: await generateProjectWithOllama({
          topic,
          count,
          sourceType,
          sourceAsset,
          chatGptAccountVerified: accountPresence.configured,
          chatGptAccountSource: accountPresence.source,
          openAiConfigured: keyPresence.configured,
          openAiSource: keyPresence.source,
          videoProvider: normalizeText(body.videoProvider, process.env.VIDEO_PROVIDER ?? "local-ffmpeg")
        }),
        warnings
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown Ollama generation error.";
      warnings.push(`Local LLM generation failed (${detail}). Using deterministic local generation fallback.`);
    }
  }

  if (shouldUseOpenAiDirector) {
    try {
      return {
        project: await generateProjectWithOpenAi({
          apiKey: await readOpenAiKey({ rootDir }),
          topic,
          count,
          sourceType,
          sourceAsset,
          chatGptAccountVerified: accountPresence.configured,
          chatGptAccountSource: accountPresence.source,
          videoProvider: normalizeText(body.videoProvider, process.env.VIDEO_PROVIDER ?? "local-ffmpeg")
        }),
        warnings
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown OpenAI generation error.";
      warnings.push(`OpenAI content generation failed (${detail}). Using local generation as fallback.`);
    }
  } else if (wantsOpenAi && !keyPresence.configured) {
    warnings.push("OpenAI mode selected, but OPENAI_API_KEY is not configured. Using local generation fallback.");
  } else if (forceLiveDirector && !keyPresence.configured) {
    warnings.push("OpenAI director was requested, but OPENAI_API_KEY is not configured. Using local generation fallback.");
  }

  if (wantsChatGpt && !accountPresence.configured && !keyPresence.configured) {
    warnings.push("ChatGPT account mode selected, but CHATGPT_ACCOUNT_VERIFIED is not set. Using local pipeline as a fallback.");
  }

  const providerMode = warnings.length > 0
    ? "local"
    : resolveProjectProviderMode({
      requestedProviderMode: body.providerMode,
      keyPresence,
      accountPresence
    });

  return {
    project: createFactoryProject({
      topic,
      count,
      sourceType,
      sourceAsset,
      openAiConfigured: keyPresence.configured,
      openAiSource: keyPresence.source,
      chatGptAccountVerified: accountPresence.configured,
      chatGptAccountSource: accountPresence.source,
      localLlmConfigured: wantsOllama && warnings.length === 0,
      localLlmSource: wantsOllama ? (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434") : "missing",
      localLlmModel: process.env.OLLAMA_MODEL || "qwen3.6:latest",
      providerMode,
      videoProvider: normalizeText(body.videoProvider, process.env.VIDEO_PROVIDER ?? "local-ffmpeg")
    }),
    warnings
  };
}

function buildGenerateResponse(project, warnings) {
  const response = { ok: true, project };
  if (Array.isArray(warnings) && warnings.length > 0) {
    return { ...response, warnings };
  }
  return response;
}

function buildProduceResponse(production) {
  const response = { ok: true, ...production };
  if (Array.isArray(production.warnings) && production.warnings.length > 0) {
    return { ...response, warnings: production.warnings };
  }
  return response;
}

async function sendArtifact(request, response, { rootDir, url }) {
  const parts = url.pathname.split("/").filter(Boolean);
  const [, , project, episode, section, filename] = parts;

  const artifact = resolveArtifactPath({ rootDir, project, episode, section, filename, parts });
  if (!artifact) {
    sendJson(response, 404, {
      ok: false,
      error: "artifact_not_found",
      message: `${request.method} ${url.pathname} is not a valid artifact endpoint.`
    });
    return;
  }

  let stats;
  try {
    await access(artifact.filePath);
    stats = await stat(artifact.filePath);
  } catch {
    sendJson(response, 404, {
      ok: false,
      error: "artifact_not_found",
      message: `Cannot find artifact ${artifact.label}.`
    });
    return;
  }

  const stream = createReadStream(artifact.filePath);
  stream.once("error", () => {
    response.destroy();
  });
  response.writeHead(200, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Length": stats.size,
    "Content-Type": artifact.contentType
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  stream.pipe(response);
}

function resolveArtifactPath({ rootDir, project, episode, section, filename, parts }) {
  if (!isSafePathSegment(project)) return null;

  if (parts.length === 4 && episode === "production-manifest.json") {
    return {
      contentType: "application/json; charset=utf-8",
      filePath: path.join(rootDir, "outputs", project, "production-manifest.json"),
      label: `${project}/production-manifest.json`
    };
  }

  if (parts.length === 4 && episode === "production-package.tar.gz") {
    return {
      contentType: "application/gzip",
      filePath: path.join(rootDir, "outputs", project, "production-package.tar.gz"),
      label: `${project}/production-package.tar.gz`
    };
  }

  if (!isSafePathSegment(episode)) return null;

  if (parts.length === 5 && episode === "reference" && isSafeFileName(section)) {
    return {
      contentType: contentTypeForReferenceFile(section),
      filePath: path.join(rootDir, "storage", "projects", project, "reference-assets", section),
      label: `${project}/reference/${section}`
    };
  }

  if (parts.length === 5 && section === "final.mp4") {
    return {
      contentType: "video/mp4",
      filePath: path.join(rootDir, "outputs", project, episode, "final.mp4"),
      label: `${project}/${episode}/final.mp4`
    };
  }

  if (parts.length === 6 && section === "publish-bundle" && ["manifest.json", "image2-handoff.json"].includes(filename)) {
    return {
      contentType: "application/json; charset=utf-8",
      filePath: path.join(rootDir, "outputs", project, episode, "publish-bundle", filename),
      label: `${project}/${episode}/publish-bundle/${filename}`
    };
  }

  if (parts.length === 6 && section === "image2-assets" && isSafeFileName(filename)) {
    return {
      contentType: filename === "manifest.json" ? "application/json; charset=utf-8" : contentTypeForReferenceFile(filename),
      filePath: path.join(rootDir, "outputs", project, episode, "image2-assets", filename),
      label: `${project}/${episode}/image2-assets/${filename}`
    };
  }

  return null;
}

export async function readCurrentProject(rootDir = process.cwd()) {
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

  return createFactoryProject();
}

async function writeProjectSaveReceipt({ rootDir, project, savedAt }) {
  const projectId = project.id ?? DEFAULT_PROJECT_ID;
  const receiptPath = path.join(rootDir, "storage", "projects", projectId, "save-receipt.json");
  await writeFile(receiptPath, `${JSON.stringify({
    project_id: projectId,
    project_name: project.name,
    saved_at: savedAt,
    episode_count: Array.isArray(project.episodes) ? project.episodes.length : 0,
    rendered_count: Array.isArray(project.episodes) ? project.episodes.filter((episode) => episode.status === "rendered").length : 0,
    files: {
      dashboard_state: "public/factory-state.json",
      project_state: `storage/projects/${projectId}/project.json`,
      production_manifest: `outputs/${projectId}/production-manifest.json`,
      production_package: `outputs/${projectId}/production-package.tar.gz`
    }
  }, null, 2)}\n`, "utf8");
  return path.relative(rootDir, receiptPath);
}

async function writeProjectDuplicateSnapshot({ rootDir, project, duplicatedAt }) {
  const sourceProjectId = project.id ?? DEFAULT_PROJECT_ID;
  const duplicateId = `copy-${duplicatedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const duplicateDir = path.join(rootDir, "storage", "projects", sourceProjectId, "duplicates", duplicateId);
  await mkdir(duplicateDir, { recursive: true });
  const duplicateProject = {
    ...project,
    name: `${project.name ?? "Reference Batch"} Copy`,
    duplicated_from: sourceProjectId,
    duplicated_at: duplicatedAt
  };
  const manifest = {
    duplicate_id: duplicateId,
    project_id: sourceProjectId,
    project_name: duplicateProject.name,
    duplicated_at: duplicatedAt,
    episode_count: Array.isArray(project.episodes) ? project.episodes.length : 0,
    rendered_count: Array.isArray(project.episodes) ? project.episodes.filter((episode) => episode.status === "rendered").length : 0,
    source_files: {
      project_state: `storage/projects/${sourceProjectId}/project.json`,
      production_manifest: `outputs/${sourceProjectId}/production-manifest.json`,
      production_package: `outputs/${sourceProjectId}/production-package.tar.gz`
    },
    files: {
      project_snapshot: path.relative(rootDir, path.join(duplicateDir, "project.json")),
      manifest: path.relative(rootDir, path.join(duplicateDir, "manifest.json"))
    }
  };
  await writeFile(path.join(duplicateDir, "project.json"), `${JSON.stringify(duplicateProject, null, 2)}\n`, "utf8");
  await writeFile(path.join(duplicateDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return {
    id: duplicateId,
    project_name: duplicateProject.name,
    project_snapshot: manifest.files.project_snapshot,
    manifest_path: manifest.files.manifest
  };
}

async function readRawBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBody(request) {
  const raw = (await readRawBody(request)).trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

async function readBodyByContentType(request) {
  const raw = (await readRawBody(request)).trim();
  if (!raw) return {};
  const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
  if (contentType.includes("application/json")) {
    return JSON.parse(raw);
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  try {
    return JSON.parse(raw);
  } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

async function readOpenAiKey({ rootDir }) {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const envPath = path.join(rootDir, ".env.local");
  const raw = await readFile(envPath, "utf8");
  const entry = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("OPENAI_API_KEY="));
  const value = entry?.slice("OPENAI_API_KEY=".length).trim().replace(/^['"]|['"]$/g, "");
  if (!value) throw new Error("OPENAI_API_KEY is not configured.");
  return value;
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS,HEAD",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(statusCode === 204 ? "" : `${JSON.stringify(data, null, 2)}\n`);
}

function sendHtml(response, statusCode, html, contentType = "text/html; charset=utf-8") {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Type": contentType
  });
  response.end(html);
}

function sendRedirect(response, statusCode, headers = {}) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end();
}

function resolveBaseUrl(request) {
  if (process.env.PUBLIC_MCP_ORIGIN) {
    try {
      return new URL(process.env.PUBLIC_MCP_ORIGIN).origin;
    } catch {
      // Fall through to the request host.
    }
  }
  const host = request.headers.host || "127.0.0.1:3030";
  const protocol = request.headers["x-forwarded-proto"] || "http";
  return `${protocol}://${host}`;
}

function normalizeText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function decodeReferenceUpload(body) {
  const fileName = sanitizeReferenceFileName(normalizeText(body.fileName, "reference-asset"));
  const mimeType = normalizeText(body.mimeType, "").toLowerCase();
  const rawData = normalizeText(body.data, "");
  const base64 = rawData.includes(",") ? rawData.slice(rawData.indexOf(",") + 1) : rawData;

  if (!ALLOWED_REFERENCE_MIME_TYPES.has(mimeType)) {
    return { ok: false, message: "Upload an image or video reference file." };
  }

  if (!base64 || !/^[a-zA-Z0-9+/=\r\n]+$/.test(base64)) {
    return { ok: false, message: "Upload payload must be base64 encoded." };
  }

  let bytes;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    return { ok: false, message: "Upload payload could not be decoded." };
  }

  if (!bytes.length) {
    return { ok: false, message: "Reference file is empty." };
  }

  if (bytes.length > MAX_REFERENCE_UPLOAD_BYTES) {
    return { ok: false, message: "Reference file is larger than the 50 MB local product limit." };
  }

  if (Number.isFinite(Number(body.sizeBytes)) && Number(body.sizeBytes) !== bytes.length) {
    return { ok: false, message: "Reference file size does not match the uploaded payload." };
  }

  return {
    ok: true,
    value: {
      fileName,
      mimeType,
      bytes
    }
  };
}

async function writeReferenceAsset({ rootDir, projectId, upload }) {
  const referenceDir = path.join(rootDir, "storage", "projects", projectId, "reference-assets");
  await mkdir(referenceDir, { recursive: true });
  const uploadedAt = new Date().toISOString();
  const id = `ref-${uploadedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const extension = extensionForReferenceMime(upload.mimeType, path.extname(upload.fileName));
  const baseName = path.basename(upload.fileName, path.extname(upload.fileName)).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "reference";
  const storedName = `${id}-${baseName}${extension}`;
  const filePath = path.join(referenceDir, storedName);
  await writeFile(filePath, upload.bytes);

  return {
    id,
    kind: upload.mimeType.startsWith("image/") ? "image" : "video",
    file_name: upload.fileName,
    stored_name: storedName,
    mime_type: upload.mimeType,
    size_bytes: upload.bytes.length,
    sha256: createHash("sha256").update(upload.bytes).digest("hex"),
    storage_path: path.relative(rootDir, filePath),
    artifact_path: `/api/artifact/${projectId}/reference/${storedName}`,
    uploaded_at: uploadedAt
  };
}

function sanitizeReferenceFileName(value) {
  const basename = path.basename(String(value || "reference-asset")).trim();
  return basename.replace(/[^\w.\- ()]+/g, "-").slice(0, 120) || "reference-asset";
}

function extensionForReferenceMime(mimeType, currentExtension) {
  const normalized = currentExtension && /^[.][a-zA-Z0-9]{2,8}$/.test(currentExtension) ? currentExtension.toLowerCase() : "";
  if (normalized) return normalized;
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "video/quicktime") return ".mov";
  if (mimeType === "video/webm") return ".webm";
  return ".mp4";
}

function normalizeSourceAsset(value) {
  if (!value || typeof value !== "object") return null;
  const storedName = typeof value.stored_name === "string" && isSafeFileName(value.stored_name) ? value.stored_name : "";
  if (!storedName) return null;
  return {
    id: normalizeText(value.id, "ref"),
    kind: value.kind === "image" ? "image" : "video",
    file_name: normalizeText(value.file_name, storedName),
    stored_name: storedName,
    mime_type: normalizeText(value.mime_type, contentTypeForReferenceFile(storedName)),
    size_bytes: Number.isFinite(Number(value.size_bytes)) ? Number(value.size_bytes) : 0,
    sha256: normalizeText(value.sha256, ""),
    storage_path: normalizeText(value.storage_path, ""),
    artifact_path: normalizeText(value.artifact_path, ""),
    uploaded_at: normalizeText(value.uploaded_at, new Date().toISOString())
  };
}

function buildReferenceAnalysis({ topic, sourceType, sourceAsset, project }) {
  const canonicalTopic = normalizeText(topic, "AI cartoon fruit drama");
  const safeAssetName = sourceAsset?.file_name ? `Reference file: ${sourceAsset.file_name}` : `Source type: ${sourceType}`;
  const themes = deriveThemesFromText(canonicalTopic, sourceType);
  const summary = `Analyzed ${safeAssetName} for topic "${canonicalTopic}". Recommended ${themes.length} style cues and ${Math.max(2, themes.length)} originality checks.`;
  const sourceMode = sourceAsset ? sourceAsset.kind : sourceType;

  return {
    status: "ready",
    source_mode: sourceMode,
    source_type: sourceType,
    source_reference: sourceAsset?.file_name ?? "Text idea",
    source_summary_input: canonicalTopic,
    recipe_source_summary: `${canonicalTopic} (${sourceMode})`,
    detected_themes: themes,
    recommended_guidance: [
      "Use 3-act pacing with a hook, turn, and cliffhanger.",
      `Keep source inspiration at < 65% and invent 4+ visual details for every shot cluster.`,
      `Inject voiceover phrasing that resets emotion every 2-3 seconds for ${sourceMode}.`
    ],
    summary
  };
}

function deriveThemesFromText(topic, sourceType) {
  const base = normalizeText(topic, "AI cartoon fruit drama").toLowerCase();
  const words = base.split(/\W+/).filter(Boolean);
  const core = words.filter((word) => word.length > 2 && !["the", "and", "for", "with", "that", "this", "have", "from", "just", "not", "are", "was", "were"].includes(word));
  const sourceHint = sourceType.includes("video") ? "visual rhythm from reference timing" : sourceType.includes("screenshot") ? "single-frame style anchor" : "narrative premise expansion";
  const deduped = Array.from(new Set([sourceHint, ...core.slice(0, 2)]));
  return deduped.length ? deduped : ["dramatic reveal", "suspense beat", "visual hook"];
}

function normalizeCount(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(Math.floor(numeric), 50));
}

function normalizeOptionalCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(1, Math.min(Math.floor(numeric), 300));
}

function resolveProjectProviderMode({ requestedProviderMode, keyPresence, accountPresence }) {
  if (requestedProviderMode === "chatgpt" && accountPresence.configured) return "chatgpt-account";
  if (requestedProviderMode === "openai" && keyPresence.configured) return "live";
  if (requestedProviderMode === "ollama") return "local-llm";
  if (requestedProviderMode === "local") return "local";
  if (keyPresence.configured) return "live";
  return "local";
}

function updateProjectEpisode(project, episodeId, patch) {
  let found = false;
  const episodes = project.episodes.map((episode) => {
    if (episode.id !== episodeId) return episode;
    found = true;
    return { ...episode, ...patch };
  });
  if (!found) {
    throw new Error(`Cannot find episode ${episodeId}.`);
  }

  return {
    ...project,
    generated_at: new Date().toISOString(),
    jobs: buildJobs(episodes),
    episodes
  };
}

function isAllowedStatus(status) {
  return ["queued", "script", "generated", "rendering", "rendered"].includes(status);
}

function isAllowedReviewGate(reviewGate) {
  return ["pending", "approved", "returned"].includes(reviewGate);
}

function isSafePathSegment(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value);
}

function isSafeFileName(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_.-]+$/.test(value) && !value.includes("..");
}

function contentTypeForReferenceFile(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".webm") return "video/webm";
  return "video/mp4";
}
