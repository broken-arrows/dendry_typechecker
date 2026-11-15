import { describe, expect, it } from 'vitest';
import { parseText } from '../parser';
import { DendryProjectValidator } from '../project-validator';
import { DiagnosticSeverity, loadProject } from './vscode-host';

type File = { name: string; contents: string };
async function validate(contents: string, name = 'root.scene.dry', others: File[] = []) {
  const uris = loadProject([{ name, contents }, ...others]);
  return [...(await new DendryProjectValidator().validateProject(uris)).values()].flat();
}

describe('shared rich-content extraction and project diagnostics', () => {
  it('exposes mapped expression and predicate dependencies through the public file AST', () => {
    const { ast, errors } = parseText('title: [+ score + 1 : number +]\n\n[? if ready : [+ {! return Q.score; !} +] ?]', 'root.scene.dry');
    expect(errors).toEqual([]);
    const root = ast.nodes.find(node => node.type === 'scene')!;
    const body = root.richContent.find(content => content.linked)!;
    expect(body.parsed.issues).toEqual([]);
    expect(body.parsed.dependencies.map(item => [item.kind, item.language, item.source.text.trim()]))
      .toEqual([['predicate', 'logic', 'ready'], ['expression', 'magic', 'return Q.score;']]);
    const title = root.richContent.find(content => !content.linked)!;
    expect(title.parsed.dependencies[0].qdisplay?.text).toBe('number');
    expect(title.parsed.dependencies[0].source.position(0)).toEqual({ line: 0, character: 10 });
  });

  it.each([
    ['root.scene.dry', 'title: Root\n\n[+ score + 1 +]'],
    ['root.scene.dry', 'title: [+ 3 : number +]'],
    ['root.scene.dry', 'title: Root\nsubtitle: [+ score + 1 +]'],
    ['root.scene.dry', 'title: Root\n\n@part\ntitle: [+ score + 1 +]'],
    ['root.scene.dry', 'title: Root\n\n- @root: [+ score + 1 +]'],
    ['root.scene.dry', 'title: Root\n\n- @root\n- title: [+ score + 1 +]\n- unavailable-subtitle: [+ 3 +]'],
    ['health.quality.dry', 'name: Health\n\n[+ score + 1 +]'],
    ['rating.qdisplay.dry', '\n(..) [+ score + 1 +]'],
  ])('accepts expressions in each supported content location: %s %s', async (name, contents) => {
    expect(await validate(contents, name)).toEqual([]);
  });

  it.each(['\n', '\r\n'])('maps shorthand errors through multiline body content: %j', async newline => {
    const lines = ['title: Root', '', '[+ score +', '    Q.bad +]'];
    const diagnostics = await validate(lines.join(newline));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('without the "Q." prefix');
    expect(diagnostics[0].range.start).toEqual({ line: 3, character: 4 });
    expect(diagnostics[0].range.end).toEqual({ line: 3, character: 9 });
  });

  it.each(['\n', '\r\n'])('maps content JavaScript errors after whitespace folding: %j', async newline => {
    const lines = ['title: Root', '', '[+ {!', '    return Q.score +;', '!} +]'];
    const diagnostics = await validate(lines.join(newline));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toMatch(/JavaScript|syntax/i);
    expect(diagnostics[0].range.start).toEqual({ line: 3, character: lines[3].indexOf(';') });
  });

  it.each(['\n', '\r\n'])('maps a missing formatter through a folded text property: %j', async newline => {
    const lines = ['title: [+ score + 1', '    : missing +]'];
    const diagnostics = await validate(lines.join(newline));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('missing.qdisplay.dry');
    expect(diagnostics[0].range.start).toEqual({ line: 1, character: 6 });
    expect(diagnostics[0].range.end).toEqual({ line: 1, character: 13 });
  });

  it('maps repeated identical expressions to their own physical lines', async () => {
    const diagnostics = await validate('title: Root\n\n[+ Q.bad +]\n[+ Q.bad +]');
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map(item => item.range.start)).toEqual([{ line: 2, character: 3 }, { line: 3, character: 3 }]);
  });

  it('validates nested conditions and inserts exactly once on option properties', async () => {
    const diagnostics = await validate('title: Root\n\n- @root\n- title: [? if ready : [+ Q.bad +] ?]');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].range.start.line).toBe(3);
  });

  it('maps a magic predicate finding to its original source line', async () => {
    const diagnostics = await validate('title: Root\n\n[? if {!\n  return unknownValue;\n!} : Visible ?]');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Hint);
    expect(diagnostics[0].range.start).toEqual({ line: 3, character: 9 });
    expect(diagnostics[0].range.end).toEqual({ line: 3, character: 21 });
  });

  it('respects column-zero comments without shifting later source positions', async () => {
    const diagnostics = await validate('title: Root\n\n[? if ready :\n# [+ Q.ignored +]\n[+ Q.bad +]\n?]');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].range.start).toEqual({ line: 4, character: 3 });
  });

  it.each([
    ['root.scene.dry', 'title: Root\n\n{! [+ Q.bad : absent +] [? invalid : text ?] !}'],
    ['root.scene.dry', 'title: Root\n\n\\[+ Q.bad : absent \\+]'],
    ['root.scene.dry', 'title: Root\n\n[? if ready : {! [+ Q.bad : absent +] !} ?]'],
    ['health.quality.dry', 'name: [+ Q.bad +]'],
    ['info.dry', 'title: [+ Q.bad +]\nauthor: [? invalid : text ?]\n\n[+ Q.bad +]'],
  ])('leaves opaque or escaped text unchecked: %s %s', async (name, contents) => {
    const diagnostics = await validate(contents, name, name === 'info.dry' ? [{ name: 'root.scene.dry', contents: 'title: Root' }] : []);
    expect(diagnostics).toEqual([]);
  });

  it('checks only the output actually captured from a QDisplay row', async () => {
    expect(await validate('\n(..) Output\n  [+ Q.ignored +]', 'rating.qdisplay.dry')).toEqual([]);
    const diagnostics = await validate('\n(..)\n  [+ Q.bad +]\n  [+ Q.ignored +]', 'rating.qdisplay.dry');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].range.start).toEqual({ line: 2, character: 5 });
  });

  it('uses compiler errors for body visits and authoring warnings in unlinked text', async () => {
    const body = await validate('title: Root\n\n[+ @root +]');
    expect(body).toHaveLength(1);
    expect(body[0].severity).toBe(DiagnosticSeverity.Error);
    const title = await validate('title: [+ @root +]');
    expect(title).toHaveLength(1);
    expect(title[0].severity).toBe(DiagnosticSeverity.Warning);
  });

  it('resolves scene-body visits using the containing section namespace', async () => {
    const contents = 'title: Root\n\n@part\ntitle: Part\n\n[+ @target +]\n\n@part.target\ntitle: Target\nmax-visits: 3';
    expect(await validate(contents)).toEqual([]);
  });

  it('refreshes cached body visit errors after another file enables tracking', async () => {
    const validator = new DendryProjectValidator();
    for (const [index, tracked] of [false, true, false].entries()) {
      const uris = loadProject([
        { name: 'root.scene.dry', contents: 'title: Root\n\n[+ @target +]' },
        { name: 'target.scene.dry', contents: `title: Target${tracked ? '\nmax-visits: 3' : ''}` },
      ]);
      // Initialize both files on the first pass; thereafter change only target.
      const results = await validator.validateProject(uris, index === 0 ? undefined : uris[1]);
      const diagnostics = [...results.values()].flat();
      expect(diagnostics).toHaveLength(tracked ? 0 : 1);
    }
  });

  it('refreshes formatter references in cached QDisplay output on addition and deletion', async () => {
    const validator = new DendryProjectValidator();
    let first = true;
    for (const available of [false, false, true, false]) {
      const files = [
        { name: 'rating.qdisplay.dry', contents: '\n(..) [? if ready : [+ score + 1 : other +] ?]' },
        { name: 'root.scene.dry', contents: 'title: Root' },
        ...(available ? [{ name: 'other.qdisplay.dry', contents: '\n(..) Text' }] : []),
      ];
      const uris = loadProject(files);
      const results = await validator.validateProject(uris, first ? undefined : uris[available ? 2 : 1]);
      first = false;
      const diagnostics = [...results.values()].flat();
      expect(diagnostics).toHaveLength(available ? 0 : 1);
      if (!available) {
        expect(diagnostics[0].message).toContain('other.qdisplay.dry');
        expect(diagnostics[0].range.start).toEqual({ line: 1, character: 34 });
      }
    }
  });

  it('retains and clears QDisplay content errors across unrelated edits, fixes and deletion', async () => {
    const validator = new DendryProjectValidator();
    for (const [index, contents] of ['\n(..) [+ Q.bad +]', '\n(..) [+ Q.bad +]', '\n(..) [+ score + 1 +]'].entries()) {
      const uris = loadProject([{ name: 'rating.qdisplay.dry', contents }, { name: 'root.scene.dry', contents: 'title: Root' }]);
      const results = await validator.validateProject(uris, index === 0 ? undefined : uris[index === 1 ? 1 : 0]);
      expect([...results.values()].flat()).toHaveLength(index === 2 ? 0 : 1);
    }
    const uris = loadProject([{ name: 'root.scene.dry', contents: 'title: Root' }]);
    expect([...(await validator.validateProject(uris)).values()].flat()).toEqual([]);
  });
});
