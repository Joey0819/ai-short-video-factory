#!/usr/bin/env node
import { createChatGptAccountDryRunReport, createOpenAiDryRunReport } from "../lib/openai-director.mjs";
import { readChatGptAccountPresence, readOpenAiKeyPresence } from "../lib/provider-plan.mjs";

const args = parseArgs(process.argv.slice(2));
const keyPresence = await readOpenAiKeyPresence();
const accountPresence = await readChatGptAccountPresence();
const report = createOpenAiDryRunReport({
  ...args,
  openAiConfigured: keyPresence.configured
});

console.log(JSON.stringify({
  openai_api_key: report,
  chatgpt_account: createChatGptAccountDryRunReport({
    ...args,
    accountVerified: accountPresence.configured
  })
}, null, 2));

function parseArgs(argv) {
  const args = {
    topic: "AI cartoon fruit drama",
    count: 5,
    sourceType: "text idea"
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
    }
  }
  return args;
}
