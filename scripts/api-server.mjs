#!/usr/bin/env node
import { createApiServer } from "../lib/backend-api.mjs";
import { loadLocalEnv } from "../lib/provider-plan.mjs";

await loadLocalEnv();
const configuredPort = parsePort(process.argv.slice(2)) ?? Number(process.env.API_PORT);
const port = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 3030;
const host = process.env.API_HOST || "127.0.0.1";
const server = createApiServer({ rootDir: process.cwd() });

server.listen(port, host, () => {
  console.log(`AI Short Video Factory API listening on http://${host}:${port}`);
});

function parsePort(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--port" && argv[index + 1]) {
      return Number(argv[index + 1]);
    }
  }
  return undefined;
}
