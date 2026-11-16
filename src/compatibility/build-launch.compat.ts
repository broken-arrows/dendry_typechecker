import * as path from 'path';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import type * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', async () => import('./build-host'));
vi.mock('../activate-core', () => ({ activateCore: vi.fn(), deactivateCore: vi.fn() }));

import { BuildCancelled, DEFAULT_BUILD_COMMAND, DendryBuildLauncher } from '../build-launch';
import { DendryDebugConfigurationProvider, DendryLaunchAdapter } from '../debug-adapter';
import * as desktop from '../extension';
import * as web from '../extension.web';
import { buildHost, CancellationTokenSource, DebugAdapterInlineImplementation, env, tasks, Uri, window, workspace } from './build-host';

const base = path.resolve('docs', 'build-fixtures');
const alpha = path.join(base, 'game a');
const beta = path.join(base, 'game b');
function project(root: string) {
  buildHost.file(path.join(root, 'source', 'info.dry'));
  buildHost.file(path.join(root, 'out', 'html', 'index.html'));
  return buildHost.folder(root);
}
function dirty(filename: string, succeeds = true): vscode.TextDocument {
  const document = {
    uri: buildHost.file(filename), isDirty: true, isClosed: false,
    save: vi.fn(async () => { if (succeeds) document.isDirty = false; return succeeds; }),
  };
  workspace.textDocuments.push(document as unknown as vscode.TextDocument);
  return document as unknown as vscode.TextDocument;
}
function active(filename: string) {
  const document = { uri: buildHost.file(filename) };
  window.activeTextEditor = { document } as vscode.TextEditor;
}
async function started(count = 1) {
  await vi.waitFor(() => expect(buildHost.executions).toHaveLength(count));
  return buildHost.executions[count - 1];
}
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }

describe('desktop build and launch', () => {
  let launcher: DendryBuildLauncher;
  let subscriptions: vscode.Disposable[];
  const adapters: DendryLaunchAdapter[] = [];
  beforeEach(() => {
    buildHost.reset();
    workspace.workspaceFolders = [project(alpha)];
    launcher = new DendryBuildLauncher();
    subscriptions = [];
  });
  afterEach(async () => {
    desktop.deactivate();
    for (const adapter of adapters.splice(0)) adapter.dispose();
    launcher.dispose();
    for (const subscription of subscriptions) subscription.dispose();
    await flush();
    expect(buildHost.processEnds.listeners.size).toBe(0);
    expect(buildHost.taskEnds.listeners.size).toBe(0);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('uses the CLI executable, local bin PATH and a managed terminal, opening HTML only after exit 0', async () => {
    const run = launcher.run();
    const execution = await started();
    const shell = execution.task.execution as vscode.ShellExecution;
    expect(shell.commandLine).toBe(process.platform === 'win32' ? 'dendrynexus.cmd make-html --pretty' : DEFAULT_BUILD_COMMAND);
    expect(shell.options?.cwd).toBe(alpha);
    const pathValue = Object.entries(shell.options!.env!).find(([key]) => key.toLowerCase() === 'path')![1]!;
    expect(pathValue.split(path.delimiter)[0]).toBe(path.join(alpha, 'node_modules', '.bin'));
    expect(execution.task.presentationOptions?.clear).toBe(true);
    expect(buildHost.opened).toEqual([]);
    buildHost.finish(execution, 0);
    await run;
    expect(buildHost.opened[0].fsPath).toBe(path.join(alpha, 'out', 'html', 'index.html'));
  });

  it('uses the active document folder and its resource-scoped settings in a multi-root workspace', async () => {
    workspace.workspaceFolders.push(project(beta));
    active(path.join(beta, 'source', 'chapter', 'intro.scene.dry'));
    buildHost.settings.set(alpha, { buildCommand: 'wrong build' });
    buildHost.settings.set(beta, { buildCommand: 'custom build' });
    const run = launcher.run();
    const execution = await started();
    expect((execution.task.execution as vscode.ShellExecution).commandLine).toBe('custom build');
    expect((execution.task.execution as vscode.ShellExecution).options?.cwd).toBe(beta);
    buildHost.finish(execution, 0);
    await run;
    expect(buildHost.opened[0].fsPath).toBe(path.join(beta, 'out', 'html', 'index.html'));
  });

  it('honors the launch folder ahead of an active editor in another project', async () => {
    const second = project(beta);
    workspace.workspaceFolders.push(second);
    active(path.join(alpha, 'source', 'root.scene.dry'));
    const run = launcher.run({}, second);
    const execution = await started();
    expect(execution.task.scope).toBe(second);
    expect((execution.task.execution as vscode.ShellExecution).options?.cwd).toBe(beta);
    buildHost.finish(execution, 0);
    await run;
  });

  it('prompts for the project when multiple folders have no active context', async () => {
    const second = project(beta);
    workspace.workspaceFolders.push(second);
    buildHost.pickedFolder = second;
    const pick = vi.spyOn(window, 'showWorkspaceFolderPick');
    const run = launcher.run();
    const execution = await started();
    expect(pick).toHaveBeenCalledOnce();
    expect(execution.task.scope).toBe(second);
    buildHost.finish(execution, 0);
    await run;
  });

  it('cancels cleanly when the folder picker is dismissed', async () => {
    workspace.workspaceFolders.push(project(beta));
    await expect(launcher.run()).rejects.toBeInstanceOf(BuildCancelled);
    expect(buildHost.executions).toEqual([]);
  });

  it('locates a nested upstream project from a file under source', async () => {
    project(beta);
    workspace.workspaceFolders = [buildHost.folder(base)];
    active(path.join(beta, 'source', 'chapters', 'one.scene.dry'));
    const run = launcher.run();
    const execution = await started();
    expect((execution.task.execution as vscode.ShellExecution).options?.cwd).toBe(beta);
    buildHost.finish(execution, 0);
    await run;
  });

  it('builds from the project parent when the workspace is the source directory', async () => {
    workspace.workspaceFolders = [buildHost.folder(path.join(alpha, 'source'))];
    const run = launcher.run();
    const execution = await started();
    expect((execution.task.execution as vscode.ShellExecution).options?.cwd).toBe(alpha);
    buildHost.finish(execution, 0);
    await run;
  });

  it('keeps a custom workspace-root layout usable without an upstream source marker', async () => {
    buildHost.files.delete(path.join(alpha, 'source', 'info.dry'));
    const run = launcher.run({ buildCommand: 'custom-build' });
    const execution = await started();
    expect((execution.task.execution as vscode.ShellExecution).options?.cwd).toBe(alpha);
    buildHost.finish(execution, 0);
    await run;
  });

  it('honors relative cwd, explicit settings and absolute output paths', async () => {
    const nested = path.join(alpha, 'nested project');
    project(nested);
    const output = path.join(base, 'build output', 'play game.html');
    buildHost.file(output);
    const run = launcher.run({ cwd: 'nested project', buildCommand: 'custom', outputPath: output });
    const execution = await started();
    expect((execution.task.execution as vscode.ShellExecution).options?.cwd).toBe(nested);
    buildHost.finish(execution, 0);
    await run;
    expect(buildHost.opened[0].fsPath).toBe(output);
  });

  it('selects the owning workspace for an absolute cwd', async () => {
    workspace.workspaceFolders.push(project(beta));
    active(path.join(alpha, 'source', 'root.scene.dry'));
    const run = launcher.run({ cwd: beta });
    const execution = await started();
    expect(execution.task.scope).toBe(workspace.workspaceFolders[1]);
    buildHost.finish(execution, 0);
    await run;
  });

  it('saves dirty project files before starting, leaving unrelated projects untouched', async () => {
    project(beta);
    const document = dirty(path.join(alpha, 'source', 'root.scene.dry'));
    const other = dirty(path.join(beta, 'source', 'root.scene.dry'));
    let release!: (value: boolean) => void;
    vi.mocked(document.save).mockImplementation(async () => {
      const saved = await new Promise<boolean>(resolve => { release = resolve; });
      Object.assign(document, { isDirty: false });
      return saved;
    });
    const run = launcher.run();
    await vi.waitFor(() => expect(document.save).toHaveBeenCalledOnce());
    expect(buildHost.executions).toEqual([]);
    release(true);
    const execution = await started();
    expect(other.save).not.toHaveBeenCalled();
    buildHost.finish(execution, 0);
    await run;
  });

  it('does not build or open stale output when saving fails', async () => {
    dirty(path.join(alpha, 'source', 'root.scene.dry'), false);
    await expect(launcher.run()).rejects.toThrow('Save cancelled or failed');
    expect(buildHost.executions).toEqual([]);
    expect(buildHost.opened).toEqual([]);
  });

  it('does not build if a document remains dirty after saving', async () => {
    const document = dirty(path.join(alpha, 'source', 'root.scene.dry'));
    vi.mocked(document.save).mockResolvedValue(true);
    await expect(launcher.run()).rejects.toThrow('changed while saving');
    expect(buildHost.executions).toEqual([]);
  });

  it('reports rejected saves without starting a task', async () => {
    const document = dirty(path.join(alpha, 'source', 'root.scene.dry'));
    vi.mocked(document.save).mockRejectedValue(new Error('Disk is read-only'));
    await expect(launcher.run()).rejects.toThrow('Disk is read-only');
    expect(buildHost.executions).toEqual([]);
  });

  it('passes quoted shell commands unchanged', async () => {
    const command = '"tools with spaces/build.cmd" "a  b" && echo "done"';
    const run = launcher.run({ buildCommand: command });
    const execution = await started();
    expect((execution.task.execution as vscode.ShellExecution).commandLine).toBe(command);
    buildHost.finish(execution, 0);
    await run;
  });

  it.runIf(process.platform === 'win32')('falls back to cmd.exe when ComSpec is absent', async () => {
    vi.stubEnv('ComSpec', undefined);
    const run = launcher.run();
    const execution = await started();
    const shell = execution.task.execution as vscode.ShellExecution;
    buildHost.finish(execution, 0);
    await run;
    expect(shell.options?.executable).toBe('cmd.exe');
  });

  it.each([0, 7])('executes quoted commands and && in the selected build shell after exit %s', async exitCode => {
    // docs is gitignored, so fresh checkouts need the fixture parent created first.
    mkdirSync(path.resolve('docs'), { recursive: true });
    const fixture = mkdtempSync(path.resolve('docs', 'build shell-'));
    try {
      const script = path.join(fixture, 'quoted script.cjs');
      writeFileSync(script, 'console.log(JSON.stringify(process.argv[2])); process.exit(Number(process.argv[3]));');
      const command = `"${process.execPath}" "${script}" "a  b" ${exitCode} && echo CHAIN_OK`;
      const run = launcher.run({ buildCommand: command });
      const outcome = run.then(() => undefined, error => error as Error);
      const execution = await started();
      const shell = execution.task.execution as vscode.ShellExecution;
      // Exercise the actual executable/arguments selected by the production launcher.
      // cmd /s /c needs the enclosing quotes that VS Code adds to its command line.
      expect(shell.options?.executable).toBe(process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : '/bin/sh');
      expect(shell.options?.shellArgs).toEqual(process.platform === 'win32' ? ['/d', '/s', '/c'] : ['-c']);
      const commandLine = process.platform === 'win32' ? `"${shell.commandLine}"` : shell.commandLine!;
      const result = spawnSync(shell.options!.executable!, [...shell.options!.shellArgs!, commandLine], {
        cwd: fixture, encoding: 'utf8', windowsVerbatimArguments: process.platform === 'win32', timeout: 5000,
      });
      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe('');
      expect(result.status).toBe(exitCode);
      expect(result.stdout).toContain('"a  b"');
      expect(result.stdout.includes('CHAIN_OK')).toBe(exitCode === 0);
      buildHost.finish(execution, result.status!);
      const error = await outcome;
      if (exitCode === 0) {
        expect(error).toBeUndefined();
        expect(buildHost.opened).toHaveLength(1);
      } else {
        expect(error?.message).toContain('code 7');
        expect(buildHost.opened).toEqual([]);
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it.each([1, 7, undefined])('rejects process exit %s without opening stale HTML', async code => {
    const run = launcher.run();
    const rejected = expect(run).rejects.toThrow('Build task exited');
    const execution = await started();
    buildHost.finish(execution, code);
    await rejected;
    expect(buildHost.opened).toEqual([]);
  });

  it('rejects tasks that end without a process result', async () => {
    const run = launcher.run();
    const rejected = expect(run).rejects.toThrow('without a successful process exit');
    buildHost.taskEnds.fire({ execution: await started() });
    await rejected;
    expect(buildHost.opened).toEqual([]);
  });

  it.each(['reject', 'throw'])('cleans up when task startup fails via %s', async failure => {
    const execute = vi.spyOn(tasks, 'executeTask');
    if (failure === 'throw') execute.mockImplementation(() => { throw new Error('No task shell'); });
    else execute.mockRejectedValue(new Error('No task shell'));
    await expect(launcher.run()).rejects.toThrow('No task shell');
    expect(buildHost.opened).toEqual([]);
  });

  it('buffers task exit events arriving before executeTask resolves', async () => {
    const original = tasks.executeTask.bind(tasks);
    vi.spyOn(tasks, 'executeTask').mockImplementation(async task => {
      const execution = await original(task);
      buildHost.finish(execution, 0);
      return execution;
    });
    await launcher.run();
    expect(buildHost.opened).toHaveLength(1);
  });

  it('ignores task events for other builds', async () => {
    const run = launcher.run();
    const execution = await started();
    buildHost.finish({ task: execution.task, terminate() {} }, 9);
    expect(buildHost.opened).toEqual([]);
    buildHost.finish(execution, 0);
    await run;
  });

  it('refuses missing HTML after a successful task', async () => {
    buildHost.files.delete(path.join(alpha, 'out', 'html', 'index.html'));
    const run = launcher.run();
    const rejected = expect(run).rejects.toThrow('HTML output was not found');
    buildHost.finish(await started(), 0);
    await rejected;
    expect(buildHost.opened).toEqual([]);
  });

  it('reports browser-open failures', async () => {
    vi.spyOn(env, 'openExternal').mockResolvedValue(false);
    const run = launcher.run();
    const rejected = expect(run).rejects.toThrow('Could not open HTML output');
    buildHost.finish(await started(), 0);
    await rejected;
  });

  it('rejects an output directory in place of an HTML file', async () => {
    const run = launcher.run({ outputPath: 'out/html' });
    const rejected = expect(run).rejects.toThrow('HTML output was not found');
    buildHost.finish(await started(), 0);
    await rejected;
    expect(buildHost.opened).toEqual([]);
  });

  it('does no work for an already cancelled request', async () => {
    const cancellation = new CancellationTokenSource();
    cancellation.cancel();
    const stat = vi.spyOn(workspace.fs, 'stat');
    await expect(launcher.run({}, undefined, cancellation.token)).rejects.toBeInstanceOf(BuildCancelled);
    expect(stat).not.toHaveBeenCalled();
    expect(buildHost.executions).toEqual([]);
  });

  it('does not open HTML after cancellation while verifying the output', async () => {
    const cancellation = new CancellationTokenSource();
    const original = workspace.fs.stat.bind(workspace.fs);
    vi.spyOn(workspace.fs, 'stat').mockImplementation(async uri => {
      const result = await original(uri);
      if (uri.fsPath.endsWith('index.html')) cancellation.cancel();
      return result;
    });
    const run = launcher.run({}, undefined, cancellation.token);
    const rejected = expect(run).rejects.toBeInstanceOf(BuildCancelled);
    buildHost.finish(await started(), 0);
    await rejected;
    expect(buildHost.opened).toEqual([]);
  });

  it('cancels the task without opening HTML or retaining listeners', async () => {
    const cancellation = new CancellationTokenSource();
    const run = launcher.run({}, undefined, cancellation.token);
    const rejected = expect(run).rejects.toBeInstanceOf(BuildCancelled);
    const execution = await started();
    cancellation.cancel();
    await rejected;
    expect(execution.terminated).toBe(true);
    expect(buildHost.opened).toEqual([]);
  });

  it('terminates a task returned after its launch was cancelled', async () => {
    const original = tasks.executeTask.bind(tasks);
    let release!: () => void;
    vi.spyOn(tasks, 'executeTask').mockImplementation(async task => {
      const execution = await original(task);
      await new Promise<void>(resolve => { release = resolve; });
      return execution;
    });
    const cancellation = new CancellationTokenSource();
    const run = launcher.run({}, undefined, cancellation.token);
    const rejected = expect(run).rejects.toBeInstanceOf(BuildCancelled);
    const execution = await started();
    cancellation.cancel();
    await rejected;
    release();
    await flush();
    expect(execution.terminated).toBe(true);
    expect(buildHost.opened).toEqual([]);
  });

  it('does not start a task after cancellation during saves', async () => {
    const document = dirty(path.join(alpha, 'source', 'root.scene.dry'));
    const cancellation = new CancellationTokenSource();
    vi.mocked(document.save).mockImplementation(async () => { cancellation.cancel(); return true; });
    await expect(launcher.run({}, undefined, cancellation.token)).rejects.toBeInstanceOf(BuildCancelled);
    expect(buildHost.executions).toEqual([]);
  });

  it('prevents duplicate builds without releasing the original project lock', async () => {
    const run = launcher.run();
    const execution = await started();
    await expect(launcher.run()).rejects.toThrow('already running');
    await expect(launcher.run()).rejects.toThrow('already running');
    buildHost.finish(execution, 0);
    await run;
    const next = launcher.run();
    buildHost.finish(await started(2), 0);
    await next;
  });

  it('permits a retry after a failed build', async () => {
    const first = launcher.run();
    const rejected = expect(first).rejects.toThrow('code 1');
    buildHost.finish(await started(), 1);
    await rejected;
    const retry = launcher.run();
    buildHost.finish(await started(2), 0);
    await retry;
    expect(buildHost.opened).toHaveLength(1);
  });

  it('allows independent projects to build concurrently', async () => {
    const second = project(beta);
    workspace.workspaceFolders.push(second);
    const first = launcher.run({}, workspace.workspaceFolders[0]);
    const other = launcher.run({}, second);
    await started(2);
    for (const execution of buildHost.executions) buildHost.finish(execution, 0);
    await Promise.all([first, other]);
    expect(buildHost.opened).toHaveLength(2);
  });

  it('cancels in-flight tasks on disposal and rejects further work', async () => {
    const run = launcher.run();
    const rejected = expect(run).rejects.toBeInstanceOf(BuildCancelled);
    const execution = await started();
    launcher.dispose();
    await rejected;
    expect(execution.terminated).toBe(true);
    await expect(launcher.run()).rejects.toBeInstanceOf(BuildCancelled);
    expect(buildHost.opened).toEqual([]);
  });

  it.each(['cwd', 'buildCommand', 'outputPath'])('rejects an empty explicit %s', async key => {
    await expect(launcher.run({ [key]: '  ' })).rejects.toThrow('nonempty');
    expect(buildHost.executions).toEqual([]);
  });

  it('reports unavailable workspace, virtual folder and invalid cwd before running tasks', async () => {
    workspace.workspaceFolders = [];
    await expect(launcher.run()).rejects.toThrow('Open a Dendry project folder');
    workspace.workspaceFolders = [{ ...buildHost.folder(alpha), uri: Uri.file(alpha).with({ scheme: 'vscode-vfs' }) }];
    await expect(launcher.run()).rejects.toThrow('filesystem project folder');
    workspace.workspaceFolders = [buildHost.folder(alpha)];
    await expect(launcher.run({ cwd: 'missing' })).rejects.toThrow('does not exist');
    await expect(launcher.run({ cwd: path.join(alpha, 'source', 'info.dry') })).rejects.toThrow('not a directory');
    expect(buildHost.executions).toEqual([]);
  });

  function adapter() {
    const result = new DendryLaunchAdapter(launcher, workspace.workspaceFolders[0]);
    adapters.push(result);
    const messages: Record<string, unknown>[] = [];
    result.onDidSendMessage(message => messages.push(message));
    return { adapter: result, messages, send: (command: string, seq: number, args?: unknown) =>
      result.handleMessage({ type: 'request', seq, command, arguments: args }) };
  }

  it('implements initialize, launch success and termination through the real adapter', async () => {
    const { send, messages } = adapter();
    send('initialize', 1);
    expect(messages[0]).toMatchObject({ type: 'response', request_seq: 1, success: true });
    expect(messages[1]).toMatchObject({ type: 'event', event: 'initialized' });
    send('setExceptionBreakpoints', 2);
    send('launch', 3);
    buildHost.finish(await started(), 0);
    await flush();
    expect(messages).toContainEqual(expect.objectContaining({ command: 'launch', request_seq: 3, success: true }));
    expect(messages.filter(message => message.event === 'terminated')).toHaveLength(1);
    expect(messages.map(message => message.seq)).toEqual(messages.map((_, i) => i + 1));
    send('disconnect', 4);
    expect(messages[messages.length - 1]).toMatchObject({ command: 'disconnect', request_seq: 4, success: true });
  });

  it('reports failed launches through DAP and terminates once', async () => {
    const { send, messages } = adapter();
    send('launch', 1);
    buildHost.finish(await started(), 8);
    await flush();
    expect(messages).toContainEqual(expect.objectContaining({ command: 'launch', success: false, message: expect.stringContaining('code 8') }));
    expect(messages.filter(message => message.event === 'terminated')).toHaveLength(1);
    expect(buildHost.opened).toEqual([]);
  });

  it.each(['disconnect', 'terminate'])('cancels a DAP launch via %s', async command => {
    const { send, messages } = adapter();
    send('launch', 1);
    const execution = await started();
    send(command, 2);
    await flush();
    expect(execution.terminated).toBe(true);
    expect(messages).toContainEqual(expect.objectContaining({ command, request_seq: 2, success: true }));
    expect(messages).toContainEqual(expect.objectContaining({ command: 'launch', request_seq: 1, success: false }));
    expect(messages.filter(message => message.event === 'terminated')).toHaveLength(1);
    expect(buildHost.opened).toEqual([]);
  });

  it('refuses breakpoint requests and duplicate launches without duplicating the build', async () => {
    const { send, messages } = adapter();
    send('setBreakpoints', 1);
    expect(messages[0]).toMatchObject({ success: false, message: expect.stringContaining('breakpoints') });
    send('launch', 2);
    const execution = await started();
    send('launch', 3);
    expect(messages).toContainEqual(expect.objectContaining({ request_seq: 3, success: false }));
    buildHost.finish(execution, 0);
    await flush();
    expect(buildHost.executions).toHaveLength(1);
  });

  it('fills launch defaults without reading unscoped settings or losing explicit overrides', () => {
    const provider = new DendryDebugConfigurationProvider();
    expect(provider.resolveDebugConfiguration(undefined, {} as vscode.DebugConfiguration)).toEqual({
      type: 'dendry', request: 'launch', name: 'Build and Launch Dendry',
    });
    const config = { type: 'dendry', request: 'launch', name: 'Custom', cwd: beta, buildCommand: 'custom' };
    expect(provider.resolveDebugConfiguration(undefined, config)).toEqual(config);
    expect(provider.resolveDebugConfiguration(undefined, { ...config, request: 'attach' })).toBeNull();
  });

  it('registers a usable inline adapter from the desktop entry point', async () => {
    desktop.activate({ subscriptions } as vscode.ExtensionContext);
    expect(buildHost.provider).toBeDefined();
    const descriptor = buildHost.factory!.createDebugAdapterDescriptor({ workspaceFolder: workspace.workspaceFolders[0] } as vscode.DebugSession,
      undefined as unknown as vscode.DebugAdapterExecutable) as DebugAdapterInlineImplementation;
    expect(descriptor).toBeInstanceOf(DebugAdapterInlineImplementation);
    const messages: Record<string, unknown>[] = [];
    descriptor.implementation.onDidSendMessage(message => messages.push(message as Record<string, unknown>));
    descriptor.implementation.handleMessage({ type: 'request', seq: 1, command: 'launch', arguments: {} });
    buildHost.finish(await started(), 0);
    await flush();
    expect(messages).toContainEqual(expect.objectContaining({ command: 'launch', success: true }));
    descriptor.implementation.dispose();
  });

  it('runs the desktop command and disposes in-flight builds on deactivation', async () => {
    desktop.activate({ subscriptions } as vscode.ExtensionContext);
    const command = buildHost.commands.get('dendry.debug')!();
    const execution = await started();
    desktop.deactivate();
    await command;
    expect(execution.terminated).toBe(true);
    expect(buildHost.errors).toEqual([]);
    expect(buildHost.opened).toEqual([]);
  });

  it('reports command failures without opening stale output', async () => {
    desktop.activate({ subscriptions } as vscode.ExtensionContext);
    const command = buildHost.commands.get('dendry.debug')!();
    buildHost.finish(await started(), 2);
    await command;
    expect(buildHost.errors[0]).toContain('code 2');
    expect(buildHost.opened).toEqual([]);
  });

  it('runs the desktop command once and opens the successful output', async () => {
    desktop.activate({ subscriptions } as vscode.ExtensionContext);
    const command = buildHost.commands.get('dendry.debug')!();
    buildHost.finish(await started(), 0);
    await command;
    expect(buildHost.executions).toHaveLength(1);
    expect(buildHost.opened).toHaveLength(1);
    expect(buildHost.errors).toEqual([]);
  });

  it('gives a clear web-only limitation for both command and launch configurations', async () => {
    web.activate({ subscriptions } as vscode.ExtensionContext);
    await buildHost.commands.get('dendry.debug')!();
    expect(buildHost.provider!.resolveDebugConfiguration!(undefined, {} as vscode.DebugConfiguration, {} as vscode.CancellationToken)).toBeNull();
    expect(buildHost.warnings).toHaveLength(2);
    expect(buildHost.factory).toBeUndefined();
    expect(buildHost.executions).toEqual([]);
  });

  it('contributes launch schema/defaults and does not advertise breakpoints', () => {
    const manifest = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8'));
    expect(manifest.contributes.breakpoints).toBeUndefined();
    expect(manifest.activationEvents).toContain('onDebugResolve:dendry');
    expect(manifest.contributes.debuggers[0].configurationAttributes.launch.properties).toHaveProperty('cwd');
    expect(manifest.contributes.configuration.properties['dendry.debug.buildCommand']).toMatchObject({
      default: DEFAULT_BUILD_COMMAND, scope: 'resource',
    });
    expect(manifest.contributes.configuration.properties['dendry.debug.outputPath'].scope).toBe('resource');
  });
});
