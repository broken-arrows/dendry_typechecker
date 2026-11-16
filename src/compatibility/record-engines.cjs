// node src/compatibility/record-engines.cjs <upstream-root> <ten-root> <dependency-node_modules> [--write]
// Records actual compilers, never extension output. Case-insensitive TEN roles
// are an agreed contract addition tested separately until the engine implements it.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const [upstreamArg, tenArg, dependenciesArg, mode, extra] = process.argv.slice(2);
if (!upstreamArg || !tenArg || !dependenciesArg || extra || (mode && mode !== '--write')) {
  throw new Error('Usage: node src/compatibility/record-engines.cjs <upstream-root> <ten-root> <dependency-node_modules> [--write]');
}
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8').replace(/\r\n/g, '\n');
const roots = { dendrynexus: path.resolve(upstreamArg), 'dendrynexus-ten': path.resolve(tenArg) };
const dependencies = path.resolve(dependenciesArg);
const outputPath = path.join(__dirname, 'engine-results.json');
const previous = fs.existsSync(outputPath) ? JSON.parse(read('engine-results.json')) : undefined;
const sourceSha256 = {};
for (const [engine, root] of Object.entries(roots)) {
  const names = ['package.json', 'lib/engine.js', ...fs.readdirSync(path.join(root, 'lib/parsers'))
    .filter(name => name.endsWith('.js')).sort().map(name => `lib/parsers/${name}`)];
  sourceSha256[engine] = Object.fromEntries(names.map(name => [name,
    hash(fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n'))]));
}
if (previous && JSON.stringify(previous.reference.sourceSha256) !== JSON.stringify(sourceSha256)) {
  throw new Error('Engine sources differ from the recording. Review and explicitly repin before regenerating.');
}
const dependencyVersions = Object.fromEntries(['lodash', 'async'].map(name => [name,
  JSON.parse(fs.readFileSync(path.join(dependencies, name, 'package.json'), 'utf8')).version]));
if (dependencyVersions.lodash !== '3.10.1' || dependencyVersions.async !== '1.5.2') throw new Error('Expected lodash 3.10.1 and async 1.5.2.');
const sharedText = read('corpus.json'), featureText = read('engine-corpus.json');
const shared = JSON.parse(sharedText), features = JSON.parse(featureText);
function run(engine, files, parserFile) {
  const child = spawnSync(process.execPath, [path.join(__dirname, 'upstream-worker.cjs')], {
    input: JSON.stringify({ upstream: roots[engine], files, parserFile }),
    encoding: 'utf8', timeout: 10000, windowsHide: true, env: { ...process.env, NODE_PATH: dependencies },
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`Compiler worker failed: ${child.stderr}`);
  return JSON.parse(child.stdout);
}
function filesFor(defaults, testCase) {
  return [...new Map([...defaults, ...testCase.files].map(file => [file.name, file])).values()];
}
const sharedResults = {}, featureResults = {};
for (const testCase of features.cases) {
  if (Object.hasOwn(featureResults, testCase.id)) throw new Error(`Duplicate feature case: ${testCase.id}`);
  const results = {};
  for (const engine of Object.keys(roots)) {
    const result = run(engine, filesFor(features.defaults, testCase));
    if (result.ok === Boolean(testCase.errors[engine])) throw new Error(`${testCase.id} (${engine}): unexpected result: ${JSON.stringify(result)}`);
    results[engine] = result;
  }
  featureResults[testCase.id] = results;
}
console.log(`Recorded ${features.cases.length} feature cases for both engines.`);
for (const testCase of shared.cases) {
  if (Object.hasOwn(sharedResults, testCase.id)) throw new Error(`Duplicate shared case: ${testCase.id}`);
  const result = run('dendrynexus-ten', filesFor(shared.defaults, testCase), testCase.parser?.file);
  if (result.ok === Boolean(testCase.diagnostic)) throw new Error(`${testCase.id}: unexpected TEN result: ${JSON.stringify(result)}`);
  sharedResults[testCase.id] = result;
  if (Object.keys(sharedResults).length % 250 === 0) console.log(`Recorded ${Object.keys(sharedResults).length} shared TEN cases...`);
}
const output = JSON.stringify({ reference: {
  description: 'Actual compiler snapshots; mixed-case TEN roles are separately tested as the agreed extension contract.',
  upstreamRevision: '2df80695cbe29743b4d9a1a43f5d9b36eaaac0b7',
  tenRepository: 'https://github.com/broken-arrows/route_to_itaca',
  tenRepositoryRevision: 'ee7a5fe0f5838ecbd1401510f65c5f49380bb1f9',
  tenVendorPath: 'vendor/dendrynexus-ten',
  sourceHashNormalization: 'UTF-8 source text with CRLF normalized to LF',
  sourceSha256, dependencyVersions, sharedCorpusSha256: hash(sharedText), featureCorpusSha256: hash(featureText),
}, shared: sharedResults, features: featureResults }, null, 2) + '\n';
if (mode === '--write') fs.writeFileSync(outputPath, output);
else if (!previous || read('engine-results.json') !== output) throw new Error('Recording differs. Inspect and rerun with --write if intended.');
console.log(`${mode === '--write' ? 'Recorded' : 'Verified'} ${shared.cases.length} shared TEN cases and ${features.cases.length} feature cases for both engines.`);
