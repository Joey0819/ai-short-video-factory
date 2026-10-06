#!/usr/bin/env node
import { createFactoryProject, writeFactoryProject } from "../lib/factory-core.mjs";
import { readChatGptAccountPresence, readOpenAiKeyPresence } from "../lib/provider-plan.mjs";

function parseArgs(argv) {
  const args = {
    topic: "AI cartoon fruit drama",
    count: 5,
    sourceType: "text idea",
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
    } else if (key === "--source-type" && value) {
      args.sourceType = value;
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
  ...args,
  openAiConfigured: keyPresence.configured,
  openAiSource: keyPresence.source,
  chatGptAccountVerified: accountPresence.configured,
  chatGptAccountSource: accountPresence.source
});
await writeFactoryProject(project, process.cwd());

console.log(`Generated ${project.episodes.length} ${project.provider_mode} episodes for ${project.name}.`);
console.log(`OpenAI key configured: ${keyPresence.configured ? "yes" : "no"}.`);
console.log(`ChatGPT account verified: ${accountPresence.configured ? "yes" : "no"}.`);
console.log(`Dashboard state: public/factory-state.json`);
console.log(`Project state: storage/projects/${project.id}/project.json`);
