import test from "node:test";
import assert from "node:assert/strict";
import {
  OPENAI_DEFAULTS,
  checkOpenAiLiveAccess,
  createChatGptAccountDryRunReport,
  createImageGenerationPayload,
  createOpenAiDirectorPayload,
  createOpenAiDryRunReport,
  createOpenAiLiveCheckPayload,
  createProjectFromOpenAiDraft,
  createSpeechPayload,
  generateProjectWithOpenAi
} from "../lib/openai-director.mjs";

const sampleDraft = {
  recipe: {
    recipe_name: "OpenAI Director Batch",
    source_summary: "AI bakery courtroom drama",
    genre: "vertical AI short drama",
    visual_style: "cinematic 3D pastry characters",
    originality_rules: ["Change characters and plot.", "Do not copy watermarks or exact captions."]
  },
  episodes: [
    {
      title: "The Croissant Judge Froze",
      hook: "The verdict changed when the crumbs glowed.",
      world: "bakery courtroom",
      genre: "pastry legal drama",
      visual_style: "glossy pastry characters in a courtroom",
      duration_seconds: 28,
      hashtags: ["#aistory", "#shorts", "#pastrydrama"],
      captions: [
        { start: 0, end: 3, text: "THE COURT FROZE" },
        { start: 4, end: 7, text: "ONE CRUMB GLOWED" },
        { start: 8, end: 11, text: "PART 2?" }
      ],
      voiceover: ["The courtroom was quiet.", "Then the evidence started glowing.", "Nobody knew what it meant."],
      shots: [
        {
          duration_seconds: 4,
          visual: "Establish bakery courtroom.",
          image_prompt: "Vertical 9:16 pastry courtroom, no text.",
          video_prompt: "Slow push-in."
        },
        {
          duration_seconds: 4,
          visual: "Judge reacts.",
          image_prompt: "Vertical 9:16 pastry judge close-up, no text.",
          video_prompt: "Eyes widen."
        },
        {
          duration_seconds: 4,
          visual: "Crumb evidence glows.",
          image_prompt: "Vertical 9:16 glowing crumb evidence, no text.",
          video_prompt: "Subtle glow pulse."
        },
        {
          duration_seconds: 4,
          visual: "Crowd gasps.",
          image_prompt: "Vertical 9:16 pastry crowd reaction, no text.",
          video_prompt: "Fast reaction cut."
        }
      ]
    }
  ]
};

test("OpenAI director payload uses Responses structured output", () => {
  const payload = createOpenAiDirectorPayload({ topic: "bakery drama", count: 3 });
  assert.equal(payload.model, OPENAI_DEFAULTS.textModel);
  assert.equal(payload.text.format.type, "json_schema");
  assert.equal(payload.text.format.strict, true);
  assert.equal(payload.text.format.schema.required.includes("episodes"), true);
});

test("OpenAI live check payload uses a tiny structured Responses request", () => {
  const payload = createOpenAiLiveCheckPayload();
  assert.equal(payload.model, OPENAI_DEFAULTS.textModel);
  assert.equal(payload.text.format.name, "provider_live_check");
  assert.equal(payload.text.format.strict, true);
  assert.equal(payload.max_output_tokens, 32);
  assert.equal(JSON.stringify(payload).includes("sk-proj"), false);
});

test("media payload builders match configured provider plan", () => {
  const image = createImageGenerationPayload({ prompt: "Vertical 9:16 test image" });
  assert.equal(image.model, OPENAI_DEFAULTS.imageModel);
  assert.equal(image.size, "1080x1920");

  const speech = createSpeechPayload({ input: "The room went silent." });
  assert.equal(speech.model, OPENAI_DEFAULTS.speechModel);
  assert.equal(speech.response_format, "mp3");
});

test("OpenAI live check reports live access without exposing the key", async () => {
  const report = await checkOpenAiLiveAccess({
    apiKey: "sk-proj-fake-test-key",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(options.headers.Authorization, "Bearer sk-proj-fake-test-key");
      assert.equal(JSON.stringify(options.body).includes("sk-proj-fake-test-key"), false);
      return new Response(JSON.stringify({ output_text: "{\"ok\":true}" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  assert.equal(report.live_request_sent, true);
  assert.equal(report.live_access, true);
  assert.equal(report.status, "pass");
  assert.equal(JSON.stringify(report).includes("sk-proj-fake-test-key"), false);
});

test("OpenAI live check classifies insufficient quota safely", async () => {
  const report = await checkOpenAiLiveAccess({
    apiKey: "sk-proj-fake-test-key",
    fetchImpl: async () => new Response(JSON.stringify({
      error: {
        code: "insufficient_quota",
        type: "insufficient_quota",
        message: "Quota failed for key sk-proj-fake-test-key."
      }
    }), {
      status: 429,
      headers: { "Content-Type": "application/json" }
    })
  });

  assert.equal(report.live_request_sent, true);
  assert.equal(report.live_access, false);
  assert.equal(report.error_class, "quota");
  assert.match(report.message, /insufficient_quota/);
  assert.equal(JSON.stringify(report).includes("sk-proj-fake-test-key"), false);
});

test("dry-run report never sends a live request", () => {
  const report = createOpenAiDryRunReport({ count: 2, openAiConfigured: false });
  assert.equal(report.live_request_sent, false);
  assert.equal(report.openai_key_configured, false);
  assert.equal(report.payload_summary.schema_name, "short_video_batch");
});

test("ChatGPT account dry-run uses account auth instead of API keys", () => {
  const report = createChatGptAccountDryRunReport({
    topic: "bakery drama",
    count: 2,
    accountVerified: true
  });
  assert.equal(report.live_request_sent, false);
  assert.equal(report.uses_api_key, false);
  assert.equal(report.account_verified, true);
  assert.equal(report.auth_method, "ChatGPT Apps OAuth 2.1");
  assert.equal(report.models.image, OPENAI_DEFAULTS.imageModel);
});

test("OpenAI draft normalizes into a factory project", () => {
  const project = createProjectFromOpenAiDraft(sampleDraft);
  assert.equal(project.provider_mode, "live");
  assert.equal(project.episodes.length, 1);
  assert.equal(project.episodes[0].shots.length, 4);
  assert.equal(project.episodes[0].captions_path, "outputs/demo-reference/episode-001/captions.srt");
});

test("live generator calls Responses endpoint without exposing the key", async () => {
  const project = await generateProjectWithOpenAi({
    apiKey: "sk-proj-fake-test-key",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(options.headers.Authorization, "Bearer sk-proj-fake-test-key");
      assert.equal(JSON.stringify(options.body).includes("sk-proj-fake-test-key"), false);
      return {
        ok: true,
        async json() {
          return { output_text: JSON.stringify(sampleDraft) };
        }
      };
    }
  });

  assert.equal(project.provider_mode, "live");
  assert.equal(JSON.stringify(project).includes("sk-proj-fake-test-key"), false);
});

test("live generator surfaces sanitized OpenAI API error details", async () => {
  await assert.rejects(
    () => generateProjectWithOpenAi({
      apiKey: "sk-proj-fake-test-key",
      fetchImpl: async () => new Response(JSON.stringify({
        error: {
          code: "rate_limit_exceeded",
          type: "requests",
          message: "Slow down for key sk-proj-fake-test-key."
        }
      }), {
        status: 429,
        headers: { "Content-Type": "application/json" }
      })
    }),
    (error) => {
      assert.match(error.message, /429/);
      assert.match(error.message, /rate_limit_exceeded/);
      assert.equal(error.message.includes("sk-proj-fake-test-key"), false);
      return true;
    }
  );
});
