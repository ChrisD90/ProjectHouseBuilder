const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: '../tests/visual',
  testMatch: '*.spec.cjs',
  workers: 1,
  fullyParallel: false,
  snapshotPathTemplate: '{testDir}/snapshots/{arg}{ext}',
  use: {
    baseURL: process.env.PHB_TEST_URL,
    locale: 'de-DE',
    colorScheme: 'light',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  expect: {
    toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.015, threshold: 0.2 },
  },
  outputDir: '../test-results/visual',
});
