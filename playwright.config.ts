import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run the real app against stand-ins for GitHub and a model
 * provider (see e2e/mocks), on their own ports so they don't clash with a
 * dev server you already have running.
 */
const APP = 3100;
const CODELOAD = 4110;
const LLM = 4111;
const LLM_NO_CORS = 4112;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${APP}`,
    ...devices["Pixel 7"],
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : undefined,
  },
  webServer: [
    { command: `PORT=${CODELOAD} node e2e/mocks/codeload.mjs`, port: CODELOAD, reuseExistingServer: false },
    { command: `PORT=${LLM} node e2e/mocks/llm.mjs`, port: LLM, reuseExistingServer: false },
    { command: `PORT=${LLM_NO_CORS} CORS=0 node e2e/mocks/llm.mjs`, port: LLM_NO_CORS, reuseExistingServer: false },
    {
      // A production build, so the tests see what users get.
      command: `npx next build && npx next start --port ${APP}`,
      port: APP,
      timeout: 240_000,
      reuseExistingServer: false,
      env: {
        TALKTHROUGH_CODELOAD_BASE: `http://localhost:${CODELOAD}`,
        // The mock providers are plain http on localhost.
        TALKTHROUGH_RELAY_ALLOW_HTTP: "1",
      },
    },
  ],
});
