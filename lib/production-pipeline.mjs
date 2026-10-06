import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { buildPublishBundle } from "./artifact-bundle.mjs";
import { buildJobs, DEFAULT_PROJECT_ID, writeFactoryProject } from "./factory-core.mjs";
import { renderOpenAiVideo } from "./openai-video-renderer.mjs";
import { renderMockVideo } from "../scripts/render-mock-video.mjs";

export async function produceVideos({ rootDir = process.cwd(), project, renderCount, renderDuration, videoProvider, openAiApiKey, initialWarnings = [] } = {}) {
  if (!project?.episodes?.length) {
    throw new Error("Cannot produce videos without generated episodes.");
  }

  const requestedCount = Number.isFinite(Number(renderCount)) ? Number(renderCount) : project.episodes.length;
  const safeRenderCount = Math.max(1, Math.min(Math.floor(requestedCount), project.episodes.length));
  const selectedVideoProvider = normalizeVideoProvider(videoProvider ?? project.video_provider ?? process.env.VIDEO_PROVIDER ?? "local-ffmpeg");
  let currentProject = project;
  const artifacts = [];
  const warnings = Array.isArray(initialWarnings)
    ? initialWarnings.filter((warning) => typeof warning === "string" && warning.trim().length > 0)
    : [];

  await writeFactoryProject(currentProject, rootDir);

  for (const episode of currentProject.episodes.slice(0, safeRenderCount)) {
    const duration = Number.isFinite(Number(renderDuration)) ? Number(renderDuration) : episode.duration_seconds;
    try {
      const render = await renderEpisodeVideo({
        cwd: rootDir,
        provider: selectedVideoProvider,
        apiKey: openAiApiKey,
        project: currentProject.id ?? DEFAULT_PROJECT_ID,
        episode,
        duration: Math.max(3, Math.floor(duration))
      });
      if (render.fallback_from) {
        warnings.push(
          `Episode ${episode.id} used ${render.renderer} after ${render.fallback_from} fallback: ${render.fallback_reason ?? "renderer unavailable."}`
        );
      }

      const episodes = currentProject.episodes.map((candidate) =>
        candidate.id === episode.id
          ? { ...candidate, status: "rendered", review_gate: "approved" }
          : candidate
      );
      currentProject = {
        ...currentProject,
        generated_at: new Date().toISOString(),
        jobs: buildJobs(episodes),
        episodes
      };
      await writeFactoryProject(currentProject, rootDir);

      const manifest = await buildPublishBundle({
        rootDir,
        project: currentProject,
        episodeId: episode.id
      });

      artifacts.push({
        episode_id: episode.id,
        output_path: path.relative(rootDir, render.output_path),
        manifest_path: manifest.files.manifest,
        image2_handoff_path: manifest.files.image2Handoff,
        image2_asset_manifest_path: manifest.image2_assets?.manifest_path ?? null,
        image2_asset_count: manifest.image2_assets?.asset_count ?? 0,
        image2_assets_used: render.image2_asset_count ?? 0,
        renderer: render.renderer ?? selectedVideoProvider,
        fallback_from: render.fallback_from ?? null,
        video_job_id: render.video_job_id ?? null,
        publish_ready: manifest.publish_ready
      });
    } catch (error) {
      warnings.push(`Episode ${episode.id} render failed: ${error instanceof Error ? error.message : "Unknown render error."}`);
      const episodes = currentProject.episodes.map((candidate) =>
        candidate.id === episode.id
          ? { ...candidate, review_gate: candidate.review_gate ?? "pending" }
          : candidate
      );
      currentProject = {
        ...currentProject,
        generated_at: new Date().toISOString(),
        jobs: buildJobs(episodes),
        episodes
      };
      await writeFactoryProject(currentProject, rootDir);
    }
  }

  let productionManifestPath = null;
  let productionPackagePath = null;

  try {
    productionManifestPath = await writeProductionManifest({
      rootDir,
      project: currentProject,
      artifacts,
      warnings
    });
  } catch (error) {
    warnings.push(`Production manifest write failed: ${error instanceof Error ? error.message : "Unknown write error."}`);
  }

  try {
    productionPackagePath = await buildProductionPackage({
      rootDir,
      project: currentProject,
      artifacts
    });
  } catch (error) {
    warnings.push(`Production package creation failed: ${error instanceof Error ? error.message : "Unknown packaging error."}`);
  }

  return {
    project: currentProject,
    artifacts,
    production_manifest_path: productionManifestPath,
    production_package_path: productionPackagePath,
    warnings
  };
}

async function writeProductionManifest({ rootDir, project, artifacts, warnings = [] }) {
  const projectId = project.id ?? DEFAULT_PROJECT_ID;
  const outputDir = path.join(rootDir, "outputs", projectId);
  await mkdir(outputDir, { recursive: true });

  const manifestPath = path.join(outputDir, "production-manifest.json");
  const manifest = {
    project_id: projectId,
    project_name: project.name,
    provider_mode: project.provider_mode,
    video_provider: project.video_provider ?? "local-ffmpeg",
    topic: project.recipe?.source_summary,
    source_asset: project.source_asset ?? null,
    generated_at: new Date().toISOString(),
    content_count: project.episodes.length,
    rendered_count: artifacts.length,
    publish_ready_count: artifacts.filter((artifact) => artifact.publish_ready).length,
    warnings,
    files: {
      dashboard_state: "public/factory-state.json",
      project_state: `storage/projects/${projectId}/project.json`,
      production_manifest: path.relative(rootDir, manifestPath),
      production_package: `outputs/${projectId}/production-package.tar.gz`
    },
    artifacts,
    episodes: project.episodes.map((episode) => ({
      id: episode.id,
      title: episode.title,
      status: episode.status,
      review_gate: episode.review_gate,
      output_path: episode.output_path,
      metadata_path: episode.metadata_path,
      captions_path: episode.captions_path
    }))
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return path.relative(rootDir, manifestPath);
}

async function renderEpisodeVideo({ cwd, provider, apiKey, project, episode, duration }) {
  if (provider === "openai-video") {
    if (apiKey) {
      try {
        return await renderOpenAiVideo({
          apiKey,
          rootDir: cwd,
          projectId: project,
          episode,
          duration
        });
      } catch (error) {
        const fallback = await renderMockVideo({
          cwd,
          project,
          episode: episode.id,
          duration
        });
        return {
          ...fallback,
          renderer: "local-ffmpeg",
          fallback_from: "openai-video",
          fallback_reason: error instanceof Error ? error.message : "OpenAI video rendering failed."
        };
      }
    }

    const fallback = await renderMockVideo({
      cwd,
      project,
      episode: episode.id,
      duration
    });
    return {
      ...fallback,
      renderer: "local-ffmpeg",
      fallback_from: "openai-video",
      fallback_reason: "OPENAI_API_KEY is not configured."
    };
  }

  const render = await renderMockVideo({
    cwd,
    project,
    episode: episode.id,
    duration
  });
  return {
    ...render,
    renderer: provider
  };
}

function normalizeVideoProvider(value) {
  return ["local-ffmpeg", "mock", "openai-video"].includes(value) ? value : "local-ffmpeg";
}

export async function buildProductionPackage({ rootDir = process.cwd(), project, artifacts = [] } = {}) {
  const projectId = project?.id ?? DEFAULT_PROJECT_ID;
  const outputDir = path.join(rootDir, "outputs", projectId);
  const packagePath = path.join(outputDir, "production-package.tar.gz");
  await mkdir(outputDir, { recursive: true });

  const renderedEpisodeDirs = artifacts
    .map((artifact) => artifact.episode_id)
    .filter((episodeId) => typeof episodeId === "string" && /^episode-[0-9]{3}$/.test(episodeId));
  const entries = ["production-manifest.json", ...renderedEpisodeDirs];

  await run("tar", [
    "--exclude=.DS_Store",
    "-czf",
    packagePath,
    "-C",
    outputDir,
    ...entries
  ]);

  return path.relative(rootDir, packagePath);
}

export async function refreshProductionArtifact({
  rootDir = process.cwd(),
  project,
  episodeId,
  renderResult = null
} = {}) {
  if (!project?.episodes?.length) {
    throw new Error("Cannot refresh production artifacts without a generated project.");
  }
  if (!episodeId) {
    throw new Error("episodeId is required.");
  }

  const projectId = project.id ?? DEFAULT_PROJECT_ID;
  const productionManifest = await readProductionManifest({ rootDir, projectId });
  const currentArtifacts = Array.isArray(productionManifest?.artifacts) ? productionManifest.artifacts : [];
  const manifest = await buildPublishBundle({
    rootDir,
    project,
    episodeId
  });
  const outputPath = renderResult?.output_path
    ? path.relative(rootDir, renderResult.output_path)
    : `outputs/${projectId}/${episodeId}/final.mp4`;
  const nextArtifact = {
    episode_id: episodeId,
    output_path: outputPath,
    manifest_path: manifest.files.manifest,
    image2_handoff_path: manifest.files.image2Handoff,
    image2_asset_manifest_path: manifest.image2_assets?.manifest_path ?? null,
    image2_asset_count: manifest.image2_assets?.asset_count ?? 0,
    image2_assets_used: renderResult?.image2_asset_count ?? currentArtifacts.find((artifact) => artifact.episode_id === episodeId)?.image2_assets_used ?? 0,
    publish_ready: manifest.publish_ready
  };
  const nextArtifacts = upsertArtifact(currentArtifacts, nextArtifact);
  const productionManifestPath = await writeProductionManifest({
    rootDir,
    project,
    artifacts: nextArtifacts
  });
  const productionPackagePath = await buildProductionPackage({
    rootDir,
    project,
    artifacts: nextArtifacts
  });

  return {
    artifact: nextArtifact,
    manifest,
    production_manifest_path: productionManifestPath,
    production_package_path: productionPackagePath,
    artifacts: nextArtifacts
  };
}

async function readProductionManifest({ rootDir, projectId }) {
  try {
    return JSON.parse(await readFile(path.join(rootDir, "outputs", projectId, "production-manifest.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function upsertArtifact(artifacts, nextArtifact) {
  const result = [];
  let replaced = false;
  for (const artifact of artifacts) {
    if (artifact?.episode_id === nextArtifact.episode_id) {
      result.push(nextArtifact);
      replaced = true;
    } else {
      result.push(artifact);
    }
  }
  if (!replaced) result.push(nextArtifact);
  return result.sort((left, right) => String(left.episode_id).localeCompare(String(right.episode_id)));
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with ${code}\n${stderr}`));
      }
    });
  });
}
