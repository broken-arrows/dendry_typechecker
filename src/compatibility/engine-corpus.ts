import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineId } from '../engine-profile';
import type { SourceFile } from './corpus';

interface CompilerResult { ok: boolean; error?: string }
interface ExpectedError { file: string; pattern: string }
interface EngineCase {
  id: string;
  files: SourceFile[];
  errors: Record<EngineId, ExpectedError | null>;
}
const read = (name: string) => readFileSync(join(__dirname, name), 'utf8').replace(/\r\n/g, '\n');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const featureText = read('engine-corpus.json');
export const engineCorpus: { defaults: SourceFile[]; cases: EngineCase[] } = JSON.parse(featureText);
export const engineOracle: {
  reference: { featureCorpusSha256: string; sharedCorpusSha256: string };
  shared: Record<string, CompilerResult>;
  features: Record<string, Record<EngineId, CompilerResult>>;
} = JSON.parse(read('engine-results.json'));
if (hash(featureText) !== engineOracle.reference.featureCorpusSha256 ||
    hash(read('corpus.json')) !== engineOracle.reference.sharedCorpusSha256) {
  throw new Error('Engine compatibility fixtures changed: regenerate the independent compiler recording.');
}
const ids = (values: string[]) => JSON.stringify(values.sort());
if (ids(engineCorpus.cases.map(item => item.id)) !== ids(Object.keys(engineOracle.features)) ||
    ids(JSON.parse(read('corpus.json')).cases.map((item: { id: string }) => item.id)) !== ids(Object.keys(engineOracle.shared))) {
  throw new Error('Engine compatibility fixture/recording IDs differ.');
}

export function engineFiles(testCase: EngineCase): SourceFile[] {
  return [...new Map([...engineCorpus.defaults, ...testCase.files].map(file => [file.name, file])).values()];
}
