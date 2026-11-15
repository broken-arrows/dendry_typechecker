import type * as vscode from 'vscode';

/** The immutable document surface needed by parsing and diagnostic mapping. */
export interface SourceDocument {
  readonly uri: vscode.Uri;
  readonly lineCount: number;
  lineAt(line: number): { text: string };
  getText(range?: vscode.Range): string;
}

export function sourceDocument(uri: vscode.Uri, text: string): SourceDocument {
  const lines = text.split(/\r?\n/);
  return {
    uri,
    lineCount: lines.length,
    lineAt(line) {
      if (line < 0 || line >= lines.length) throw new RangeError(`Source line ${line} is out of range.`);
      return { text: lines[line] };
    },
    getText(range) {
      if (!range) return text;
      const selected = lines.slice(range.start.line, range.end.line + 1);
      if (!selected.length) return '';
      if (selected.length === 1) return selected[0].slice(range.start.character, range.end.character);
      selected[selected.length - 1] = selected[selected.length - 1].slice(0, range.end.character);
      selected[0] = selected[0].slice(range.start.character);
      return selected.join('\n');
    },
  };
}
