import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_PROJECT_ID, captionsToSrt } from "./factory-core.mjs";
import { readImage2AssetManifest } from "./image2-assets.mjs";

export async function buildPublishBundle({ rootDir = process.cwd(), project, episodeId = "episode-001" } = {}) {
  const sourceProject = project ?? (await readProject(rootDir));
  const episode = sourceProject.episodes?.find((candidate) => candidate.id === episodeId);
  if (!episode) {
    throw new Error(`Cannot find episode ${episodeId} for publish bundle.`);
  }

  const episodeDir = path.join(rootDir, "outputs", sourceProject.id ?? DEFAULT_PROJECT_ID, episode.id);
  const bundleDir = path.join(episodeDir, "publish-bundle");
  await mkdir(bundleDir, { recursive: true });
  const image2Assets = await readImage2AssetManifest({
    rootDir,
    projectId: sourceProject.id ?? DEFAULT_PROJECT_ID,
    episodeId: episode.id
  });

  const files = {
    captions: path.join(bundleDir, "captions.srt"),
    hashtags: path.join(bundleDir, "hashtags.txt"),
    voiceover: path.join(bundleDir, "voiceover.txt"),
    publishCopy: path.join(bundleDir, "publish-copy.md"),
    shotPrompts: path.join(bundleDir, "shot-prompts.json"),
    image2Handoff: path.join(bundleDir, "image2-handoff.json"),
    manifest: path.join(bundleDir, "manifest.json")
  };

  const manifest = {
    project_id: sourceProject.id ?? DEFAULT_PROJECT_ID,
    episode_id: episode.id,
    title: episode.title,
    status: episode.status,
    review_gate: episode.review_gate,
    generated_at: new Date().toISOString(),
    video_output: episode.output_path,
    files: Object.fromEntries(
      Object.entries(files).map(([key, value]) => [key, path.relative(rootDir, value)])
    ),
    provider_mode: sourceProject.provider_mode,
    source_asset: sourceProject.source_asset ?? null,
    image2_handoff: path.relative(rootDir, files.image2Handoff),
    image2_assets: image2Assets
      ? {
        manifest_path: image2Assets.manifest_path,
        asset_count: image2Assets.asset_count,
        model: image2Assets.model,
        uses_api_key: image2Assets.uses_api_key,
        assets: image2Assets.assets.map((asset) => ({
          shot_id: asset.shot_id,
          storage_path: asset.storage_path,
          artifact_path: asset.artifact_path,
          mime_type: asset.mime_type,
          size_bytes: asset.size_bytes
        }))
      }
      : null,
    ai_disclosure: episode.ai_disclosure,
    publish_ready: episode.review_gate === "approved" && ["generated", "rendering", "rendered"].includes(episode.status)
  };

  await writeFile(files.captions, captionsToSrt(episode.captions), "utf8");
  await writeFile(files.hashtags, `${episode.hashtags.join(" ")}\n`, "utf8");
  await writeFile(files.voiceover, `${episode.voiceover.join("\n")}\n`, "utf8");
  await writeFile(files.publishCopy, createPublishCopy(episode, sourceProject), "utf8");
  await writeFile(files.shotPrompts, `${JSON.stringify(episode.shots, null, 2)}\n`, "utf8");
  await writeFile(files.image2Handoff, `${JSON.stringify(createImage2Handoff(episode, sourceProject), null, 2)}\n`, "utf8");
  await writeFile(files.manifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return manifest;
}

export function createImage2Handoff(episode, project) {
  const accountReady = Boolean(project.provider_status?.account_auth?.configured);
  return {
    provider: accountReady ? "ChatGPT account-auth Image 2" : "Image 2 account-auth pending",
    model: "gpt-image-2",
    auth_method: "ChatGPT Apps OAuth 2.1 / MCP",
    uses_api_key: false,
    status: accountReady ? "ready" : "pending_account_verification",
    project_id: project.id ?? DEFAULT_PROJECT_ID,
    episode_id: episode.id,
    title: episode.title,
    aspect_ratio: "9:16",
    size: "1080x1920",
    prompts: episode.shots.map((shot) => ({
      shot_id: shot.shot_id,
      duration_seconds: shot.duration_seconds,
      prompt: shot.image_prompt,
      safety_rules: [
        "Do not reproduce source watermarks, usernames, exact frames, or captions.",
        "Do not bake text into generated images.",
        "Keep character identity original to this batch."
      ]
    }))
  };
}

export function createPublishCopy(episode, project) {
  return [
    `# ${episode.title}`,
    "",
    `Hook: ${episode.hook}`,
    "",
    "## Caption Beats",
    ...episode.captions.map((caption) => `- ${caption.text}`),
    "",
    "## Voiceover",
    ...episode.voiceover.map((line) => `- ${line}`),
    "",
    "## Hashtags",
    episode.hashtags.join(" "),
    "",
    "## Image 2 Handoff",
    `Model: gpt-image-2`,
    `Auth: ChatGPT Apps OAuth 2.1 / MCP`,
    `Status: ${project.provider_status?.account_auth?.configured ? "ready" : "pending account verification"}`,
    "",
    "## Disclosure",
    episode.ai_disclosure,
    "",
    "## Source",
    `Project: ${project.name}`,
    `Recipe: ${episode.recipe_snapshot}`,
    project.source_asset ? `Reference: ${project.source_asset.file_name}` : "Reference: text idea",
    ""
  ].join("\n");
}

async function readProject(rootDir) {
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

  throw new Error("Cannot find project state. Run npm run generate first.");
}
