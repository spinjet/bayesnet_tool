import { defineConfig } from "@playwright/test";
const browserName = (process.env.BROWSER || "chromium") as
  "chromium" | "firefox" | "webkit";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  use: {
    browserName,
    baseURL: process.env.TEST_URL || "http://127.0.0.1:4173",
    launchOptions:
      browserName === "chromium"
        ? {
            executablePath:
              process.env.CHROMIUM_PATH ||
              (!process.env.BROWSER ? "/usr/bin/chromium" : undefined),
            args: ["--no-sandbox"],
          }
        : {},
  },
});
