#!/usr/bin/env node
import path from "node:path";
import { createProductionServer } from "../lib/production-server.mjs";
import { loadLocalEnv } from "../lib/provider-plan.mjs";

const rootDir = process.cwd();
await loadLocalEnv({ envFilePath: path.join(rootDir, ".env.local") });

const configuredPort = parsePort(process.argv.slice(2)) ?? Number(process.env.PORT ?? process.env.API_PORT);
const port = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 3030;
const host = process.env.HOST || process.env.API_HOST || "0.0.0.0";
const server = createProductionServer({ rootDir });

server.listen(port, host, () => {
  console.log(`AI Short Video Factory production server listening on http://${host}:${port}`);
  console.log("Serving built dashboard from ./dist with API/MCP routes on the same origin.");
});

function parsePort(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    if ((argv[index] === "--port" || argv[index] === "-p") && argv[index + 1]) {
      return Number(argv[index + 1]);
    }
  }
  return undefined;
}
