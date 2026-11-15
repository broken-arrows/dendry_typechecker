// Usage (paths are explicit; normal tests never need the upstream checkout):
// node src/compatibility/record-upstream.cjs <upstream-root> <dependency-node_modules> [--write]
// Without --write, re-executes the reference and checks the committed recording.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const revision = '2df80695cbe29743b4d9a1a43f5d9b36eaaac0b7';
const [upstreamArgument, dependenciesArgument, mode] = process.argv.slice(2);
if (!upstreamArgument || !dependenciesArgument || (mode && mode !== '--write')) {
  throw new Error('Usage: node src/compatibility/record-upstream.cjs <upstream-root> <dependency-node_modules> [--write]');
}
const upstream = path.resolve(upstreamArgument);
const dependencies = path.resolve(dependenciesArgument);
const hash = input => crypto.createHash('sha256').update(input).digest('hex');
const outputPath = path.join(__dirname, 'upstream-results.json');
const previous = fs.existsSync(outputPath) ? JSON.parse(fs.readFileSync(outputPath, 'utf8')) : undefined;
const sourcePaths = ['package.json', 'lib/engine.js', ...fs.readdirSync(path.join(upstream, 'lib/parsers'))
  .filter(name => name.endsWith('.js')).sort().map(name => `lib/parsers/${name}`)];
const sourceSha256 = Object.fromEntries(sourcePaths.map(name => [name, hash(fs.readFileSync(path.join(upstream, name)))]));
if (previous && JSON.stringify(previous.reference.sourceSha256) !== JSON.stringify(sourceSha256)) {
  throw new Error('Reference sources differ from the pinned recording. Review and explicitly repin before regenerating.');
}
const dependencyVersions = Object.fromEntries(['lodash', 'async'].map(name => [name,
  JSON.parse(fs.readFileSync(path.join(dependencies, name, 'package.json'), 'utf8')).version]));
if (dependencyVersions.lodash !== '3.10.1' || dependencyVersions.async !== '1.5.2') {
  throw new Error('Reference requires lodash 3.10.1 and async 1.5.2, as used by the audit.');
}
const corpusText = fs.readFileSync(path.join(__dirname, 'corpus.json'), 'utf8').replace(/\r\n/g, '\n');
const corpus = JSON.parse(corpusText);
const results = {};
for (const testCase of corpus.cases) {
  if (Object.hasOwn(results, testCase.id)) throw new Error(`Duplicate case ID: ${testCase.id}`);
  const files = new Map(corpus.defaults.map(file => [file.name, file]));
  for (const file of testCase.files) files.set(file.name, file);
  const child = spawnSync(process.execPath, [path.join(__dirname, 'upstream-worker.cjs')], {
    input: JSON.stringify({ upstream, files: [...files.values()], parserFile: testCase.parser?.file }),
    encoding: 'utf8', timeout: 10000, windowsHide: true,
    env: { ...process.env, NODE_PATH: dependencies },
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`${testCase.id}: upstream worker failed: ${child.stderr}`);
  const result = JSON.parse(child.stdout);
  if (result.ok === Boolean(testCase.diagnostic)) {
    throw new Error(`${testCase.id}: expected ${testCase.diagnostic ? 'rejection' : 'acceptance'}, got ${child.stdout}`);
  }
  if (testCase.parser && !result.parsed) throw new Error(`${testCase.id}: missing upstream raw parse result`);
  results[testCase.id] = result;
}
const output = JSON.stringify({
  reference: {
    repository: 'https://github.com/aucchen/dendrynexus', revision,
    corpusSha256: hash(corpusText), dependencyVersions, sourceSha256,
  },
  cases: results,
}, null, 2) + '\n';
if (mode === '--write') {
  fs.writeFileSync(outputPath, output);
  console.log(`Recorded ${Object.keys(results).length} upstream compiler cases.`);
} else {
  if (!previous || fs.readFileSync(outputPath, 'utf8').replace(/\r\n/g, '\n') !== output) {
    throw new Error('Recording differs. Inspect the changes, then rerun with --write if intended.');
  }
  console.log(`Verified ${Object.keys(results).length} recorded upstream compiler cases.`);
}
