// Dual-target bundler for the Dendry Type Checker.
//
// Produces two bundles from a single source tree:
//   - desktop: Node.js host  -> dist/desktop/extension.js  (entry src/extension.ts)
//   - web:     browser worker -> dist/web/extension.js      (entry src/extension.web.ts)
//
// The web entry deliberately avoids importing debug-adapter.ts, so child_process
// never reaches the browser bundle. `vscode` is always external (provided by the host).
//
// Flags: --watch (rebuild on change), --production (minify, no sourcemaps).

const esbuild = require('esbuild');
const fs = require('fs');

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  external: ['vscode'],
  format: 'cjs',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions[]} */
const targets = [
  {
    ...shared,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/desktop/extension.js',
    platform: 'node',
  },
  {
    ...shared,
    entryPoints: ['src/extension.web.ts'],
    outfile: 'dist/web/extension.js',
    platform: 'browser',
  },
];

async function main() {
  // Start from a clean dist/ so stale bundles or sourcemaps from a previous
  // (e.g. dev) build never linger into a release package.
  fs.rmSync('dist', { recursive: true, force: true });

  if (watch) {
    const contexts = await Promise.all(targets.map((t) => esbuild.context(t)));
    await Promise.all(contexts.map((c) => c.watch()));
    console.log('esbuild: watching for changes...');
  } else {
    await Promise.all(targets.map((t) => esbuild.build(t)));
    console.log('esbuild: build complete.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
