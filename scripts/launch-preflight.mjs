#!/usr/bin/env node
import { resolveLaunchPreflight } from "../lib/launch-preflight.mjs";

const preflight = await resolveLaunchPreflight({ rootDir: process.cwd() });

console.log(`Launch ready: ${preflight.launch_ready ? "yes" : "no"}`);
console.log(`Local production ready: ${preflight.local_production_ready ? "yes" : "no"}`);
console.log(`Recommended provider: ${preflight.recommended_provider}`);
console.log(`Image model: ${preflight.image_model} (${preflight.uses_image_api_key ? "API key" : "account auth"})`);
for (const stage of preflight.stages) {
  const marker = stage.status === "pass" ? "[ok]" : stage.required ? "[gate]" : "[info]";
  console.log(`${marker} ${stage.label}: ${stage.summary}`);
}
if (preflight.blockers.length) {
  console.log("Launch blockers:");
  for (const blocker of preflight.blockers) console.log(`- ${blocker}`);
}
