/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// changeOrigin: false keeps the browser's Host header, which the API's cross-site (CSRF) check compares with Origin.
const api = { '/api': { target: `http://127.0.0.1:${process.env.PENNY_API_PORT ?? 8787}`, changeOrigin: false } };

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': r('./src'), '@art': r('./assets/art') } },
  server: { proxy: api },
  preview: { proxy: api },
  build: { assetsInlineLimit: 0, target: 'es2022', sourcemap: true },
  test: {
    environment: 'jsdom',
    testTimeout: 120_000,
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
  },
});
