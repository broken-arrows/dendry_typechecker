import { describe, expect, it } from 'vitest';
import { DendryProjectValidator } from '../project-validator';
import { DiagnosticSeverity, loadProject } from './vscode-host';

const section = 'title: Root\n\nRoot prose.\n\n@part\n';
async function validate(contents: string, target = '\nTarget prose.') {
  const uris = loadProject([
    { name: 'root.scene.dry', contents },
    { name: 'target.scene.dry', contents: target },
  ]);
  return [...(await new DendryProjectValidator().validateProject(uris))]
    .flatMap(([uri, items]) => items.map(item => ({ uri, ...item })));
}

describe('choice title diagnostics and changes across files', () => {
  it.each(['', section])('reports the missing title on the choice target: %j', async prefix => {
    const diagnostics = await validate(prefix + 'title: Source\n\nText\n\n- @target');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Error);
    expect(diagnostics[0].message).toBe("Choice to 'target' needs a title here or on the target scene.");
    expect(diagnostics[0].uri.path).toBe('/compatibility/root.scene.dry');
    expect(diagnostics[0].range.start).toEqual({ line: prefix ? 9 : 4, character: 3 });
    expect(diagnostics[0].range.end).toEqual({ line: prefix ? 9 : 4, character: 9 });
  });

  it('names each untitled matching scene at the tag choice', async () => {
    const diagnostics = await validate('title: Source\ntags: places\n\nText\n\n- #places',
      'tags: #places; other\n\nText\n\n@part\ntags: places\n\nText');
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map(item => item.message)).toEqual([
      "Scene 'target' needs a title for tag '#places'.",
      "Scene 'target.part' needs a title for tag '#places'.",
    ]);
    expect(diagnostics.every(item => item.range.start.line === 5 && item.range.start.character === 3)).toBe(true);
  });

  it('reports a missing target without adding a title error', async () => {
    const diagnostics = await validate('title: Source\n\nText\n\n- @absent');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toMatch(/undefined scene 'absent'/);
    expect(diagnostics[0].message).not.toMatch(/title|tried|candidates/i);
  });

  it('refreshes choices when another file gains or loses a title', async () => {
    const validator = new DendryProjectValidator();
    for (const title of [undefined, 'Title', '   ', '{! !}']) {
      const uris = loadProject([
        { name: 'root.scene.dry', contents: 'title: Source\n\nText\n\n- @target' },
        { name: 'target.scene.dry', contents: `${title === undefined ? '' : `title: ${title}\n`}\nText` },
      ]);
      const result = await validator.validateProject(uris, title === undefined ? undefined : uris[1]);
      const diagnostics = [...result.values()].flat();
      expect(diagnostics).toHaveLength(title === undefined || !title.trim() ? 1 : 0);
    }
  });

  it('refreshes tagged choices when another file gains or loses a title', async () => {
    const validator = new DendryProjectValidator();
    for (const title of [undefined, 'Title', '']) {
      const uris = loadProject([
        { name: 'root.scene.dry', contents: 'title: Source\n\nText\n\n- #places' },
        { name: 'target.scene.dry', contents: `${title === undefined ? '' : `title: ${title}\n`}tags: places\n\nText` },
      ]);
      const result = await validator.validateProject(uris, title === undefined ? undefined : uris[1]);
      const diagnostics = [...result.values()].flat();
      expect(diagnostics).toHaveLength(title ? 0 : 1);
    }
  });
});

describe('diagnostic language and actionable wording', () => {
  it.each([
    ['scene condition', 'root.scene.dry', 'title: Source\nview-if: flag {! return true; !}'],
    ['destination condition', 'root.scene.dry', 'title: Source\ngo-to: root if flag {! return true; !}'],
    ['quality condition', 'score.quality.dry', 'name: Score\nis-valid: flag {! return true; !}'],
    ['unclosed block', 'root.scene.dry', 'title: Source\ngo-to: root if {!'],
  ])('uses concise Dendry logic instructions for %s', async (_label, name, contents) => {
    const uris = loadProject([{ name, contents }]);
    const diagnostics = [...(await new DendryProjectValidator().validateProject(uris)).values()].flat();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).not.toMatch(/magic|tried|candidates|surrounding|exclusively/i);
    expect(diagnostics[0].message).toMatch(/Wrap the entire|Unclosed Dendry logic/);
    expect(diagnostics[0].message.length).toBeLessThan(80);
  });

  it('gives one concrete correction for a logic prefix', async () => {
    const diagnostics = await validate('title: Source\nview-if: Q.score > 0');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toBe('Use "score" without the "Q." prefix in Dendry logic.');
  });

  it('keeps call warnings focused on the missing target', async () => {
    const diagnostics = await validate('title: Source\ncall: nested');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Warning);
    expect(diagnostics[0].message).toBe("Call target 'nested' is not defined.");
  });
});
