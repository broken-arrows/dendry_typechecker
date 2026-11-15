// One compiler run per process: this upstream revision can throw asynchronously
// or call back more than once after an invalid file. Infrastructure errors must
// exit nonzero; only errors raised during parsing/compilation become results.
const fs = require('node:fs');
const path = require('node:path');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
// Node resolves ancestor node_modules before NODE_PATH. Refuse an accidentally
// shadowing installation instead of recording results with different libraries.
for (const [name, expected] of Object.entries({ lodash: '3.10.1', async: '1.5.2' })) {
  const manifest = require.resolve(`${name}/package.json`, { paths: [path.join(input.upstream, 'lib/parsers')] });
  if (JSON.parse(fs.readFileSync(manifest, 'utf8')).version !== expected) {
    throw new Error(`Upstream resolves an unexpected ${name} version: ${manifest}`);
  }
}
const compiler = require(path.join(input.upstream, 'lib/parsers/compiler.js'));
const dry = require(path.join(input.upstream, 'lib/parsers/dry.js'));
console.log = () => {};
let parsed;
function finish(result) {
  process.stdout.write(JSON.stringify({ ...result, ...(parsed ? { parsed } : {}) }));
  process.exit(0);
}
process.on('uncaughtException', error => finish({ ok: false, error: error.message }));

if (input.parserFile) {
  const file = input.files.find(file => file.name === input.parserFile);
  dry.parseFromContent(file.name, file.contents, (error, result) => {
    if (error) throw error;
    // Keep the upstream public raw AST, stripping only source metadata.
    parsed = JSON.parse(JSON.stringify(result, (key, value) => key === '$metadata' ? undefined : value));
  });
}
compiler.compileGame(input.files, (error, game) => {
  if (error) return finish({ ok: false, error: error.message });
  finish({
    ok: true,
    sceneIds: Object.keys(game.scenes).sort(),
    qualityIds: Object.keys(game.qualities).sort(),
  });
});
