#!/usr/bin/env node
import { resolveProviderReadiness } from "../lib/provider-plan.mjs";

const readiness = await resolveProviderReadiness();

console.log(`Recommended mode: ${readiness.recommended_mode}`);
console.log(`OPENAI_API_KEY configured: ${readiness.api_key.configured ? "yes" : "no"}`);
console.log(`Local target: ${readiness.api_key.local_target}`);
for (const step of readiness.steps) {
  console.log(`${step.label}: ${step.provider} (${step.status})`);
}
