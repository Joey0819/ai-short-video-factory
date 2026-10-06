import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["pw-check.spec.ts", "quick-click.spec.ts"],
  timeout: 90_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL: "http://127.0.0.1:3024",
    channel: "chrome",
    viewport: { width: 1440, height: 980 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: [
    {
      command: "npm run api",
      url: "http://127.0.0.1:3030/api/health",
      reuseExistingServer: true,
      timeout: 15_000
    },
    {
      command: "npm run dev",
      url: "http://127.0.0.1:3024/",
      reuseExistingServer: true,
      timeout: 15_000
    }
  ]
});
