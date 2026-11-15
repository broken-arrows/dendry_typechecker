import * as vscode from 'vscode';
import { BuildCancelled, BuildConfiguration, DendryBuildLauncher } from './build-launch';

export class DendryDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  provideDebugConfigurations(): vscode.DebugConfiguration[] {
    return [{ type: 'dendry', request: 'launch', name: 'Build and Launch Dendry' }];
  }

  resolveDebugConfiguration(_folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration): vscode.DebugConfiguration | null {
    if (config.request && config.request !== 'launch') {
      void vscode.window.showErrorMessage('Dendry supports build-and-launch configurations only.');
      return null;
    }
    // Leave settings absent here: the launcher reads them for the selected project.
    return { ...config, type: 'dendry', request: 'launch', name: config.name || 'Build and Launch Dendry' };
  }
}

interface ProtocolMessage extends vscode.DebugProtocolMessage {
  seq: number;
  type: string;
  [key: string]: unknown;
}
interface Request extends ProtocolMessage {
  type: 'request';
  command: string;
  arguments?: BuildConfiguration;
}

/** A launch-only DAP adapter. No game runtime, threads or breakpoint support. */
export class DendryLaunchAdapter implements vscode.DebugAdapter {
  private readonly messages = new vscode.EventEmitter<ProtocolMessage>();
  readonly onDidSendMessage = this.messages.event;
  private readonly cancellation = new vscode.CancellationTokenSource();
  private seq = 1;
  private ended = false;
  private disposed = false;
  private launched = false;
  private pendingLaunch?: Request;

  constructor(private readonly launcher: DendryBuildLauncher, private readonly folder?: vscode.WorkspaceFolder) {}

  handleMessage(message: vscode.DebugProtocolMessage): void {
    if ((message as ProtocolMessage).type !== 'request' || this.disposed) return;
    const request = message as Request;
    // VS Code also sends disconnect after a normal terminated event.
    if (request.command === 'disconnect' || request.command === 'terminate') {
      if (this.pendingLaunch) {
        this.respond(this.pendingLaunch, false, undefined, 'Dendry build cancelled.');
        this.pendingLaunch = undefined;
      }
      this.cancellation.cancel();
      this.respond(request, true);
      this.end();
      return;
    }
    if (this.ended) { this.respond(request, false, undefined, 'The build-and-launch session has ended.'); return; }
    switch (request.command) {
      case 'initialize':
        this.respond(request, true, { supportsConfigurationDoneRequest: false, supportsTerminateRequest: true });
        this.emit({ type: 'event', event: 'initialized' });
        break;
      case 'launch':
        if (this.launched) { this.respond(request, false, undefined, 'A launch is already in progress.'); break; }
        this.launched = true;
        this.pendingLaunch = request;
        void this.launch(request);
        break;
      case 'setExceptionBreakpoints':
      case 'configurationDone':
        this.respond(request, true);
        break;
      case 'threads':
        this.respond(request, true, { threads: [] });
        break;
      default:
        this.respond(request, false, undefined, 'Dendry Build and Launch does not support runtime debugging or breakpoints.');
    }
  }

  private async launch(request: Request): Promise<void> {
    try {
      await this.launcher.run(request.arguments, this.folder, this.cancellation.token);
      if (!this.ended) this.respond(request, true);
    } catch (error) {
      if (!this.ended) this.respond(request, false, undefined, error instanceof Error ? error.message : String(error));
    } finally { this.pendingLaunch = undefined; this.end(); }
  }

  private respond(request: Request, success: boolean, body?: unknown, message?: string): void {
    this.emit({ type: 'response', request_seq: request.seq, command: request.command, success, body, message });
  }
  private emit(message: Record<string, unknown>): void {
    this.messages.fire({ ...message, seq: this.seq++ } as ProtocolMessage);
  }
  private end(): void {
    if (!this.ended) {
      this.ended = true;
      this.emit({ type: 'event', event: 'terminated' });
    }
  }
  dispose(): void {
    this.disposed = true;
    this.ended = true;
    this.pendingLaunch = undefined;
    this.cancellation.cancel();
    this.cancellation.dispose();
    this.messages.dispose();
  }
}

export function registerDesktopBuild(context: vscode.ExtensionContext): vscode.Disposable {
  const launcher = new DendryBuildLauncher();
  const adapters = new Set<DendryLaunchAdapter>();
  const lifecycle = {
    dispose: () => {
      for (const adapter of adapters) adapter.dispose();
      adapters.clear();
      launcher.dispose();
    },
  };
  context.subscriptions.push(
    lifecycle,
    vscode.debug.registerDebugConfigurationProvider('dendry', new DendryDebugConfigurationProvider()),
    vscode.debug.registerDebugAdapterDescriptorFactory('dendry', {
      createDebugAdapterDescriptor(session) {
        const adapter = new DendryLaunchAdapter(launcher, session.workspaceFolder);
        adapters.add(adapter);
        adapter.onDidSendMessage(message => {
          if (message.type === 'event' && message.event === 'terminated') adapters.delete(adapter);
        });
        return new vscode.DebugAdapterInlineImplementation(adapter);
      },
    }),
    vscode.commands.registerCommand('dendry.debug', async () => {
      try { await launcher.run(); }
      catch (error) {
        if (!(error instanceof BuildCancelled)) {
          await vscode.window.showErrorMessage(`Dendry build failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }),
  );
  return lifecycle;
}
