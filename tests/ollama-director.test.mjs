import test from "node:test";
import assert from "node:assert/strict";
import {
  OLLAMA_DEFAULTS,
  checkOllamaLiveAccess,
  createOllamaDirectorPayload,
  extractOllamaStructuredDraft,
  generateProjectWithOllama
} from "../lib/ollama-director.mjs";

const sampleDraft = {
  recipe: {
    recipe_name: "Ollama Director Batch",
    source_summary: "AI lantern train mystery",
    genre: "vertical AI mystery short",
    visual_style: "cinematic lantern train mystery",
    originality_rules: ["Create new characters.", "Do not copy watermarks or exact captions."]
  },
  episodes: [
    {
      title: "The Lantern Train Stopped",
      hook: "The conductor saw one lantern moving backward.",
      world: "lantern train",
      genre: "train mystery",
      visual_style: "moody lantern train with expressive characters",
      duration_seconds: 24,
      hashtags: ["#aistory", "#shorts", "#trainmystery"],
      captions: [
        { start: 0, end: 3, text: "THE TRAIN STOPPED" },
        { start: 4, end: 7, text: "ONE LIGHT MOVED" },
        { start: 8, end: 11, text: "WHO HELD IT?" }
      ],
      voiceover: ["The train stopped.", "A lantern moved backward.", "Nobody knew who held it."],
      shots: [
        {
          duration_seconds: 4,
          visual: "A lantern train stops in fog.",
          image_prompt: "Vertical 9:16 lantern train in fog, no text.",
          video_prompt: "Slow fog push-in."
        },
        {
          duration_seconds: 4,
          visual: "The conductor turns.",
          image_prompt: "Vertical 9:16 conductor reaction, no text.",
          video_prompt: "Subtle handheld turn."
        },
        {
          duration_seconds: 4,
          visual: "A lantern moves backward.",
          image_prompt: "Vertical 9:16 moving lantern clue, no text.",
          video_prompt: "Slow backward glide."
        },
        {
          duration_seconds: 4,
          visual: "Passengers react.",
          image_prompt: "Vertical 9:16 train passenger shock, no text.",
          video_prompt: "Fast reaction cut."
        }
      ]
    }
  ]
};

test("Ollama payload requests structured local LLM output", () => {
  const payload = createOllamaDirectorPayload({ topic: "lantern train", count: 1 });
  assert.equal(payload.model, OLLAMA_DEFAULTS.model);
  assert.equal(payload.stream, false);
  assert.equal(payload.format.required.includes("recipe"), true);
  assert.match(payload.prompt, /Return JSON only/);
});

test("Ollama live check reports installed local model", async () => {
  const report = await checkOllamaLiveAccess({
    model: "gemma-test:latest",
    fetchImpl: async (url) => {
      assert.equal(url, "http://127.0.0.1:11434/api/tags");
      return new Response(JSON.stringify({
        models: [{ name: "gemma-test:latest" }]
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  assert.equal(report.live_access, true);
  assert.equal(report.status, "pass");
});

test("Ollama parser extracts JSON from thinking and markdown wrappers", () => {
  const parsed = extractOllamaStructuredDraft(`<think>drafting</think>\n\`\`\`json\n${JSON.stringify(sampleDraft)}\n\`\`\``);
  assert.equal(parsed.recipe.source_summary, "AI lantern train mystery");
  assert.equal(parsed.episodes[0].title, "The Lantern Train Stopped");
});

test("Ollama parser accepts models that return JSON in thinking output", () => {
  const parsed = extractOllamaStructuredDraft({
    response: "",
    thinking: JSON.stringify(sampleDraft)
  });
  assert.equal(parsed.recipe.recipe_name, "Ollama Director Batch");
  assert.equal(parsed.episodes.length, 1);
});

test("Ollama generator normalizes into a local LLM factory project", async () => {
  const project = await generateProjectWithOllama({
    topic: "AI lantern train mystery",
    count: 1,
    model: "gemma-test:latest",
    fetchImpl: async (url, options) => {
      assert.equal(url, "http://127.0.0.1:11434/api/generate");
      assert.equal(JSON.parse(options.body).model, "gemma-test:latest");
      return new Response(JSON.stringify({
        response: JSON.stringify(sampleDraft)
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  assert.equal(project.provider_mode, "local-llm");
  assert.equal(project.provider_status.local_llm.configured, true);
  assert.equal(project.provider_status.local_llm.model, "gemma-test:latest");
  assert.equal(project.episodes[0].title, "The Lantern Train Stopped");
});
