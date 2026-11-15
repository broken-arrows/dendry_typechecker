import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL('./src/compatibility/vscode-host.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/compatibility/**/*.compat.ts'],
    environment: 'node',
  },
});
