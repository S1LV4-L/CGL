import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/browser',
    timeout: 60000,
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:5173',
        channel: process.platform === 'win32' ? 'msedge' : undefined,
        viewport: { width: 1280, height: 1000 },
    },
    webServer: {
        command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
        url: 'http://127.0.0.1:5173',
        reuseExistingServer: !process.env.CI,
    },
});
