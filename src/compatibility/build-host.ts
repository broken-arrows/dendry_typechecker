// Desktop API boundary only. Build planning, saving, task coordination and DAP
// messages all run through the production modules in build-launch.compat.ts.
import * as path from 'path';
import type * as vscode from 'vscode';

export class EventEmitter<T> {
  readonly listeners = new Set<(event: T) => unknown>();
  readonly event: vscode.Event<T> = (listener, thisArg, disposables) => {
    const bound = thisArg ? listener.bind(thisArg) : listener;
    this.listeners.add(bound);
    const disposable = { dispose: () => { this.listeners.delete(bound); } };
    disposables?.push(disposable);
    return disposable;
  };
  fire(event: T) { for (const listener of [...this.listeners]) listener(event); }
  dispose() { this.listeners.clear(); }
}

export class CancellationTokenSource {
  private readonly events = new EventEmitter<void>();
  readonly token = { isCancellationRequested: false, onCancellationRequested: this.events.event };
  cancel() {
    if (!this.token.isCancellationRequested) {
      this.token.isCancellationRequested = true;
      this.events.fire();
    }
  }
  dispose() { this.events.dispose(); }
}

export const Uri = {
  file(filename: string): vscode.Uri {
    const fsPath = path.resolve(filename);
    const make = (scheme: string): vscode.Uri => ({
      scheme, fsPath, path: fsPath.replace(/\\/g, '/'), authority: '',
      toString: () => `${scheme}://${fsPath.replace(/\\/g, '/')}`,
      with: (change: { scheme?: string }) => make(change.scheme || scheme),
    }) as vscode.Uri;
    return make('file');
  },
};
export enum FileType { File = 1, Directory = 2 }
export enum TaskRevealKind { Always = 1 }
export enum TaskPanelKind { Dedicated = 2 }
export class ShellExecution {
  constructor(readonly commandLine: string, readonly options: vscode.ShellExecutionOptions) {}
}
export class Task {
  presentationOptions?: vscode.TaskPresentationOptions;
  constructor(readonly definition: vscode.TaskDefinition, readonly scope: vscode.WorkspaceFolder,
    readonly name: string, readonly source: string, readonly execution: ShellExecution, readonly problemMatchers: string[]) {}
}
export class DebugAdapterInlineImplementation {
  constructor(readonly implementation: vscode.DebugAdapter) {}
}

const processEnds = new EventEmitter<vscode.TaskProcessEndEvent>();
const taskEnds = new EventEmitter<vscode.TaskEndEvent>();
export const buildHost = {
  files: new Map<string, FileType>(),
  settings: new Map<string, Record<string, string>>(),
  executions: [] as (vscode.TaskExecution & { terminated: boolean })[],
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  provider: undefined as vscode.DebugConfigurationProvider | undefined,
  factory: undefined as vscode.DebugAdapterDescriptorFactory | undefined,
  errors: [] as string[], warnings: [] as string[], opened: [] as vscode.Uri[],
  pickedFolder: undefined as vscode.WorkspaceFolder | undefined,
  processEnds, taskEnds,
  file(filename: string) { this.files.set(path.resolve(filename), FileType.File); return Uri.file(filename); },
  folder(filename: string): vscode.WorkspaceFolder {
    return { uri: Uri.file(filename), name: path.basename(filename), index: 0 };
  },
  finish(execution: vscode.TaskExecution, exitCode: number | undefined) {
    processEnds.fire({ execution, exitCode });
    taskEnds.fire({ execution });
  },
  reset() {
    this.files.clear(); this.settings.clear(); this.commands.clear();
    this.executions = []; this.errors = []; this.warnings = []; this.opened = [];
    this.provider = undefined; this.factory = undefined; this.pickedFolder = undefined;
    processEnds.dispose(); taskEnds.dispose();
    window.activeTextEditor = undefined;
    workspace.workspaceFolders = [];
    workspace.textDocuments = [];
  },
};

function inside(filename: string, directory: string) {
  const relative = path.relative(directory, filename);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}
export const workspace = {
  workspaceFolders: [] as vscode.WorkspaceFolder[],
  textDocuments: [] as vscode.TextDocument[],
  getWorkspaceFolder(uri: vscode.Uri) {
    return this.workspaceFolders.filter(folder => uri.scheme === folder.uri.scheme && inside(uri.fsPath, folder.uri.fsPath))
      .sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length)[0];
  },
  getConfiguration(_section: string, resource: vscode.Uri) {
    const applicable = [...buildHost.settings.keys()].filter(root => inside(resource.fsPath, root)).sort((a, b) => b.length - a.length);
    return { get<T>(key: string, fallback: T): T {
      for (const root of applicable) if (key in buildHost.settings.get(root)!) return buildHost.settings.get(root)![key] as T;
      return fallback;
    } };
  },
  fs: {
    async stat(uri: vscode.Uri) {
      const type = buildHost.files.get(uri.fsPath) || ([...buildHost.files.keys()].some(filename => inside(filename, uri.fsPath)) ? FileType.Directory : undefined);
      if (!type) throw new Error(`Missing test file ${uri.fsPath}`);
      return { type, size: 0, ctime: 0, mtime: 0 };
    },
  },
};
export const window = {
  activeTextEditor: undefined as vscode.TextEditor | undefined,
  async showWorkspaceFolderPick(_options: vscode.WorkspaceFolderPickOptions) { return buildHost.pickedFolder; },
  async showErrorMessage(message: string) { buildHost.errors.push(message); },
  async showWarningMessage(message: string) { buildHost.warnings.push(message); },
};
export const env = {
  async openExternal(uri: vscode.Uri) { buildHost.opened.push(uri); return true; },
};
export const tasks = {
  onDidEndTaskProcess: processEnds.event,
  onDidEndTask: taskEnds.event,
  async executeTask(task: vscode.Task): Promise<vscode.TaskExecution> {
    const execution = {
      task, terminated: false,
      terminate() { this.terminated = true; buildHost.finish(this, undefined); },
    };
    buildHost.executions.push(execution);
    return execution;
  },
};
export const commands = {
  registerCommand(id: string, callback: (...args: unknown[]) => unknown) {
    buildHost.commands.set(id, callback);
    return { dispose: () => { buildHost.commands.delete(id); } };
  },
};
export const debug = {
  registerDebugConfigurationProvider(_type: string, provider: vscode.DebugConfigurationProvider) {
    buildHost.provider = provider;
    return { dispose: () => { buildHost.provider = undefined; } };
  },
  registerDebugAdapterDescriptorFactory(_type: string, factory: vscode.DebugAdapterDescriptorFactory) {
    buildHost.factory = factory;
    return { dispose: () => { buildHost.factory = undefined; } };
  },
};
