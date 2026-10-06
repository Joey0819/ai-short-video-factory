#!/usr/bin/env node
import { buildPublishBundle } from "../lib/artifact-bundle.mjs";

const args = parseArgs(process.argv.slice(2));
const manifest = await buildPublishBundle({
  rootDir: process.cwd(),
  episodeId: args.episode
});

console.log(`Publish bundle: ${manifest.files.manifest}`);
console.log(`Publish ready: ${manifest.publish_ready ? "yes" : "no"}`);

function parseArgs(argv) {
  const args = {
    episode: "episode-001"
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--episode" && argv[index + 1]) {
      args.episode = argv[index + 1];
      index += 1;
    }
  }
  return args;
}
