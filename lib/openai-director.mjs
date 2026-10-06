import { randomUUID } from "node:crypto";
import { createProviderReadiness } from "./provider-plan.mjs";
import { DEFAULT_PROJECT_ID, buildJobs, captionsToSrt } from "./factory-core.mjs";

export const OPENAI_DEFAULTS = {
  apiBaseUrl: "https://api.openai.com/v1",
  textModel: "gpt-5.5",
  imageModel: "gpt-image-2",
  speechModel: "gpt-4o-mini-tts",
  voice: "coral"
};

export const OPENAI_VIDEO_BATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["recipe", "episodes"],
  properties: {
    recipe: {
      type: "object",
      additionalProperties: false,
      required: ["recipe_name", "source_summary", "genre", "visual_style", "originality_rules"],
      properties: {
        recipe_name: { type: "string" },
        source_summary: { type: "string" },
        genre: { type: "string" },
        visual_style: { type: "string" },
        originality_rules: { type: "array", items: { type: "string" } }
      }
    },
    episodes: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "hook", "world", "genre", "visual_style", "duration_seconds", "hashtags", "captions", "voiceover", "shots"],
        properties: {
          title: { type: "string" },
          hook: { type: "string" },
          world: { type: "string" },
          genre: { type: "string" },
          visual_style: { type: "string" },
          duration_seconds: { type: "integer", minimum: 15, maximum: 60 },
          hashtags: { type: "array", minItems: 3, maxItems: 8, items: { type: "string" } },
          captions: {
            type: "array",
            minItems: 3,
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["start", "end", "text"],
              properties: {
                start: { type: "number" },
                end: { type: "number" },
                text: { type: "string" }
              }
            }
          },
          voiceover: { type: "array", minItems: 3, maxItems: 8, items: { type: "string" } },
          shots: {
            type: "array",
            minItems: 4,
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["duration_seconds", "visual", "image_prompt", "video_prompt"],
              properties: {
                duration_seconds: { type: "integer", minimum: 2, maximum: 8 },
                visual: { type: "string" },
                image_prompt: { type: "string" },
                video_prompt: { type: "string" }
              }
            }
          }
        }
      }
    }
  }
};

export const OPENAI_LIVE_CHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: {
    ok: { type: "boolean" }
  }
};

export function createOpenAiDirectorPayload({
  topic = "AI cartoon fruit drama",
  count = 5,
  sourceType = "text idea",
  model = process.env.OPENAI_TEXT_MODEL || OPENAI_DEFAULTS.textModel
} = {}) {
  return {
    model,
    reasoning: { effort: "low" },
    input: [
      {
        role: "system",
        content:
          "You are a short-video creative director. Create original vertical short-video production plans. Preserve pacing and genre grammar, but do not copy source characters, captions, usernames, watermarks, frames, or exact plots."
      },
      {
        role: "user",
        content: `Source type: ${sourceType}\nTopic or reference summary: ${topic}\nEpisode count: ${Math.max(1, Math.min(Number(count) || 5, 12))}\nReturn a production-ready batch with concise hooks, captions, voiceover lines, shot prompts, and originality-safe visual direction.`
      }
    ],
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "short_video_batch",
        strict: true,
        schema: OPENAI_VIDEO_BATCH_SCHEMA
      }
    }
  };
}

export function createOpenAiLiveCheckPayload({
  model = process.env.OPENAI_TEXT_MODEL || OPENAI_DEFAULTS.textModel
} = {}) {
  return {
    model,
    input: [
      {
        role: "user",
        content: 'Return the JSON object {"ok":true}.'
      }
    ],
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "provider_live_check",
        strict: true,
        schema: OPENAI_LIVE_CHECK_SCHEMA
      }
    },
    max_output_tokens: 32
  };
}

export function createImageGenerationPayload({ prompt, model = process.env.OPENAI_IMAGE_MODEL || OPENAI_DEFAULTS.imageModel } = {}) {
  return {
    model,
    prompt,
    size: "1080x1920",
    quality: "medium",
    n: 1
  };
}

export function createSpeechPayload({
  input,
  instructions = "Speak like an energetic short-video narrator with suspense and clear pacing.",
  model = process.env.OPENAI_TTS_MODEL || OPENAI_DEFAULTS.speechModel,
  voice = process.env.OPENAI_TTS_VOICE || OPENAI_DEFAULTS.voice
} = {}) {
  return {
    model,
    voice,
    input,
    instructions,
    response_format: "mp3"
  };
}

export async function checkOpenAiLiveAccess({
  apiKey,
  fetchImpl = fetch,
  apiBaseUrl = process.env.OPENAI_BASE_URL || OPENAI_DEFAULTS.apiBaseUrl
} = {}) {
  const payload = createOpenAiLiveCheckPayload();
  const endpoint = "/v1/responses";

  if (!apiKey) {
    return {
      ok: true,
      live_request_sent: false,
      live_access: false,
      status: "fail",
      endpoint,
      model: payload.model,
      error_class: "missing_key",
      message: "OPENAI_API_KEY is not configured."
    };
  }

  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for OpenAI live access checks.");
  }

  try {
    const response = await fetchImpl(`${apiBaseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const detail = await readOpenAiErrorDetail(response);
      return {
        ok: true,
        live_request_sent: true,
        live_access: false,
        status: "fail",
        endpoint,
        model: payload.model,
        error_class: classifyOpenAiError(detail),
        message: `OpenAI Responses request failed with ${response.status}${formatOpenAiErrorDetail(detail)}.`
      };
    }

    await response.json().catch(() => null);
    return {
      ok: true,
      live_request_sent: true,
      live_access: true,
      status: "pass",
      endpoint,
      model: payload.model,
      message: "OpenAI Responses API accepted the live provider check."
    };
  } catch (error) {
    return {
      ok: true,
      live_request_sent: true,
      live_access: false,
      status: "fail",
      endpoint,
      model: payload.model,
      error_class: "network",
      message: `OpenAI live check could not reach the API (${sanitizeOpenAiErrorMessage(error instanceof Error ? error.message : String(error))}).`
    };
  }
}

export async function generateProjectWithOpenAi({
  apiKey,
  topic = "AI cartoon fruit drama",
  count = 5,
  sourceType = "text idea",
  sourceAsset = null,
  chatGptAccountVerified = false,
  chatGptAccountSource = "missing",
  videoProvider = process.env.VIDEO_PROVIDER ?? "local-ffmpeg",
  fetchImpl = fetch,
  apiBaseUrl = process.env.OPENAI_BASE_URL || OPENAI_DEFAULTS.apiBaseUrl
} = {}) {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for live OpenAI generation.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for OpenAI generation.");
  }

  const response = await fetchImpl(`${apiBaseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(createOpenAiDirectorPayload({ topic, count, sourceType }))
  });

  if (!response.ok) {
    throw new Error(`OpenAI Responses request failed with ${response.status}${await formatOpenAiError(response)}.`);
  }

  const data = await response.json();
  const draft = extractStructuredDraft(data);
  return createProjectFromOpenAiDraft(draft, {
    topic,
    sourceType,
    sourceAsset,
    chatGptAccountVerified,
    chatGptAccountSource,
    videoProvider
  });
}

async function formatOpenAiError(response) {
  return formatOpenAiErrorDetail(await readOpenAiErrorDetail(response));
}

async function readOpenAiErrorDetail(response) {
  const raw = await response.text().catch(() => "");
  const detail = {
    status: response.status,
    raw: sanitizeOpenAiErrorMessage(raw),
    code: "",
    type: "",
    message: ""
  };
  if (!raw) return detail;

  try {
    const parsed = JSON.parse(raw);
    const error = parsed?.error;
    detail.code = sanitizeOpenAiErrorMessage(error?.code ?? "");
    detail.type = sanitizeOpenAiErrorMessage(error?.type ?? "");
    detail.message = sanitizeOpenAiErrorMessage(error?.message ?? "");
  } catch {
    detail.message = detail.raw.slice(0, 240);
  }
  return detail;
}

function formatOpenAiErrorDetail(detail) {
  const parts = [
    detail.code ? `code=${detail.code}` : null,
    detail.type ? `type=${detail.type}` : null,
    detail.message ? `message=${detail.message}` : null
  ].filter(Boolean);
  if (parts.length > 0) return ` (${parts.join("; ")})`;
  return detail.raw ? ` (${detail.raw.slice(0, 240)})` : "";
}

function sanitizeOpenAiErrorMessage(message) {
  return String(message ?? "")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-key]")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyOpenAiError(detail) {
  const status = Number(detail.status);
  const normalized = `${detail.code} ${detail.type} ${detail.message}`.toLowerCase();
  if (normalized.includes("insufficient_quota") || normalized.includes("quota") || normalized.includes("billing")) return "quota";
  if (status === 401 || normalized.includes("invalid_api_key") || normalized.includes("authentication")) return "auth";
  if (status === 403 || normalized.includes("model_not_found") || normalized.includes("permission") || normalized.includes("access")) return "access";
  if (status === 429 || normalized.includes("rate_limit")) return "rate_limit";
  return "api_error";
}

export function createOpenAiDryRunReport({ topic = "AI cartoon fruit drama", count = 5, sourceType = "text idea", openAiConfigured = false } = {}) {
  const payload = createOpenAiDirectorPayload({ topic, count, sourceType });
  return {
    ok: true,
    live_request_sent: false,
    openai_key_configured: openAiConfigured,
    endpoints: {
      director: "/v1/responses",
      image: "/v1/images/generations",
      speech: "/v1/audio/speech"
    },
    models: {
      text: payload.model,
      image: process.env.OPENAI_IMAGE_MODEL || OPENAI_DEFAULTS.imageModel,
      speech: process.env.OPENAI_TTS_MODEL || OPENAI_DEFAULTS.speechModel
    },
    payload_summary: {
      response_format: payload.text.format.type,
      schema_name: payload.text.format.name,
      strict: payload.text.format.strict,
      requested_episodes: Math.max(1, Math.min(Number(count) || 5, 12))
    }
  };
}

export function createChatGptAccountDryRunReport({
  topic = "AI cartoon fruit drama",
  count = 5,
  sourceType = "text idea",
  accountVerified = false
} = {}) {
  const requestedEpisodes = Math.max(1, Math.min(Number(count) || 5, 12));
  return {
    ok: true,
    live_request_sent: false,
    uses_api_key: false,
    account_verified: accountVerified,
    auth_method: "ChatGPT Apps OAuth 2.1",
    endpoints: {
      app: "ChatGPT Apps MCP",
      director: "Account-auth VideoRecipe tool",
      image: "Image 2 account-auth handoff"
    },
    models: {
      text: process.env.OPENAI_TEXT_MODEL || OPENAI_DEFAULTS.textModel,
      image: process.env.OPENAI_IMAGE_MODEL || OPENAI_DEFAULTS.imageModel
    },
    payload_summary: {
      source_type: sourceType,
      topic,
      requested_episodes: requestedEpisodes
    }
  };
}

export function createProjectFromOpenAiDraft(draft, {
  topic = "AI cartoon fruit drama",
  sourceType = "text idea",
  sourceAsset = null,
  chatGptAccountVerified = false,
  chatGptAccountSource = "missing",
  videoProvider = process.env.VIDEO_PROVIDER ?? "local-ffmpeg",
  providerMode = "live",
  namePrefix = "OpenAI Batch",
  openAiConfigured = true,
  openAiSource = "runtime",
  localLlmConfigured = false,
  localLlmSource = "missing",
  localLlmModel = ""
} = {}) {
  if (!draft?.recipe || !Array.isArray(draft.episodes) || draft.episodes.length === 0) {
    throw new Error("OpenAI draft did not include a recipe and at least one episode.");
  }

  const providerStatus = createProviderReadiness({
    openAiConfigured,
    openAiSource,
    chatGptAccountVerified,
    chatGptAccountSource,
    localLlmConfigured,
    localLlmSource,
    localLlmModel,
    videoProvider
  });
  const recipe = {
    recipe_name: draft.recipe.recipe_name || "OpenAI Director Batch",
    source_type: sourceType,
    source_summary: draft.recipe.source_summary || topic,
    platform: "tiktok",
    aspect_ratio: "9:16",
    duration_range_seconds: { min: 20, max: 35 },
    genre: draft.recipe.genre || "vertical AI short drama",
    visual_style: draft.recipe.visual_style || "cinematic vertical short-video style",
    character_rules: [
      "Create new characters for every batch.",
      "Keep role archetypes, not exact identities.",
      "Use reference only for pacing, structure, and visual grammar."
    ],
    story_structure: [
      { beat_name: "hook", purpose: "open with the impossible reveal", duration_seconds: 3 },
      { beat_name: "setup", purpose: "show the normal expectation", duration_seconds: 6 },
      { beat_name: "detail", purpose: "reveal one strange clue", duration_seconds: 7 },
      { beat_name: "reaction", purpose: "let characters react emotionally", duration_seconds: 6 },
      { beat_name: "cliffhanger", purpose: "end before the answer", duration_seconds: 5 }
    ],
    shot_style: {
      camera_movements: ["slow push-in", "reaction close-up", "dramatic zoom", "subtle handheld drift"],
      shot_types: ["establishing shot", "two-shot", "object close-up", "reaction shot", "freeze cliffhanger"]
    },
    caption_style: {
      font_style: "bold white text with black stroke",
      position: "lower center",
      words_per_caption: "2-5",
      emphasis_rules: ["uppercase shock words", "one key phrase per beat", "never bake text into generated images"]
    },
    audio_style: {
      voice: "energetic narrator",
      music_mood: "suspenseful short-drama bed",
      sound_effects: ["heartbeat", "whoosh", "dramatic hit"]
    },
    originality_rules: draft.recipe.originality_rules?.length
      ? draft.recipe.originality_rules
      : ["Do not copy watermarks, usernames, exact frames, or original captions."]
  };

  const episodes = draft.episodes.map((episode, index) => normalizeOpenAiEpisode(episode, recipe, topic, index));
  return {
    id: DEFAULT_PROJECT_ID,
    name: `${namePrefix} ${randomUUID().slice(0, 8)}`,
    generated_at: new Date().toISOString(),
    provider_mode: providerMode,
    video_provider: videoProvider,
    providers: providerStatus.steps.map((step) => step.provider),
    source_asset: sourceAsset,
    provider_status: providerStatus,
    recipe,
    jobs: buildJobs(episodes),
    episodes
  };
}

export function extractStructuredDraft(response) {
  if (response.output_parsed) return response.output_parsed;
  if (response.output_text) return JSON.parse(response.output_text);

  const outputText = response.output
    ?.flatMap((item) => item.content ?? [])
    .find((content) => typeof content.text === "string")?.text;

  if (outputText) return JSON.parse(outputText);
  throw new Error("OpenAI response did not contain structured JSON output.");
}

function normalizeOpenAiEpisode(episode, recipe, topic, index) {
  const id = `episode-${String(index + 1).padStart(3, "0")}`;
  const captions = episode.captions.map((caption) => ({
    start: Number(caption.start),
    end: Number(caption.end),
    text: caption.text
  }));
  const normalized = {
    id,
    title: episode.title,
    source_topic: topic,
    hook: episode.hook,
    world: episode.world,
    genre: episode.genre,
    visual_style: episode.visual_style,
    duration_seconds: Number(episode.duration_seconds),
    status: index < 2 ? "generated" : "script",
    review_gate: "pending",
    created_at: new Date().toISOString(),
    output_path: `outputs/${DEFAULT_PROJECT_ID}/${id}/final.mp4`,
    metadata_path: `outputs/${DEFAULT_PROJECT_ID}/${id}/metadata.json`,
    captions_path: `outputs/${DEFAULT_PROJECT_ID}/${id}/captions.srt`,
    poster_path: "/assets/fruit-drama-preview.png",
    hashtags: episode.hashtags,
    captions,
    voiceover: episode.voiceover,
    shots: episode.shots.map((shot, shotIndex) => ({
      shot_id: shotIndex + 1,
      duration_seconds: Number(shot.duration_seconds),
      visual: shot.visual,
      image_prompt: shot.image_prompt,
      video_prompt: shot.video_prompt
    })),
    ai_disclosure: "This draft contains AI-generated visuals, voice, and captions.",
    recipe_snapshot: recipe.recipe_name
  };

  captionsToSrt(normalized.captions);
  return normalized;
}
