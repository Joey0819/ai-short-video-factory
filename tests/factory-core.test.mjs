import test from "node:test";
import assert from "node:assert/strict";
import {
  captionsToSrt,
  createFactoryProject,
  createVideoRecipe,
  generateEpisodes
} from "../lib/factory-core.mjs";
import { createProviderReadiness, parseEnvContent } from "../lib/provider-plan.mjs";

test("recipe includes required originality and caption rules", () => {
  const recipe = createVideoRecipe({ topic: "fruit hospital reference" });
  assert.equal(recipe.aspect_ratio, "9:16");
  assert.equal(recipe.caption_style.words_per_caption, "2-5");
  assert.ok(recipe.originality_rules.some((rule) => rule.includes("Do not copy")));
});

test("episode generation creates structured shots and metadata", () => {
  const recipe = createVideoRecipe();
  const episodes = generateEpisodes(recipe, { count: 4 });
  assert.equal(episodes.length, 4);
  assert.equal(episodes[0].shots.length, 6);
  assert.equal(episodes[0].captions.length, 5);
  assert.equal(episodes[0].output_path, "outputs/demo-reference/episode-001/final.mp4");
});

test("custom topics shape local episode content", () => {
  const topic = "AI robot bakery courtroom drama";
  const recipe = createVideoRecipe({ topic });
  const episodes = generateEpisodes(recipe, { topic, count: 2 });

  assert.equal(recipe.source_summary, topic);
  assert.equal(recipe.genre, "vertical robot bakery courtroom drama short drama");
  assert.equal(episodes[0].world, "robot bakery courtroom");
  assert.match(episodes[0].title, /Robot Bakery Courtroom/);
  assert.match(episodes[0].visual_style, /robot bakery courtroom drama/);
  assert.ok(episodes[0].hashtags.includes("#robotbakerycourtroom"));
  assert.notEqual(episodes[0].title, "The Baby Was Not an Orange");
});

test("factory project builds a job timeline", () => {
  const sourceAsset = {
    id: "ref-test",
    kind: "video",
    file_name: "reference.mp4",
    stored_name: "ref-test-reference.mp4",
    mime_type: "video/mp4",
    size_bytes: 2048,
    sha256: "abc",
    storage_path: "storage/projects/demo-reference/reference-assets/ref-test-reference.mp4",
    artifact_path: "/api/artifact/demo-reference/reference/ref-test-reference.mp4",
    uploaded_at: "2026-06-15T00:00:00.000Z"
  };
  const project = createFactoryProject({ count: 6, sourceAsset });
  assert.equal(project.provider_mode, "local");
  assert.equal(project.source_asset.file_name, "reference.mp4");
  assert.equal(project.jobs[0].label, "Queued");
  assert.ok(project.jobs.some((job) => job.id === "review"));
  assert.equal(project.provider_status.api_key.configured, false);
  assert.equal(project.provider_status.steps.at(-1).provider, "Local FFmpeg");
});

test("captions export uses SRT time format", () => {
  const output = captionsToSrt([{ start: 1.5, end: 3.25, text: "UNFORTUNATELY" }]);
  assert.equal(output.trim(), "1\n00:00:01,500 --> 00:00:03,250\nUNFORTUNATELY");
});

test("provider readiness never exposes secret values", () => {
  const parsed = parseEnvContent("OPENAI_API_KEY=sk-proj-secret-value\nVIDEO_PROVIDER=runway\n");
  const readiness = createProviderReadiness({
    openAiConfigured: Boolean(parsed.OPENAI_API_KEY),
    openAiSource: ".env.local",
    videoProvider: parsed.VIDEO_PROVIDER
  });

  assert.equal(readiness.api_key.configured, true);
  assert.equal(readiness.account_auth.configured, false);
  assert.equal(readiness.mcp_app.configured, true);
  assert.equal(readiness.steps.find((step) => step.id === "chatgpt-account").provider, "Account verification pending");
  assert.equal(readiness.steps.find((step) => step.id === "llm-director").provider, "OpenAI Responses API");
  assert.equal(JSON.stringify(readiness).includes("sk-proj-secret-value"), false);
});
