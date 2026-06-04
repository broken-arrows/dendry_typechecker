import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only our own unit tests under src/. Keeps vitest away from the bundled
    // upstream engine under docs/dendrynexus/** (which has its own mocha suite).
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
