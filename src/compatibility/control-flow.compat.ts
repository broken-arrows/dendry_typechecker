import { describe, expect, it } from 'vitest';
import { DendryProjectValidator } from '../project-validator';
import { DiagnosticSeverity, loadProject } from './vscode-host';

const section = 'title: Root\n\nRoot prose.\n\n@part\n';
async function validate(contents: string) {
  const uris = loadProject([{ name: 'root.scene.dry', contents }]);
  return [...(await new DendryProjectValidator().validateProject(uris)).values()].flat();
}

describe('control-flow diagnostic source and lookup regressions', () => {
  it.each(['', section])('locates each unresolved destination on its own continuation line: %j', async prefix => {
    const diagnostics = await validate(prefix + 'title: Scene\nGo To: missing-one;\n  missing-two\n\nText');
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map(item => item.range.start)).toEqual([
      { line: prefix ? 6 : 1, character: 7 }, { line: prefix ? 7 : 2, character: 2 },
    ]);
    expect(diagnostics.map(item => item.range.end.character)).toEqual([18, 13]);
    expect(diagnostics.map(item => item.severity)).toEqual([DiagnosticSeverity.Error, DiagnosticSeverity.Error]);
  });

  it.each(['', section])('maps syntax errors through welded magic semicolons: %j', async prefix => {
    const diagnostics = await validate(prefix + 'title: Scene\ngo-to: root if {! const x = 1;\nconst = ;\n!}');
    const errors = diagnostics.filter(item => item.severity === DiagnosticSeverity.Error);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/JavaScript/);
    expect(errors[0].range.start).toEqual({ line: prefix ? 7 : 2, character: 6 });
  });

  it.each(['', section])('checks go-to magic as returning bodies with actual state/Q bindings: %j', async prefix => {
    expect(await validate(prefix + 'title: Scene\ngo-to: root if {! const x = 1; return state.qualities.flag && Q.flag && x; !}'))
      .toEqual([]);
  });

  it('does not use a local scene to satisfy an exact call lookup', async () => {
    const diagnostics = await validate('title: Root\ncall: nested\n\nText\n\n@nested\ntitle: Nested\n\nText');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Warning);
    expect(diagnostics[0].message).toMatch(/Call target 'nested' is not defined/);
  });

  it('resolves a jump contextually where the same call would fail', async () => {
    expect(await validate('title: Root\nset-jump: nested\n\nText\n\n@nested\ntitle: Nested\n\nText')).toEqual([]);
  });

  it('accepts undeclared and hyphenated stat-check qualities without treating them as code', async () => {
    expect(await validate('title: Root\ncheck-quality: dynamic-strength\nbroad-difficulty: very hard')).toEqual([]);
  });

  it('moves an unresolved check target from warning to error when both results become linked', async () => {
    const validator = new DendryProjectValidator();
    for (const pair of [false, true]) {
      const uris = loadProject([{ name: 'root.scene.dry', contents:
        `title: Root\ncheck-success-go-to: missing${pair ? '\ncheck-failure-go-to: root' : ''}` }]);
      const results = await validator.validateProject(uris, pair ? uris[0] : undefined);
      const diagnostics = [...results.values()].flat();
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toMatch(/undefined scene 'missing'/);
      expect(diagnostics[0].severity).toBe(pair ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning);
    }
  });
});
