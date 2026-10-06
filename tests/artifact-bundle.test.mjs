import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildPublishBundle } from "../lib/artifact-bundle.mjs";
import { createFactoryProject, writeFactoryProject } from "../lib/factory-core.mjs";

test("publish bundle writes caption, hashtag, copy, prompt, and manifest files", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ai-short-video-bundle-"));
  try {
    const project = createFactoryProject({ count: 2 });
    await writeFactoryProject(project, rootDir);
    const manifest = await buildPublishBundle({ rootDir, episodeId: "episode-001" });

    assert.equal(manifest.episode_id, "episode-001");
    assert.equal(manifest.publish_ready, true);

    const copy = await readFile(path.join(rootDir, manifest.files.publishCopy), "utf8");
    const captions = await readFile(path.join(rootDir, manifest.files.captions), "utf8");
    const hashtags = await readFile(path.join(rootDir, manifest.files.hashtags), "utf8");
    const image2Handoff = JSON.parse(await readFile(path.join(rootDir, manifest.files.image2Handoff), "utf8"));

    assert.match(copy, /# The Baby Was Not an Orange/);
    assert.match(copy, /Image 2 Handoff/);
    assert.match(captions, /00:00:04,500 --> 00:00:07,700/);
    assert.match(hashtags, /#aistory/);
    assert.equal(image2Handoff.model, "gpt-image-2");
    assert.equal(image2Handoff.uses_api_key, false);
    assert.equal(image2Handoff.status, "pending_account_verification");
    assert.ok(image2Handoff.prompts.length > 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
