import { describe, expect, it } from 'vitest';
import { parseText } from '../parser';
import { DendryProjectValidator } from '../project-validator';
import { DiagnosticSeverity, loadProject } from './vscode-host';

describe('root scene preservation regressions', () => {
  it('keeps root and section prose separate for a dotted filename with a full path', () => {
    const { ast, errors } = parseText(
      'title: Chapter\n\nRoot prose.\n\n@side\ntitle: Side\n\nSection prose.',
      'C:\\game\\scenes\\chapter.deep.scene.dry',
    );
    expect(errors).toEqual([]);
    const scenes = ast.nodes.filter(node => node.type === 'scene');
    expect(scenes).toHaveLength(2);
    expect(scenes[0].properties.get('id')).toBe('chapter.deep');
    expect(scenes[0].content.trim()).toBe('Root prose.');
    expect(scenes[1].content.trim()).toBe('Section prose.');
  });

  it.each(['', 'title: Root'])('keeps an empty or property-only root within source bounds: %j', text => {
    const { ast, errors } = parseText(text, '/game/root.scene.dry');
    expect(errors).toEqual([]);
    const root = ast.nodes.find(node => node.properties.get('id') === 'root')!;
    expect(root).toBeDefined();
    expect(root.content.trim()).toBe('');
    expect(root.range.start.line).toBe(0);
    expect(root.range.end.line).toBe(0);
    expect(root.range.end.character).toBe(text.length);
    expect(root.contentRange!.start).toEqual(root.contentRange!.end);
  });

  it('does not scan an action string literal as root body content in a property-only scene', async () => {
    const uris = loadProject([{
      name: 'root.scene.dry',
      contents: 'on-arrival: {!\nconst label = "[? if score = : literal ?]";\n!}',
    }]);
    const diagnostics = [...(await new DendryProjectValidator().validateProject(uris)).values()].flat();
    expect(diagnostics).toEqual([]);
  });

  it('applies the existing missing-display diagnostic to the last root line without a final newline', async () => {
    // Upstream compilation accepts unknown display names. This is coverage of
    // the extension's existing authoring diagnostic, not a compiler rule.
    const uris = loadProject([{
      name: 'root.scene.dry',
      contents: 'title: Root\n\n[+ score : absent +]',
    }]);
    const diagnostics = [...(await new DendryProjectValidator().validateProject(uris)).values()].flat();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('absent.qdisplay.dry');
    expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Error);
    expect(diagnostics[0].range.start).toEqual({ line: 2, character: 11 });
    expect(diagnostics[0].range.end).toEqual({ line: 2, character: 17 });
  });
});
