import { describe, expect, it } from 'vitest';
import { DendryProjectValidator } from '../project-validator';
import { DiagnosticSeverity, loadProject } from './vscode-host';

async function validate(contents: string, name = 'rating.qdisplay.dry') {
  const uris = loadProject([{ name, contents }]);
  return [...(await new DendryProjectValidator().validateProject(uris)).values()].flat();
}

describe('QDisplay structure and diagnostic lifecycle', () => {
  it.each(['1-5', '1 to 5', '1..5', '1+5', '1,5', '5..1', '-.5..2.5', '..5', '1..', '..', '1...4', '1--5'])
    ('accepts an upstream range: %s', async range => {
      expect(await validate(`\n(${range}) text`)).toEqual([]);
    });
  it.each(['1.2.3..4', '1e3..4', '1 .. 4 garbage', '1..4..5'])
    ('rejects malformed numeric/range syntax: %s', async range => {
      const diagnostics = await validate(`\n(${range}) text`);
      expect(diagnostics.some(item => item.severity === DiagnosticSeverity.Error)).toBe(true);
    });
  it('accepts initial comments, indented continuations and overlapping fallback ranges', async () => {
    expect(await validate('#comment\n\n(1-5) Low\n    continuation\n(..) Fallback\n(2..3) Later')).toEqual([]);
  });
  it('rejects a blank row between range declarations', async () => {
    const diagnostics = await validate('\n(1..2) First\n\n(3..4) Second');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].range.start.line).toBe(2);
  });
  it('retains errors on unrelated edits, clears them after fixing, and removes deleted files', async () => {
    const validator = new DendryProjectValidator();
    for (const [index, contents] of ['\n(1.2.3..4) Bad', '\n(1.2.3..4) Bad', '\n(1-4) Good'].entries()) {
      const uris = loadProject([
        { name: 'rating.qdisplay.dry', contents }, { name: 'root.scene.dry', contents: 'title: Root' },
      ]);
      const results = await validator.validateProject(uris, index === 0 ? undefined : uris[index === 1 ? 1 : 0]);
      expect([...results.values()].flat()).toHaveLength(index === 2 ? 0 : 1);
    }
    const uris = loadProject([{ name: 'root.scene.dry', contents: 'title: Root' }]);
    expect([...(await validator.validateProject(uris)).values()].flat()).toEqual([]);
  });
  it.each(['cardinal', 'ordinal', 'number', 'fudge'])('accepts built-in formatter references without files: %s', async name => {
    expect(await validate(`title: [+ score : ${name} +]\n\n[+ score : ${name} +]`, 'root.scene.dry')).toEqual([]);
  });
  it.each(['cardinal', 'ordinal', 'number', 'fudge', '_bad', 'bad.name'])('rejects an invalid or reserved filename: %s', async name => {
    const diagnostics = await validate('\n(..) Text', `${name}.qdisplay.dry`);
    expect(diagnostics.some(item => item.severity === DiagnosticSeverity.Error)).toBe(true);
  });
  it('warns about duplicate display IDs without claiming a compiler rejection', async () => {
    const uris = loadProject([
      { name: 'one/rating.qdisplay.dry', contents: '\n(..) One' },
      { name: 'two/rating.qdisplay.dry', contents: '\n(..) Two' },
    ]);
    const diagnostics = [...(await new DendryProjectValidator().validateProject(uris)).values()].flat();
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.every(item => item.severity === DiagnosticSeverity.Warning && /Duplicate QDisplay/.test(item.message))).toBe(true);
  });
  it('recomputes duplicate warnings without accumulating cached warnings', async () => {
    const validator = new DendryProjectValidator();
    for (const count of [2, 2, 1]) {
      const files = [
        { name: 'one/rating.qdisplay.dry', contents: '\n(..) One' },
        ...(count === 2 ? [{ name: 'two/rating.qdisplay.dry', contents: '\n(..) Two' }] : []),
        { name: 'root.scene.dry', contents: 'title: Root' },
      ];
      const uris = loadProject(files);
      const diagnostics = [...(await validator.validateProject(uris, uris[uris.length - 1])).values()].flat();
      expect(diagnostics).toHaveLength(count === 2 ? 2 : 0);
    }
  });
  it('removes cached errors when an invalid display file is deleted', async () => {
    const validator = new DendryProjectValidator();
    const original = loadProject([{ name: 'rating.qdisplay.dry', contents: '\n(1.2.3..4) Bad' }]);
    expect([...(await validator.validateProject(original)).values()].flat()).toHaveLength(1);
    const remaining = loadProject([{ name: 'root.scene.dry', contents: 'title: Root' }]);
    expect([...(await validator.validateProject(remaining)).values()].flat()).toEqual([]);
  });
  it('keeps the exact malformed-row span with CRLF and no final newline', async () => {
    const lines = ['#comment', '', '(1.2.3..4) Bad'];
    const diagnostics = await validate(lines.join('\r\n'));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].range.start).toEqual({ line: 2, character: 0 });
    expect(diagnostics[0].range.end).toEqual({ line: 2, character: lines[2].length });
  });
});
