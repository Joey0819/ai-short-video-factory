import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildOpenAiVideoPrompt, renderOpenAiVideo } from "../lib/openai-video-renderer.mjs";

const episode = {
  id: "episode-001",
  title: "The Ramen Sign Blinked Twice",
  hook: "The detective noticed the sign blinked only when the bowl was empty.",
  world: "neon ramen alley",
  visual_style: "rainy neon mystery short",
  voiceover: ["The alley was quiet.", "The sign blinked twice."],
  shots: [
    {
      visual: "A detective enters a neon ramen alley.",
      video_prompt: "Slow rainy push-in."
    },
    {
      visual: "An empty bowl sits under a spotlight.",
      video_prompt: "Slow zoom toward the bowl."
    }
  ]
};

test("OpenAI video prompt includes episode content", () => {
  const prompt = buildOpenAiVideoPrompt(episode);
  assert.match(prompt, /The Ramen Sign Blinked Twice/);
  assert.match(prompt, /neon ramen alley/);
  assert.match(prompt, /Slow rainy push-in/);
});

test("OpenAI video renderer creates, polls, downloads, and writes final MP4", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ai-short-video-openai-renderer-"));
  const calls = [];
  const fakeMp4 = Buffer.from("fake-openai-video-mp4-bytes");

  const render = await renderOpenAiVideo({
    apiKey: "sk-proj-fake-test-key",
    rootDir,
    projectId: "demo-reference",
    episode,
    duration: 6,
    pollIntervalMs: 1,
    timeoutMs: 1_000,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), method: options.method, hasAuth: Boolean(options.headers.Authorization), body: options.body });
      if (String(url).endsWith("/videos")) {
        assert.equal(options.headers.Authorization, "Bearer sk-proj-fake-test-key");
        assert.equal(typeof options.body.get, "function");
        assert.equal(options.body.get("model"), "sora-2");
        assert.equal(options.body.get("seconds"), "6");
        return new Response(JSON.stringify({ id: "video_test", status: "queued", progress: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (String(url).endsWith("/videos/video_test")) {
        return new Response(JSON.stringify({ id: "video_test", status: "completed", progress: 100 }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (String(url).endsWith("/videos/video_test/content")) {
        return new Response(fakeMp4, {
          status: 200,
          headers: { "Content-Type": "video/mp4" }
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  });

  try {
    assert.equal(render.renderer, "openai-video");
    assert.equal(render.video_job_id, "video_test");
    assert.equal(render.output_path, path.join(rootDir, "outputs", "demo-reference", "episode-001", "final.mp4"));
    assert.deepEqual(await readFile(render.output_path), fakeMp4);
    assert.deepEqual(calls.map((call) => call.method), ["POST", "GET", "GET"]);
    assert.equal(JSON.stringify(calls).includes("sk-proj-fake-test-key"), false);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
