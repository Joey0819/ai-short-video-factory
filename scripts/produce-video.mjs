#!/usr/bin/env node
import { createFactoryProject } from "../lib/factory-core.mjs";
import { produceVideos } from "../lib/production-pipeline.mjs";
import { readChatGptAccountPresence, readOpenAiKeyPresence } from "../lib/provider-plan.mjs";

function parseArgs(argv) {
  const args = {
    topic: "AI cartoon fruit drama",
    count: 3,
    renderCount: undefined,
    sourceType: "text idea",
    renderDuration: undefined,
    videoProvider: process.env.VIDEO_PROVIDER ?? "local-ffmpeg"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--topic" && value) {
      args.topic = value;
      index += 1;
    } else if (key === "--count" && value) {
      args.count = Number(value);
      index += 1;
    } else if (key === "--render-count" && value) {
      args.renderCount = Number(value);
      index += 1;
    } else if (key === "--source-type" && value) {
      args.sourceType = value;
      index += 1;
    } else if (key === "--render-duration" && value) {
      args.renderDuration = Number(value);
      index += 1;
    } else if (key === "--video-provider" && value) {
      args.videoProvider = value;
      index += 1;
    }
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
const keyPresence = await readOpenAiKeyPresence();
const accountPresence = await readChatGptAccountPresence();
const project = createFactoryProject({
  topic: args.topic,
  count: args.count,
  sourceType: args.sourceType,
  openAiConfigured: keyPresence.configured,
  openAiSource: keyPresence.source,
  chatGptAccountVerified: accountPresence.configured,
  chatGptAccountSource: accountPresence.source,
  videoProvider: args.videoProvider
});

const production = await produceVideos({
  rootDir: process.cwd(),
  project,
  renderCount: Number.isFinite(Number(args.renderCount)) ? args.renderCount : args.count,
  renderDuration: args.renderDuration
});

console.log(`Produced ${production.project.episodes.length} content drafts.`);
console.log(`Rendered ${production.artifacts.length} MP4 video artifact${production.artifacts.length === 1 ? "" : "s"}.`);
const image2AssetsUsed = production.artifacts.reduce((sum, artifact) => sum + (Number(artifact.image2_assets_used) || 0), 0);
if (image2AssetsUsed) {
  console.log(`Composited ${image2AssetsUsed} Image 2 still${image2AssetsUsed === 1 ? "" : "s"} into the rendered MP4 output.`);
}
for (const artifact of production.artifacts) {
  console.log(`${artifact.episode_id}: ${artifact.output_path}`);
}
console.log(`OpenAI key configured: ${keyPresence.configured ? "yes" : "no"}.`);
console.log(`ChatGPT account verified: ${accountPresence.configured ? "yes" : "no"}.`);
