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
  create: hostEvent<{ files: vscode.Uri[] }>(),
  rename: hostEvent<{ files: { oldUri: vscode.Uri; newUri: vscode.Uri }[] }>(),
  configuration: hostEvent<{ affectsConfiguration: (section: string) => boolean }>(),
  folders: hostEvent<void>(),
};
const diskDocuments = new Map<string, vscode.TextDocument>();

export enum FileType { Unknown = 0, File = 1, Directory = 2, SymbolicLink = 64 }
export class RelativePattern {
  readonly baseUri: vscode.Uri;
  constructor(base: vscode.Uri | { uri: vscode.Uri }, readonly pattern: string) {
    this.baseUri = 'uri' in base ? base.uri : base;
  }
}
function globMatches(pattern: string, path: string): boolean {
  const brace = /\{([^{}]+)\}/.exec(pattern);
  if (brace) return brace[1].split(',').some(part => globMatches(pattern.replace(brace[0], part), path));
  let expression = '^';
  for (let i = 0; i < pattern.length; i++) {
    const character = pattern[i];
    if (pattern.slice(i, i + 3) === '**/') { expression += '(?:.*/)?'; i += 2; }
    else if (pattern.slice(i, i + 2) === '**') { expression += '.*'; i++; }
    else if (character === '*') expression += '[^/]*';
    else if (character === '?') expression += '[^/]';
    else expression += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(expression + '$').test(path);
}
function inside(uri: vscode.Uri, base: vscode.Uri) {
  return uri.scheme === base.scheme && uri.authority.toLowerCase() === base.authority.toLowerCase() &&
    (uri.path === base.path || uri.path.startsWith(base.path.replace(/\/$/, '') + '/'));
}
class HostWatcher {
  readonly change = hostEvent<vscode.Uri>();
  readonly create = hostEvent<vscode.Uri>();
  readonly delete = hostEvent<vscode.Uri>();
  readonly onDidChange = this.change.event;
  readonly onDidCreate = this.create.event;
  readonly onDidDelete = this.delete.event;
  disposed = false;
  constructor(readonly pattern: vscode.GlobPattern) {}
  matches(uri: vscode.Uri) {
    if (typeof this.pattern === 'string') return !!workspace.getWorkspaceFolder(uri) && globMatches(this.pattern, uri.path.slice(1));
    return inside(uri, this.pattern.baseUri) && globMatches(this.pattern.pattern, uri.path.slice(this.pattern.baseUri.path.length + 1));
  }
  dispose() { this.disposed = true; this.change.reset(); this.create.reset(); this.delete.reset(); }
}

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
  settings: new Map<string, Record<string, unknown>>(),
  watchers: [] as HostWatcher[],
  configure(values: Record<string, unknown>, path = '') {
    this.settings.set(path, values);
    events.configuration.fire({ affectsConfiguration: section => section === 'dendry' || section === 'dendry.validation' });
  },
  watch(kind: 'create' | 'change' | 'delete', uri: vscode.Uri) {
    for (const watcher of this.watchers) if (!watcher.disposed && watcher.matches(uri)) watcher[kind].fire(uri);
  },
  writeFile(name: string, contents: string) {
    const document = makeDocument(name, contents);
    diskDocuments.set(document.uri.toString(), document);
    return document.uri;
  },
  deleteFile(uri: vscode.Uri) { diskDocuments.delete(uri.toString()); },
  close(document: vscode.TextDocument) {
    workspace.textDocuments = workspace.textDocuments.filter(item => item !== document);
    events.close.fire(document);
  },
  reset() {
    for (const event of Object.values(events)) event.reset();
    this.collections = [];
    this.errors = [];
    this.settings.clear();
    this.watchers = [];
    workspace.workspaceFolders = [{ name: 'compatibility', uri: makeUri('/compatibility'), index: 0 }];
    loadProject([]);
  },
};

export const languages = {
  match(selector: { pattern: vscode.GlobPattern }, document: vscode.TextDocument) {
    const pattern = selector.pattern;
    if (typeof pattern === 'string') return globMatches(pattern, document.uri.path) ? 10 : 0;
    return inside(document.uri, pattern.baseUri) && globMatches(pattern.pattern, document.uri.path.slice(pattern.baseUri.path.length + 1)) ? 10 : 0;
  },
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

function makeUri(path: string, scheme = 'file', authority = ''): vscode.Uri {
  return {
    scheme, authority, path, fsPath: path,
    with: (change: { path?: string; scheme?: string; authority?: string }) => makeUri(change.path ?? path, change.scheme ?? scheme, change.authority ?? authority),
    toString: () => `${scheme}://${authority}${path}`,
  } as vscode.Uri;
}
function makeDocument(name: string, text: string): vscode.TextDocument {
  const uri = makeUri(`/compatibility/${name}`);
  const lines = text.split(/\r?\n/);
  const lineAt = (line: number) => {
    if (!Number.isInteger(line) || line < 0 || line >= lines.length) {
      throw new Error(`Test document ${name} has no line ${line}`);
    }
    return { text: lines[line], range: new Range(line, 0, line, lines[line].length) };
  };
  const document = {
    uri, fileName: uri.path, languageId: 'dendry', version: 1,
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
  workspaceFolders: [{ name: 'compatibility', uri: makeUri('/compatibility'), index: 0 }] as { name: string; uri: vscode.Uri; index: number }[] | undefined,
  onDidChangeTextDocument: events.change.event,
  onDidSaveTextDocument: events.save.event,
  onDidOpenTextDocument: events.open.event,
  onDidCloseTextDocument: events.close.event,
  onDidDeleteFiles: events.delete.event,
  onDidCreateFiles: events.create.event,
  onDidRenameFiles: events.rename.event,
  onDidChangeConfiguration: events.configuration.event,
  onDidChangeWorkspaceFolders: events.folders.event,
  createFileSystemWatcher(pattern: vscode.GlobPattern) {
    const watcher = new HostWatcher(pattern);
    editor.watchers.push(watcher);
    return watcher;
  },
  getWorkspaceFolder(uri: vscode.Uri) {
    return workspace.workspaceFolders?.filter(folder => inside(uri, folder.uri)).sort((a, b) => b.uri.path.length - a.uri.path.length)[0];
  },
  async findFiles(pattern: vscode.GlobPattern, exclude?: vscode.GlobPattern | null) {
    return [...diskDocuments.values()].filter(document => {
      const base = typeof pattern === 'string' ? workspace.getWorkspaceFolder(document.uri)?.uri : pattern.baseUri;
      if (!base || !inside(document.uri, base)) return false;
      const relative = document.uri.path.slice(base.path.length + 1);
      return globMatches(typeof pattern === 'string' ? pattern : pattern.pattern, relative) &&
        !(typeof exclude === 'string' && globMatches(exclude, relative));
    }).map(document => document.uri);
  },
  getConfiguration: (_section?: string, resource?: vscode.Uri) => ({
    get: <T>(key: string, fallback: T): T => {
      const paths = [...editor.settings.keys()].filter(path => !path || resource?.path.startsWith(path)).sort((a, b) => b.length - a.length);
      for (const path of paths) if (key in editor.settings.get(path)!) return editor.settings.get(path)![key] as T;
      return fallback;
    },
  }),
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
    async stat(uri: vscode.Uri) {
      if (diskDocuments.has(uri.toString())) return { type: FileType.File };
      if ([...diskDocuments.values()].some(document => inside(document.uri, uri))) return { type: FileType.Directory };
      throw new Error(`Missing test path: ${uri.path}`);
    },
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
