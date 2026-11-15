import { describe, expect, it } from 'vitest';
import { DendryProjectValidator } from '../project-validator';
import { corpus, oracle, projectFiles } from './corpus';
import { DiagnosticSeverity, loadProject } from './vscode-host';

describe('project diagnostics match pinned upstream compilation', () => {
  for (const testCase of corpus.cases) {
    it(`${testCase.id}: ${testCase.description}`, async () => {
      const upstream = oracle.cases[testCase.id];
      // An invalid-case assertion must not silently become an acceptance test
      // after an accidental oracle change (or vice versa).
      expect(upstream.ok, upstream.error).toBe(!testCase.diagnostic);
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
    });
  }
});
