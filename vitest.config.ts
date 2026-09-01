import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
