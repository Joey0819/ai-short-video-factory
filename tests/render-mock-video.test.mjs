import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { attachImage2Assets } from "../lib/image2-assets.mjs";
import { createFactoryProject, writeFactoryProject } from "../lib/factory-core.mjs";
import { renderMockVideo } from "../scripts/render-mock-video.mjs";

test("renderer composites attached Image 2 stills into MP4 output", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ai-short-video-render-image2-"));
  try {
    const project = createFactoryProject({
      topic: "AI cartoon fruit drama",
      count: 1
    });
    await writeFactoryProject(project, rootDir);

    const fixture = await readFile(path.join(process.cwd(), "public/assets/fruit-drama-preview.png"));
    const manifest = await attachImage2Assets({
      rootDir,
      projectId: project.id,
      episodeId: "episode-001",
      assets: [{
        shotId: 1,
        fileName: "chatgpt-image2-shot-001.png",
        mimeType: "image/png",
        data: fixture.toString("base64")
      }],
      source: "chatgpt-account-test"
    });

    const render = await renderMockVideo({
      cwd: rootDir,
      project: project.id,
      episode: "episode-001",
      duration: 3
    });

    const video = await readFile(render.output_path);
    assert.ok(video.byteLength > 1000);
    assert.equal(render.image2_asset_count, 1);
    assert.equal(render.image2_assets_used[0].file_name, "shot-001.png");
    assert.equal(manifest.uses_api_key, false);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("renderer tolerates punctuation-heavy LLM captions", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ai-short-video-render-punctuation-"));
  try {
    const project = createFactoryProject({
      topic: "AI lantern train mystery",
      count: 1
    });
    project.episodes[0] = {
      ...project.episodes[0],
      title: "The Conductor's Question: 0.00?",
      hook: "It's not a pass anymore... it's a key.",
      captions: [
        { start: 0, end: 1.2, text: "It's not a pass anymore... it's a key." },
        { start: 1.2, end: 2.4, text: "But the tracks are: code, light, and memory." },
        { start: 2.4, end: 3, text: "Do I board? Or wake up?" }
      ],
      voiceover: [
        "I found a ticket floating in my coffee.",
        "It was warm. And it hummed."
      ],
      shots: [{
        shot_id: 1,
        duration_seconds: 3,
        visual: "A train arrives: silent, glowing, impossible.",
        image_prompt: "Vertical 9:16 glowing train, no text.",
        video_prompt: "Slow push-in: sparks, fog, and reflection."
      }]
    };
    await writeFactoryProject(project, rootDir);

    const render = await renderMockVideo({
      cwd: rootDir,
      project: project.id,
      episode: "episode-001",
      duration: 3
    });

    const video = await readFile(render.output_path);
    assert.ok(video.byteLength > 1000);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
