import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-tests",
  testMatch: "**/*.pw.ts",
  outputDir: "./test-results/browser",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:24741",
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "phone-narrow", use: { viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true } },
    { name: "phone", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "phone-landscape", use: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: "uv run --project ../backend --locked python ../scripts/browser_test_server.py",
    url: "http://127.0.0.1:24741",
    reuseExistingServer: false,
    timeout: 30_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
