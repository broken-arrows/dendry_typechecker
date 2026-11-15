import { describe, expect, it } from 'vitest';
import { DendryProjectValidator } from '../project-validator';
import { DiagnosticSeverity, loadProject } from './vscode-host';

async function validate(contents: string, others: { name: string; contents: string }[] = []) {
  const uris = loadProject([{ name: 'root.scene.dry', contents }, ...others]);
  return [...(await new DendryProjectValidator().validateProject(uris)).values()].flat();
}

describe('shorthand grammar and visit dependency regressions', () => {
  it.each([
    'on-arrival: player-health += 1',
    'view-if: ready AND NOT asleep',
    'on-arrival: if score > 0 then coins += 1 else coins = 0',
    'on-arrival: label = "if and or not; Q.foo = 1"',
  ])('accepts upstream shorthand: %s', async contents => {
    expect(await validate(contents)).toEqual([]);
  });

  it.each([
    'on-arrival: var score = 1', 'view-if: score === 1',
    'frequency-var: score > 1', 'view-if: score > 0; other > 0',
  ])('rejects code outside the field grammar: %s', async contents => {
    const diagnostics = await validate(contents);
    expect(diagnostics.some(item => item.severity === DiagnosticSeverity.Error)).toBe(true);
  });

  it('accepts tracked scene visits in shorthand', async () => {
    expect(await validate('max-visits: 3\nview-if: @root > 0')).toEqual([]);
  });

  it.each(['\n', '\r\n'])('maps a bad token through folded continuations and mixed action chunks: %j', async newline => {
    const lines = ['On Arrival: foo=1; {! Q.bar=0; !}', '    label="Q.foo";', '    Q.foo=2'];
    const diagnostics = await validate(lines.join(newline));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('without the "Q." prefix');
    expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Error);
    expect(diagnostics[0].range.start).toEqual({ line: 2, character: 4 });
    expect(diagnostics[0].range.end).toEqual({ line: 2, character: 9 });
  });

  it.each(['\n', '\r\n'])('maps a visit reference in an indented predicate continuation: %j', async newline => {
    const diagnostics = await validate(['View If: score > 0 AND', '    @missing > 0'].join(newline));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].range.start).toEqual({ line: 1, character: 4 });
    expect(diagnostics[0].range.end).toEqual({ line: 1, character: 12 });
  });

  it('resolves local visit targets before globally tracked scenes', async () => {
    const diagnostics = await validate('view-if: @target > 0\n\nText\n\n@target\ntitle: Local', [
      { name: 'target.scene.dry', contents: 'title: Global\ncount-visits-max: 3' },
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Scene 'root.target' needs count-visits-max");
    expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Error);
  });

  it('accepts tracked local, dotted and built-in-shaped section names', async () => {
    expect(await validate('view-if: @part.deep > 0 AND @prevScene > 0\n\nText\n\n@part.deep\ncount-visits-max: 3\n\nText\n\n@prevScene\nmax-visits: 3'))
      .toEqual([]);
  });

  it.each(['frequency-var: @missing + 1', 'max-visits-var: @missing + 1', 'go-to-ref: destination if @missing > 0', 'go-sub: root if @missing > 0'])
    ('uses authoring warnings for unlinked visit fields: %s', async contents => {
      const diagnostics = await validate(contents);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Warning);
      expect(diagnostics[0].message).toContain("undefined scene 'missing'");
    });

  it('keeps dynamic qualities and function names legal', async () => {
    expect(await validate('on-arrival: dynamic-quality=1; next=customFunction(dynamic-quality)\nview-if: dynamic-quality > 0\nfrequency-var: unknownFunction(2)'))
      .toEqual([]);
  });

  it('ignores visit-looking text inside JavaScript action chunks', async () => {
    expect(await validate('on-arrival: label="plain"; {! Q.label="@missing"; return; !} count=1')).toEqual([]);
  });

  it('matches upstream linking of visit-looking text inside shorthand strings', async () => {
    const diagnostics = await validate('on-arrival: label="@missing"');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Error);
    expect(diagnostics[0].range.start).toEqual({ line: 0, character: 19 });
    expect(diagnostics[0].range.end).toEqual({ line: 0, character: 27 });
  });

  it('keeps an unfinished shorthand error within the source document', async () => {
    const contents = 'view-if: score >';
    const diagnostics = await validate(contents);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].range.start).toEqual({ line: 0, character: contents.length });
    expect(diagnostics[0].range.end).toEqual(diagnostics[0].range.start);
  });

  it('refreshes visit tracking errors after changes in another file', async () => {
    const validator = new DendryProjectValidator();
    for (const [index, fields] of ['', '\nmax-visits: 3', '\nmax-visits-var: 2', ''].entries()) {
      const uris = loadProject([
        { name: 'root.scene.dry', contents: 'view-if: @target > 0' },
        { name: 'target.scene.dry', contents: 'title: Target' + fields },
      ]);
      const diagnostics = [...(await validator.validateProject(uris, index ? uris[1] : undefined)).values()].flat();
      expect(diagnostics).toHaveLength(fields ? 0 : 1);
      if (!fields) expect(diagnostics[0].message).toContain('count-visits-max');
    }
  });
});
