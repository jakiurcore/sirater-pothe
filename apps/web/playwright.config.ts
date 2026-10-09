import { defineConfig } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 3100)
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  globalTimeout: 45 * 60_000, // nothing may hang forever
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: false } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 860 } } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : { command: `pnpm exec next dev -p ${PORT}`, port: PORT, reuseExistingServer: true, timeout: 120_000 },
})
