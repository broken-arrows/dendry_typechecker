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

function hostEvent<T>() {
  const listeners = new Set<(event: T) => unknown>();
  return {
    event(listener: (event: T) => unknown) {
      listeners.add(listener);
      return { dispose: () => { listeners.delete(listener); } };
    },
    fire(event: T) { for (const listener of listeners) listener(event); },
    reset() { listeners.clear(); },
  };
}

const events = {
  change: hostEvent<{ document: vscode.TextDocument }>(),
  save: hostEvent<vscode.TextDocument>(),
  open: hostEvent<vscode.TextDocument>(),
  close: hostEvent<vscode.TextDocument>(),
  delete: hostEvent<{ files: vscode.Uri[] }>(),
  folders: hostEvent<void>(),
};
const diskDocuments = new Map<string, vscode.TextDocument>();

class HostDiagnostics {
  readonly entries = new Map<string, { uri: vscode.Uri; diagnostics: readonly vscode.Diagnostic[] }>();
  readonly updates: string[] = [];
  disposed = false;
  set(uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[]) {
    if (this.disposed) throw new Error('Writing to disposed diagnostic collection');
    this.entries.set(uri.toString(), { uri, diagnostics });
    this.updates.push(uri.toString());
  }
  delete(uri: vscode.Uri) { this.entries.delete(uri.toString()); this.updates.push(uri.toString()); }
  clear() { this.entries.clear(); }
  dispose() { this.disposed = true; this.entries.clear(); }
}

export const editor = {
  events,
  collections: [] as HostDiagnostics[],
  errors: [] as string[],
  reset() {
    for (const event of Object.values(events)) event.reset();
    this.collections = [];
    this.errors = [];
    workspace.workspaceFolders = [{ name: 'compatibility' }];
    loadProject([]);
  },
};

export const languages = {
  createDiagnosticCollection() {
    const collection = new HostDiagnostics();
    editor.collections.push(collection);
    return collection;
  },
};
export const window = {
  createOutputChannel: () => ({ appendLine: (_message: string) => {}, dispose: () => {} }),
  showErrorMessage: (message: string) => { editor.errors.push(message); },
};

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
  workspaceFolders: [{ name: 'compatibility' }],
  onDidChangeTextDocument: events.change.event,
  onDidSaveTextDocument: events.save.event,
  onDidOpenTextDocument: events.open.event,
  onDidCloseTextDocument: events.close.event,
  onDidDeleteFiles: events.delete.event,
  onDidChangeWorkspaceFolders: events.folders.event,
  async findFiles(pattern: string, _exclude?: string) {
    const suffix = pattern.replace('**/*', '').replace('**/', '/');
    return [...diskDocuments.values()].filter(document => document.uri.path.endsWith(suffix)).map(document => document.uri);
  },
  getConfiguration: () => ({ get: <T>(_key: string, fallback: T): T => fallback }),
  async openTextDocument(uri: vscode.Uri): Promise<vscode.TextDocument> {
    const document = diskDocuments.get(uri.toString());
    if (!document) throw new Error(`Missing test document: ${uri.path}`);
    if (!workspace.textDocuments.includes(document)) {
      workspace.textDocuments.push(document);
      events.open.fire(document);
    }
    return document;
  },
  fs: {
    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
      const document = diskDocuments.get(uri.toString());
      if (!document) throw new Error(`Missing test file: ${uri.path}`);
      return Buffer.from(document.getText(), 'utf8');
    },
  },
};

export function loadProject(files: { name: string; contents: string }[]): vscode.Uri[] {
  workspace.textDocuments = files.map(file => makeDocument(file.name, file.contents));
  diskDocuments.clear();
  for (const document of workspace.textDocuments) diskDocuments.set(document.uri.toString(), document);
  return workspace.textDocuments.map(document => document.uri);
}
