import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SourceFile { name: string; contents: string }
export interface CompatibilityCase {
  id: string;
  description: string;
  source: string;
  files: SourceFile[];
  diagnostic?: { file: string; pattern: string; line?: number; count?: number };
  parser?: { file: string; check: 'root-content' | 'choice-properties' | 'section-ids' };
}
interface RawScene {
  id: string;
  title?: string;
  content?: string;
  options?: { id: string; title?: string; chooseIf?: string; order?: string }[];
  sections?: { id: string }[];
}
interface OracleResult {
  ok: boolean;
  error?: string;
  sceneIds?: string[];
  qualityIds?: string[];
  parsed?: RawScene;
}

// A Windows checkout may convert fixture file line endings. The JSON strings
// still contain the same source text; hash the serialized file canonically.
const corpusText = readFileSync(join(__dirname, 'corpus.json'), 'utf8').replace(/\r\n/g, '\n');
export const corpus: { defaults: SourceFile[]; cases: CompatibilityCase[] } = JSON.parse(corpusText);
export const oracle: {
  reference: { revision: string; corpusSha256: string };
  cases: Record<string, OracleResult>;
} = JSON.parse(readFileSync(join(__dirname, 'upstream-results.json'), 'utf8'));

if (createHash('sha256').update(corpusText).digest('hex') !== oracle.reference.corpusSha256) {
  throw new Error('Compatibility corpus changed: regenerate the pinned upstream results before testing.');
}
if (JSON.stringify(corpus.cases.map(item => item.id).sort()) !== JSON.stringify(Object.keys(oracle.cases).sort())) {
  throw new Error('Compatibility corpus and upstream result case IDs differ.');
}

export function projectFiles(testCase: CompatibilityCase): SourceFile[] {
  const files = new Map(corpus.defaults.map(file => [file.name, file]));
  for (const file of testCase.files) files.set(file.name, file);
  return [...files.values()];
}
