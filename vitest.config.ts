import { resolve } from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname)
    }
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup/vitest.setup.ts'],
    globals: true,
    testTimeout: 15000
  }
});
