// A VS Code boundary stand-in, not an alternate parser or validator.
// Fail loudly on unsupported document operations rather than hiding harness bugs.
import type * as vscode from 'vscode';

export class Position {
  constructor(public line: number, public character: number) {
    if (!Number.isInteger(line) || !Number.isInteger(character) || line < 0 || character < 0) {
      throw new Error(`Invalid test position: ${line}:${character}`);
    }
  }
}

export class Range {
  start: Position;
  end: Position;

  constructor(start: Position, end: Position);
  constructor(startLine: number, startColumn: number, endLine: number, endColumn: number);
  constructor(a: Position | number, b: Position | number, c?: number, d?: number) {
    this.start = a instanceof Position ? a : new Position(a, b as number);
    this.end = a instanceof Position ? b as Position : new Position(c!, d!);
  }
}

export enum DiagnosticSeverity { Error, Warning, Information, Hint }

export class Diagnostic {
  source?: string;
  constructor(public range: Range, public message: string, public severity = DiagnosticSeverity.Error) {}
}

function makeDocument(name: string, text: string): vscode.TextDocument {
  const path = `/compatibility/${name}`;
  const uri = {
    scheme: 'file', authority: '', path, fsPath: path,
    toString: () => `file://${path}`,
  } as vscode.Uri;
  const lines = text.split(/\r?\n/);
  const lineAt = (line: number) => {
    if (!Number.isInteger(line) || line < 0 || line >= lines.length) {
      throw new Error(`Test document ${name} has no line ${line}`);
    }
    return { text: lines[line], range: new Range(line, 0, line, lines[line].length) };
  };
  const document = {
    uri, fileName: path, languageId: 'dendry', version: 1,
    isDirty: false, isClosed: false, isUntitled: false, lineCount: lines.length,
    lineAt,
    getText(range?: vscode.Range): string {
      if (!range) return text;
      const selected = lines.slice(range.start.line, range.end.line + 1);
      if (!selected.length) return '';
      if (selected.length === 1) return selected[0].slice(range.start.character, range.end.character);
      selected[selected.length - 1] = selected[selected.length - 1].slice(0, range.end.character);
      selected[0] = selected[0].slice(range.start.character);
      return selected.join('\n');
    },
  };
  return new Proxy(document, {
    get(target, key) {
      // Async APIs probe returned objects for a thenable before resolving them.
      if (key === 'then') return undefined;
      if (!(key in target)) throw new Error(`Unsupported test TextDocument operation: ${String(key)}`);
      return Reflect.get(target, key);
    },
  }) as unknown as vscode.TextDocument;
}

export const workspace = {
  textDocuments: [] as vscode.TextDocument[],
  getConfiguration: () => ({ get: <T>(_key: string, fallback: T): T => fallback }),
  async openTextDocument(uri: vscode.Uri): Promise<vscode.TextDocument> {
    const document = workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
    if (!document) throw new Error(`Missing test document: ${uri.path}`);
    return document;
  },
  fs: {
    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
      return Buffer.from((await workspace.openTextDocument(uri)).getText(), 'utf8');
    },
  },
};

export function loadProject(files: { name: string; contents: string }[]): vscode.Uri[] {
  workspace.textDocuments = files.map(file => makeDocument(file.name, file.contents));
  return workspace.textDocuments.map(document => document.uri);
}
