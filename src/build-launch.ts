import * as path from 'path';
import * as vscode from 'vscode';

export const DEFAULT_BUILD_COMMAND = 'dendrynexus make-html --pretty';
export const DEFAULT_OUTPUT_PATH = 'out/html/index.html';

export interface BuildConfiguration {
  buildCommand?: string;
  outputPath?: string;
  cwd?: string;
}

export class BuildCancelled extends Error {
  constructor() { super('Dendry build cancelled.'); }
}

function inside(file: string, directory: string): boolean {
  const relative = path.relative(directory, file);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function checkCancellation(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) throw new BuildCancelled();
}

async function isFile(filename: string): Promise<boolean> {
  try { return !!((await vscode.workspace.fs.stat(vscode.Uri.file(filename))).type & vscode.FileType.File); }
  catch { return false; }
}

/** One owner for command and launch.json builds, including in-flight cancellation. */
export class DendryBuildLauncher implements vscode.Disposable {
  private readonly pending = new Set<vscode.CancellationTokenSource>();
  private readonly running = new Set<string>();
  private disposed = false;

  async run(config: BuildConfiguration = {}, launchFolder?: vscode.WorkspaceFolder,
    cancellation?: vscode.CancellationToken): Promise<void> {
    if (this.disposed) throw new BuildCancelled();
    const source = new vscode.CancellationTokenSource();
    this.pending.add(source);
    const registration = cancellation?.onCancellationRequested(() => source.cancel());
    if (cancellation?.isCancellationRequested) source.cancel();
    const token = source.token;
    let project: string | undefined;
    let ownsProject = false;
    try {
      checkCancellation(token);
      for (const key of ['cwd', 'buildCommand', 'outputPath'] as const) {
        if (config[key] !== undefined && (typeof config[key] !== 'string' || !config[key]!.trim())) {
          throw new Error(`${key} must be a nonempty string.`);
        }
      }
      const active = vscode.window.activeTextEditor?.document.uri;
      const explicitFolder = config.cwd && path.isAbsolute(config.cwd)
        ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(config.cwd)) : undefined;
      const folders = vscode.workspace.workspaceFolders || [];
      const folder = launchFolder || explicitFolder || (active && vscode.workspace.getWorkspaceFolder(active)) ||
        (folders.length === 1 ? folders[0] : folders.length > 1
          ? await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Choose the Dendry project to build' }) : undefined);
      checkCancellation(token);
      if (!folder) {
        if (folders.length) throw new BuildCancelled();
        throw new Error('Open a Dendry project folder before building.');
      }
      if (folder.uri.scheme !== 'file') throw new Error('Build and Launch requires a filesystem project folder.');

      const cwd = config.cwd ? path.resolve(folder.uri.fsPath, config.cwd)
        : await this.findProjectRoot(folder, active, token);
      checkCancellation(token);
      const root = vscode.Uri.file(cwd);
      let directory: vscode.FileStat;
      try { directory = await vscode.workspace.fs.stat(root); }
      catch { throw new Error(`Build folder does not exist: ${cwd}`); }
      if (!(directory.type & vscode.FileType.Directory)) throw new Error(`Build folder is not a directory: ${cwd}`);
      checkCancellation(token);
      project = process.platform === 'win32' ? cwd.toLowerCase() : cwd;
      if (this.running.has(project)) throw new Error('A Dendry build is already running for this project.');
      this.running.add(project);
      ownsProject = true;

      const settings = vscode.workspace.getConfiguration('dendry.debug', root);
      const command = config.buildCommand ?? settings.get<string>('buildCommand', DEFAULT_BUILD_COMMAND);
      const output = config.outputPath ?? settings.get<string>('outputPath', DEFAULT_OUTPUT_PATH);
      if (typeof command !== 'string' || !command.trim()) throw new Error('Build command must be a nonempty string.');
      if (typeof output !== 'string' || !output.trim()) throw new Error('HTML output path must be a nonempty string.');

      const documents = () => vscode.workspace.textDocuments.filter(document =>
        !document.isClosed && document.isDirty && document.uri.scheme === 'file' && inside(document.uri.fsPath, cwd));
      for (const document of documents()) {
        checkCancellation(token);
        if (!await document.save()) throw new Error(`Save cancelled or failed: ${document.uri.fsPath}`);
      }
      checkCancellation(token);
      if (documents().length) throw new Error('Project files changed while saving. Save them before building again.');

      const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'PATH';
      const bins = [...new Set([path.join(cwd, 'node_modules', '.bin'), path.join(folder.uri.fsPath, 'node_modules', '.bin')])];
      // Select npm's Windows command shim explicitly.
      const shellCommand = process.platform === 'win32' && command === DEFAULT_BUILD_COMMAND
        ? 'dendrynexus.cmd make-html --pretty' : command;
      const task = new vscode.Task({ type: 'shell', command: shellCommand, cwd }, folder, 'Build Dendry', 'Dendry',
        new vscode.ShellExecution(shellCommand, {
          // Preserve the previous spawn({ shell: true }) interpreter instead of
          // inheriting VS Code's terminal profile (e.g. PowerShell 5.1).
          executable: process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : '/bin/sh',
          shellArgs: process.platform === 'win32' ? ['/d', '/s', '/c'] : ['-c'],
          cwd, env: { [pathKey]: [...bins, process.env[pathKey] || ''].join(path.delimiter) },
        }), []);
      task.presentationOptions = {
        reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated,
        clear: true, showReuseMessage: false,
      };
      await executeBuildTask(task, token);
      checkCancellation(token);
      const html = vscode.Uri.file(path.resolve(cwd, output));
      if (!await isFile(html.fsPath)) throw new Error(`Build finished, but HTML output was not found: ${html.fsPath}`);
      checkCancellation(token);
      if (!await vscode.env.openExternal(html)) throw new Error(`Could not open HTML output: ${html.fsPath}`);
    } finally {
      if (ownsProject) this.running.delete(project!);
      registration?.dispose();
      this.pending.delete(source);
      source.dispose();
    }
  }

  private async findProjectRoot(folder: vscode.WorkspaceFolder, active: vscode.Uri | undefined,
    token: vscode.CancellationToken): Promise<string> {
    const base = folder.uri.fsPath;
    let candidate = active?.scheme === 'file' && inside(active.fsPath, base) ? path.dirname(active.fsPath) : base;
    while (inside(candidate, base)) {
      if (await isFile(path.join(candidate, 'source', 'info.dry'))) return candidate;
      checkCancellation(token);
      // Opening the source directory itself is a common workspace layout.
      if (path.basename(candidate) === 'source' && await isFile(path.join(candidate, 'info.dry'))) return path.dirname(candidate);
      if (candidate === base) break;
      candidate = path.dirname(candidate);
    }
    return base; // Custom commands may use a different source layout; cwd can override it.
  }

  dispose(): void {
    this.disposed = true;
    for (const source of this.pending) source.cancel();
  }
}

function executeBuildTask(task: vscode.Task, token: vscode.CancellationToken): Promise<void> {
  return new Promise((resolve, reject) => {
    let execution: vscode.TaskExecution | undefined;
    let settled = false;
    const buffered: { execution: vscode.TaskExecution; code?: number; process: boolean }[] = [];
    const subscriptions: vscode.Disposable[] = [];
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      for (const disposable of subscriptions) disposable.dispose();
      if (error) reject(error); else resolve();
    };
    const terminate = () => {
      try { execution?.terminate(); } catch { /* The task may already have ended. */ }
    };
    const end = (event: { execution: vscode.TaskExecution; code?: number; process: boolean }) => {
      if (settled) return;
      if (!execution) { buffered.push(event); return; }
      if (event.execution !== execution) return;
      if (event.process && event.code === 0) finish();
      else finish(new Error(event.process ? `Build task exited with ${event.code === undefined ? 'no exit code (terminated)' : `code ${event.code}`}.`
        : 'Build task ended without a successful process exit.'));
    };
    subscriptions.push(
      vscode.tasks.onDidEndTaskProcess(event => end({ execution: event.execution, code: event.exitCode, process: true })),
      vscode.tasks.onDidEndTask(event => end({ execution: event.execution, process: false })),
      token.onCancellationRequested(() => { finish(new BuildCancelled()); terminate(); }),
    );
    if (token.isCancellationRequested) { finish(new BuildCancelled()); return; }
    try {
      void vscode.tasks.executeTask(task).then(result => {
        execution = result;
        if (settled) { terminate(); return; }
        for (const event of buffered) end(event);
      }, error => finish(error instanceof Error ? error : new Error(String(error))));
    } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}
