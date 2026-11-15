import { describe, expect, it } from 'vitest';
import { parseText } from '../parser';
import { DendryProjectValidator } from '../project-validator';
import { DiagnosticSeverity, loadProject } from './vscode-host';

const sectionPrefix = 'title: Root\n\nRoot prose.\n\n@part\n';
async function validate(contents: string) {
  const uris = loadProject([{ name: 'root.scene.dry', contents }]);
  return [...(await new DendryProjectValidator().validateProject(uris)).values()].flat();
}

describe('shared scene schema source and diagnostic regressions', () => {
  it('reports the same root and section errors exactly once at their actual values', async () => {
    const header = 'title: Scene\nnew-page: maybe\nmax-cards: Infinity\nfrequency: text\nunknown-field: value';
    const root = await validate(header);
    const section = await validate(sectionPrefix + header);
    expect(root).toHaveLength(4);
    expect(section).toHaveLength(4);
    expect(root.map(item => item.severity)).toEqual(Array(4).fill(DiagnosticSeverity.Error));
    expect(section.map(item => ({
      message: item.message, severity: item.severity,
      line: item.range.start.line - 5, start: item.range.start.character, end: item.range.end.character,
    }))).toEqual(root.map(item => ({
      message: item.message, severity: item.severity,
      line: item.range.start.line, start: item.range.start.character, end: item.range.end.character,
    })));
    expect(root.map(item => item.range.start.line)).toEqual([1, 2, 3, 4]);
    expect(root.map(item => item.range.start.character)).toEqual([10, 11, 11, 15]);
  });

  it.each(['', sectionPrefix])('keeps fake properties in magic and prose out of duplicate checks: %j', async prefix => {
    const diagnostics = await validate(prefix + [
      'title: Scene', 'on-arrival: {!', 'newPage: 1;', 'newPage: 2;', '!}', '',
      'title: prose', 'title: more prose',
    ].join('\n'));
    expect(diagnostics).toEqual([]);
  });

  it.each(['', sectionPrefix])('anchors multiline JavaScript errors to their body line: %j', async prefix => {
    const diagnostics = await validate(prefix + 'title: Scene\nfrequency-var: {!\nconst = ;\n!}');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Error);
    expect(diagnostics[0].range.start.line).toBe(prefix ? 7 : 2);
    expect(diagnostics[0].range.start.character).toBe(6);
  });

  it.each(['', sectionPrefix])('keeps normalized header source ranges and interpolation positions: %j', async prefix => {
    const contents = prefix + '# comment\nNew Page: yes\nUnavailable Subtitle: [+ score : absent +]';
    const parsed = parseText(contents, 'root.scene.dry');
    expect(parsed.errors).toEqual([]);
    const node = parsed.ast.nodes.find(item => item.type === 'scene' && item.declarationType === (prefix ? 'explicit' : 'implicit'))!;
    expect(node.properties.get('new-page')).toBe('yes');
    expect(node.propertyRanges!.get('unavailable-subtitle')!.start.line).toBe(prefix ? 7 : 2);
    const diagnostics = await validate(contents);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('absent.qdisplay.dry');
    expect(diagnostics[0].range.start).toEqual({ line: prefix ? 7 : 2, character: 33 });
    expect(diagnostics[0].range.end).toEqual({ line: prefix ? 7 : 2, character: 39 });
  });

  it('retains a normalized duplicate-header error after an unrelated edit', async () => {
    const uris = loadProject([
      { name: 'root.scene.dry', contents: 'New Page: yes\nnew_page: no' },
      { name: 'other.scene.dry', contents: 'title: Other\n\nText' },
    ]);
    const validator = new DendryProjectValidator();
    for (const changed of [undefined, uris[1]]) {
      const diagnostics = (await validator.validateProject(uris, changed)).get(uris[0])!;
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toMatch(/Duplicate property 'new-page'/);
      expect(diagnostics[0].range.start.line).toBe(1);
    }
  });

  it.each(['', sectionPrefix])('indexes semicolon and hash-prefixed tags on roots and sections: %j', async prefix => {
    expect(await validate(prefix + 'title: Scene\ntags: #one; two\n\nText\n\n- #one\n- #two')).toEqual([]);
  });
});
