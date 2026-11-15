import { describe, expect, it, vi } from 'vitest';
import { DendryProjectValidator } from '../project-validator';
import { parseText } from '../parser';
import { DiagnosticSeverity, loadProject, workspace } from './vscode-host';

async function validate(contents: string) {
  const uris = loadProject([{ name: 'root.scene.dry', contents }]);
  return [...(await new DendryProjectValidator().validateProject(uris)).values()].flat();
}

describe('JavaScript block dispatch and source positions', () => {
  it('accepts assignments beside both delimiters in a multiline block', async () => {
    expect(await validate('on-arrival: {! Q.foo = "text";\nQ.bar = "other text"; !}')).toEqual([]);
  });

  it('locates a syntax error on the closing delimiter line', async () => {
    const diagnostics = await validate('on-arrival: {! Q.foo = "text";\nQ.bar = ; !}');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toMatch(/JavaScript/);
    expect(diagnostics[0].range.start).toEqual({ line: 1, character: 8 });
  });

  it('checks unknown identifiers even in single-line blocks', async () => {
    const contents = 'on-arrival: {! missingHelper(); !}';
    const diagnostics = await validate(contents);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('missingHelper');
    expect(diagnostics[0].range.start).toEqual({ line: 0, character: contents.indexOf('missingHelper') });
  });

  const contexts = [
    { name: 'root', prefix: 'title: Root\n', key: 'view-if' },
    { name: 'section', prefix: 'title: Root\n\nText\n\n@part\n', key: 'choose-if' },
    { name: 'choice', prefix: 'title: Root\n\nText\n\n- @root\n', key: '- view-if' },
    { name: 'expression', prefix: 'title: Root\n', key: 'frequency-var' },
    { name: 'action', prefix: 'title: Root\n', key: 'on-display' },
    { name: 'destination', prefix: 'title: Root\n', key: 'go-to: root if' },
  ].map(context => ({ ...context, header: context.key.startsWith('go-to:') ? context.key : context.key + ':' }));

  it.each(contexts)('checks returning function bodies in $name', async ({ prefix, header }) => {
    expect(await validate(prefix + header + ' {! const x = Q.foo; return state.qualities.foo === x && this && arguments; !}'))
      .toEqual([]);
  });

  it.each(contexts)('maps first/last-line identifiers exactly in $name', async ({ prefix, header }) => {
    const contents = prefix + header + ' {! missingFirst();\n  missingLast(); !}';
    const diagnostics = await validate(contents);
    const lines = contents.split('\n');
    expect(diagnostics).toHaveLength(2);
    for (const [index, name] of ['missingFirst', 'missingLast'].entries()) {
      const line = lines.findIndex(text => text.includes(name));
      expect(diagnostics[index].range.start).toEqual({ line, character: lines[line].indexOf(name) });
      expect(diagnostics[index].range.end).toEqual({ line, character: lines[line].indexOf(name) + name.length });
    }
  });

  it('keeps adjacent action blocks independent and checks both', async () => {
    const contents = 'on-arrival: {! const local = 1; !} {! missingHelper(local); !}';
    const diagnostics = await validate(contents);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map(item => item.range.start.character)).toEqual([
      contents.indexOf('missingHelper'), contents.lastIndexOf('local'),
    ]);
  });

  it('maps blocks through folded continuations and mixed shorthand', async () => {
    const contents = 'On Arrival: foo = 1;\n    {! Q.foo++; !}\n    {! missingHelper(); !}\n    bar = 2;';
    const diagnostics = await validate(contents);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].range.start).toEqual({ line: 2, character: 7 });
  });

  it('does not rewrite equals signs, keywords, or prefixes inside JavaScript', async () => {
    expect(await validate('view-if: {! Q.foo = "and or not Q.bar"; return Q.foo; !}')).toEqual([]);
  });

  it('reports runtime aliases and bare project IDs as undefined', async () => {
    const uris = loadProject([
      { name: 'root.scene.dry', contents: 'on-arrival: {! S.foo; P.foo; V.foo; data; parliament; score; root; !}' },
      { name: 'score.quality.dry', contents: 'name: Score' },
    ]);
    const diagnostics = [...(await new DendryProjectValidator().validateProject(uris)).values()].flat();
    expect(diagnostics).toHaveLength(7);
    expect(diagnostics.every(item => item.severity === DiagnosticSeverity.Hint)).toBe(true);
  });

  it.each(['{!', '{! Q.foo = 1;', '{! Q.foo = 1;\n'])('keeps unfinished block errors within the real document: %j', async value => {
    const contents = 'on-arrival: ' + value;
    const diagnostics = await validate(contents);
    expect(diagnostics.some(item => item.severity === DiagnosticSeverity.Error)).toBe(true);
    const lines = contents.split('\n');
    for (const diagnostic of diagnostics) for (const position of [diagnostic.range.start, diagnostic.range.end]) {
      expect(position.line).toBeLessThan(lines.length);
      expect(position.character).toBeLessThanOrEqual(lines[position.line].length);
    }
  });

  it.each(['\n', '\r\n'])('maps syntax beside either delimiter with %j line endings', async newline => {
    for (const badLine of [0, 1]) {
      const lines = ['On Arrival: {! Q.foo = "text";', '  Q.bar = "other text"; !}'];
      lines[badLine] = lines[badLine].replace(/= "[^"]*"/, '= ');
      const diagnostics = await validate(lines.join(newline));
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].range.start).toEqual({ line: badLine, character: lines[badLine].indexOf(';') });
      expect(diagnostics[0].range.end).toEqual({ line: badLine, character: lines[badLine].indexOf(';') + 1 });
    }
  });

  it.each(['\n', '\r\n'])('maps quality predicates through continuation folding with %j', async newline => {
    const contents = ['name: Score', 'is valid:', '    {! Q.foo;', '      missingHelper(); !}'].join(newline);
    const uris = loadProject([{ name: 'score.quality.dry', contents }]);
    const diagnostics = [...(await new DendryProjectValidator().validateProject(uris)).values()].flat();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].range.start).toEqual({ line: 3, character: 6 });
  });

  it('retains language markers in the public parser output', () => {
    const source = '{! Q.foo++; !} {! Q.bar++; !}';
    const { ast, errors } = parseText('on-arrival: ' + source, 'root.scene.dry');
    expect(errors).toEqual([]);
    expect(ast.nodes[0].properties.get('on-arrival')).toBe(source);
  });

  it('maps assignment-condition warnings inside a JavaScript block', async () => {
    const diagnostics = await validate('view-if: {!\n  if (Q.foo = 1) return true;\n!}');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Warning);
    expect(diagnostics[0].range.start).toEqual({ line: 1, character: 6 });
    expect(diagnostics[0].range.end).toEqual({ line: 1, character: 15 });
  });

  it('refreshes JavaScript diagnostics after a fix and an unrelated edit', async () => {
    const validator = new DendryProjectValidator();
    for (const [index, contents] of ['on-arrival: {! missingHelper(); !}', 'on-arrival: {! missingHelper(); !}', 'on-arrival: {! Q.foo++; !}'].entries()) {
      const uris = loadProject([
        { name: 'root.scene.dry', contents },
        { name: 'other.scene.dry', contents: 'title: Other' },
      ]);
      const results = await validator.validateProject(uris, index === 0 ? undefined : uris[index === 1 ? 1 : 0]);
      const diagnostics = [...results.values()].flat();
      expect(diagnostics).toHaveLength(index === 2 ? 0 : 1);
      if (diagnostics.length) expect(diagnostics[0].message).toContain('missingHelper');
    }
  });

  it.each([false, true])('honors configured globals and strict-mode severity: %j', async strict => {
    const configuration = vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
      get: <T>(key: string, fallback: T): T => {
        if (key === 'validation.strict') return strict as T;
        if (key === 'validation.jsLibraries') return ['customLibrary'] as T;
        return fallback;
      },
    });
    try {
      const diagnostics = await validate('view-if: {! customLibrary(); missingHelper(); return Q.foo; !}');
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain('missingHelper');
      expect(diagnostics[0].severity).toBe(strict ? DiagnosticSeverity.Warning : DiagnosticSeverity.Hint);
    } finally {
      configuration.mockRestore();
    }
  });
});
