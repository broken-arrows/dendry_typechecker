import { describe, expect, it } from 'vitest';
import { DendryProjectValidator } from '../project-validator';
import { corpus, oracle, projectFiles } from './corpus';
import { engineOracle } from './engine-corpus';
import { DiagnosticSeverity, editor, loadProject } from './vscode-host';

describe.each(['dendrynexus', 'dendrynexus-ten'] as const)('%s project diagnostics match recorded compilation', engine => {
  for (const testCase of corpus.cases) {
    it(`${testCase.id}: ${testCase.description}`, async () => {
      const upstream = engine === 'dendrynexus' ? oracle.cases[testCase.id] : engineOracle.shared[testCase.id];
      // An invalid-case assertion must not silently become an acceptance test
      // after an accidental oracle change (or vice versa).
      expect(upstream.ok, upstream.error).toBe(!testCase.diagnostic);
      editor.configure({ 'validation.dendrynexusTen': engine === 'dendrynexus-ten' });
      const uris = loadProject(projectFiles(testCase));
      const results = await new DendryProjectValidator().validateProject(uris);
      const diagnostics = [...results].flatMap(([uri, items]) => items.map(item => ({
        file: uri.path.replace('/compatibility/', ''),
        message: item.message,
        severity: item.severity,
        line: item.range.start.line,
      })));

      // A stand-in/IO exception must never count as the expected compiler error.
      expect(diagnostics.filter(item => /Error (?:opening|reading|parsing|validating) file/.test(item.message)))
        .toEqual([]);
      const errors = diagnostics.filter(item => item.severity === DiagnosticSeverity.Error);
      if (upstream.ok) {
        expect(errors, JSON.stringify(diagnostics, null, 2)).toEqual([]);
      } else {
        const expected = testCase.diagnostic!;
        const matching = errors.filter(item => item.file === expected.file && new RegExp(expected.pattern, 'i').test(item.message));
        expect(matching,
          `Upstream: ${upstream.error}\nExtension: ${JSON.stringify(diagnostics, null, 2)}`)
          .not.toEqual([]);
        if (expected.line !== undefined) expect(matching.map(item => item.line)).toContain(expected.line);
        if (expected.count !== undefined) expect(matching).toHaveLength(expected.count);
      }
      if (testCase.warning) {
        const warning = testCase.warning;
        const matches = diagnostics.filter(item => item.file === warning.file &&
          item.severity === DiagnosticSeverity.Warning && new RegExp(warning.pattern, 'i').test(item.message));
        expect(matches, JSON.stringify(diagnostics, null, 2)).not.toEqual([]);
        if (warning.line !== undefined) expect(matches.map(item => item.line)).toContain(warning.line);
      }
    });
  }
});
