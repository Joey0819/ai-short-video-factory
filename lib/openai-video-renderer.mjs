import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const OPENAI_VIDEO_DEFAULTS = {
  apiBaseUrl: "https://api.openai.com/v1",
  model: "sora-2",
  size: "720x1280",
  seconds: 8,
  pollIntervalMs: 10_000,
  timeoutMs: 8 * 60_000
};

export async function renderOpenAiVideo({
  apiKey,
  rootDir = process.cwd(),
  projectId = "demo-reference",
  episode,
  duration = OPENAI_VIDEO_DEFAULTS.seconds,
  fetchImpl = fetch,
  apiBaseUrl = process.env.OPENAI_BASE_URL || OPENAI_VIDEO_DEFAULTS.apiBaseUrl,
  model = process.env.OPENAI_VIDEO_MODEL || OPENAI_VIDEO_DEFAULTS.model,
  size = process.env.OPENAI_VIDEO_SIZE || OPENAI_VIDEO_DEFAULTS.size,
  pollIntervalMs = Number(process.env.OPENAI_VIDEO_POLL_MS) || OPENAI_VIDEO_DEFAULTS.pollIntervalMs,
  timeoutMs = Number(process.env.OPENAI_VIDEO_TIMEOUT_MS) || OPENAI_VIDEO_DEFAULTS.timeoutMs
} = {}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for OpenAI video rendering.");
  if (!episode?.id) throw new Error("Episode data is required for OpenAI video rendering.");
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required for OpenAI video rendering.");

  const outputDir = path.join(rootDir, "outputs", projectId, episode.id);
  const outputPath = path.join(outputDir, "final.mp4");
  await mkdir(outputDir, { recursive: true });

  const seconds = normalizeVideoSeconds(duration);
  const prompt = buildOpenAiVideoPrompt(episode);
  let video = await createVideoJob({
    apiKey,
    apiBaseUrl,
    fetchImpl,
    model,
    prompt,
    seconds,
    size
  });

  const deadline = Date.now() + Math.max(30_000, timeoutMs);
  while (["queued", "in_progress"].includes(video.status) && Date.now() < deadline) {
    await delay(Math.max(500, pollIntervalMs));
    video = await retrieveVideoJob({ apiKey, apiBaseUrl, fetchImpl, videoId: video.id });
  }

  if (video.status !== "completed") {
    throw new Error(`OpenAI video job ${video.id ?? "unknown"} ended with status ${video.status ?? "unknown"}.`);
  }

  const content = await downloadVideoContent({ apiKey, apiBaseUrl, fetchImpl, videoId: video.id });
  await writeFile(outputPath, content);

  return {
    project: projectId,
    episode: episode.id,
    output_path: outputPath,
    renderer: "openai-video",
    video_job_id: video.id,
    model,
    seconds,
    size,
    image2_asset_count: 0,
    image2_assets_used: []
  };
}

export function buildOpenAiVideoPrompt(episode) {
  const shots = Array.isArray(episode.shots)
    ? episode.shots
      .slice(0, 6)
      .map((shot, index) => `${index + 1}. ${shot.visual ?? ""} Motion: ${shot.video_prompt ?? ""}`.trim())
      .join("\n")
    : "";
  const voiceover = Array.isArray(episode.voiceover) ? episode.voiceover.join(" ") : "";
  return [
    `Create a vertical 9:16 short video for: ${episode.title}.`,
    `Hook: ${episode.hook}`,
    `World and style: ${episode.world}; ${episode.visual_style}.`,
    shots ? `Shot plan:\n${shots}` : "",
    voiceover ? `Narration intent: ${voiceover}` : "",
    "No visible text, no watermark, cinematic motion, safe original characters."
  ].filter(Boolean).join("\n");
}

async function createVideoJob({ apiKey, apiBaseUrl, fetchImpl, model, prompt, seconds, size }) {
  const form = new FormData();
  form.set("model", model);
  form.set("prompt", prompt);
  form.set("seconds", String(seconds));
  form.set("size", size);

  const response = await fetchImpl(`${apiBaseUrl}/videos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });
  if (!response.ok) throw new Error(`OpenAI video create request failed with ${response.status}.`);
  const video = await response.json();
  if (!video?.id) throw new Error("OpenAI video create response did not include a video id.");
  return video;
}

async function retrieveVideoJob({ apiKey, apiBaseUrl, fetchImpl, videoId }) {
  const response = await fetchImpl(`${apiBaseUrl}/videos/${encodeURIComponent(videoId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });
  if (!response.ok) throw new Error(`OpenAI video status request failed with ${response.status}.`);
  return response.json();
}

async function downloadVideoContent({ apiKey, apiBaseUrl, fetchImpl, videoId }) {
  const response = await fetchImpl(`${apiBaseUrl}/videos/${encodeURIComponent(videoId)}/content`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });
  if (!response.ok) throw new Error(`OpenAI video download request failed with ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

function normalizeVideoSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return OPENAI_VIDEO_DEFAULTS.seconds;
  return Math.max(4, Math.min(20, Math.floor(numeric)));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
