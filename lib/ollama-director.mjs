import { OPENAI_VIDEO_BATCH_SCHEMA, createProjectFromOpenAiDraft } from "./openai-director.mjs";

export const OLLAMA_DEFAULTS = {
  apiBaseUrl: "http://127.0.0.1:11434",
  model: "qwen3.6:latest"
};

export function createOllamaDirectorPrompt({
  topic = "AI cartoon fruit drama",
  count = 5,
  sourceType = "text idea"
} = {}) {
  const requestedEpisodes = Math.max(1, Math.min(Number(count) || 5, 12));
  return [
    "You are a short-video creative director.",
    "Create original vertical short-video production plans.",
    "Preserve pacing and genre grammar, but do not copy source characters, captions, usernames, watermarks, frames, or exact plots.",
    "Return JSON only. Do not include markdown, comments, or analysis.",
    `Source type: ${sourceType}`,
    `Topic or reference summary: ${topic}`,
    `Episode count: ${requestedEpisodes}`,
    "The JSON must match this schema:",
    JSON.stringify(OPENAI_VIDEO_BATCH_SCHEMA)
  ].join("\n");
}

export function createOllamaDirectorPayload({
  topic = "AI cartoon fruit drama",
  count = 5,
  sourceType = "text idea",
  model = process.env.OLLAMA_MODEL || OLLAMA_DEFAULTS.model
} = {}) {
  return {
    model,
    prompt: createOllamaDirectorPrompt({ topic, count, sourceType }),
    format: OPENAI_VIDEO_BATCH_SCHEMA,
    stream: false,
    options: {
      temperature: 0.7
    }
  };
}

export async function checkOllamaLiveAccess({
  fetchImpl = fetch,
  apiBaseUrl = process.env.OLLAMA_BASE_URL || OLLAMA_DEFAULTS.apiBaseUrl,
  model = process.env.OLLAMA_MODEL || OLLAMA_DEFAULTS.model
} = {}) {
  try {
    const response = await fetchImpl(`${apiBaseUrl}/api/tags`);
    if (!response.ok) {
      return {
        ok: true,
        live_request_sent: true,
        live_access: false,
        status: "fail",
        endpoint: "/api/tags",
        model,
        error_class: "api_error",
        message: `Ollama tags request failed with ${response.status}.`
      };
    }

    const data = await response.json();
    const models = Array.isArray(data.models) ? data.models : [];
    const names = models.map((entry) => entry.name ?? entry.model).filter(Boolean);
    const configured = names.includes(model);
    return {
      ok: true,
      live_request_sent: true,
      live_access: configured,
      status: configured ? "pass" : "fail",
      endpoint: "/api/tags",
      model,
      available_models: names.slice(0, 12),
      error_class: configured ? undefined : "missing_model",
      message: configured
        ? `Ollama model ${model} is available.`
        : `Ollama is running, but model ${model} is not installed.`
    };
  } catch (error) {
    return {
      ok: true,
      live_request_sent: true,
      live_access: false,
      status: "fail",
      endpoint: "/api/tags",
      model,
      error_class: "network",
      message: `Ollama is not reachable (${sanitizeProviderMessage(error instanceof Error ? error.message : String(error))}).`
    };
  }
}

export async function generateProjectWithOllama({
  topic = "AI cartoon fruit drama",
  count = 5,
  sourceType = "text idea",
  sourceAsset = null,
  chatGptAccountVerified = false,
  chatGptAccountSource = "missing",
  openAiConfigured = false,
  openAiSource = "missing",
  videoProvider = process.env.VIDEO_PROVIDER ?? "local-ffmpeg",
  fetchImpl = fetch,
  apiBaseUrl = process.env.OLLAMA_BASE_URL || OLLAMA_DEFAULTS.apiBaseUrl,
  model = process.env.OLLAMA_MODEL || OLLAMA_DEFAULTS.model
} = {}) {
  const response = await fetchImpl(`${apiBaseUrl}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(createOllamaDirectorPayload({ topic, count, sourceType, model }))
  });

  if (!response.ok) {
    const detail = sanitizeProviderMessage(await response.text().catch(() => ""));
    throw new Error(`Ollama generation request failed with ${response.status}${detail ? ` (${detail.slice(0, 240)})` : ""}.`);
  }

  const data = await response.json();
  const draft = extractOllamaStructuredDraft(data);
  return createProjectFromOpenAiDraft(draft, {
    topic,
    sourceType,
    sourceAsset,
    chatGptAccountVerified,
    chatGptAccountSource,
    openAiConfigured,
    openAiSource,
    localLlmConfigured: true,
    localLlmSource: apiBaseUrl,
    localLlmModel: model,
    videoProvider,
    providerMode: "local-llm",
    namePrefix: "Ollama Batch"
  });
}

export function extractOllamaStructuredDraft(response) {
  if (response?.output_parsed) return response.output_parsed;
  if (response?.response && typeof response.response === "object") return response.response;
  if (typeof response?.response === "string" && response.response.trim()) return JSON.parse(extractJsonObject(response.response));
  if (typeof response?.thinking === "string" && response.thinking.trim()) return JSON.parse(extractJsonObject(response.thinking));
  if (typeof response?.message?.content === "string" && response.message.content.trim()) return JSON.parse(extractJsonObject(response.message.content));
  if (typeof response === "string") return JSON.parse(extractJsonObject(response));
  throw new Error("Ollama response did not include structured JSON output.");
}

function extractJsonObject(text) {
  const withoutThinking = String(text ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = withoutThinking.indexOf("{");
  const end = withoutThinking.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Ollama response did not contain a JSON object.");
  }
  return withoutThinking.slice(start, end + 1);
}

function sanitizeProviderMessage(message) {
  return String(message ?? "")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-key]")
    .replace(/\s+/g, " ")
    .trim();
}
