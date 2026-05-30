import { defineConfig } from 'vitest/config';

const base = process.env.VITE_BASE_PATH ?? '/event-horizon/';

export default defineConfig({
  base,
  build: {
    sourcemap: true,
    target: 'es2022'
  },
  server: {
    host: '127.0.0.1'
  },
  preview: {
    host: '127.0.0.1'
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
});
