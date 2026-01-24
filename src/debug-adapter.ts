import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';

export class DendryDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
    token?: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    
    // If launch.json is missing or empty
    if (!config.type && !config.request && !config.name) {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === 'dendry') {
        config.type = 'dendry';
        config.name = 'Launch Dendry';
        config.request = 'launch';
      }
    }

    if (!config.buildCommand) {
      const settings = vscode.workspace.getConfiguration('dendry.debug');
      config.buildCommand = settings.get('buildCommand', 'npm run dendrynexus make-html -- --pretty');
    }

    if (!config.outputPath) {
      const settings = vscode.workspace.getConfiguration('dendry.debug');
      config.outputPath = settings.get('outputPath', 'out/html/index.html');
    }

    return config;
  }
}

export async function runDendryDebug(config?: { buildCommand?: string; outputPath?: string }): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }

  const settings = vscode.workspace.getConfiguration('dendry.debug');
  const buildCommand = config?.buildCommand || settings.get('buildCommand', 'npm run dendrynexus make-html -- --pretty');
  const outputPath = config?.outputPath || settings.get('outputPath', 'out/html/index.html');

  // Show output channel
  const outputChannel = vscode.window.createOutputChannel('Dendry Build');
  outputChannel.show();
  outputChannel.appendLine(`Building Dendry project...`);
  outputChannel.appendLine(`Command: ${buildCommand}`);
  outputChannel.appendLine(`Working directory: ${workspaceFolder.uri.fsPath}`);
  outputChannel.appendLine('');

  try {
    await runBuildCommand(buildCommand, workspaceFolder.uri.fsPath, outputChannel);
    
    // Build successful, open the HTML file
    const htmlPath = path.join(workspaceFolder.uri.fsPath, outputPath);
    const uri = vscode.Uri.file(htmlPath);
    
    outputChannel.appendLine('');
    outputChannel.appendLine(`Build successful! Opening ${htmlPath}`);
    
    // Open in default browser
    await vscode.env.openExternal(uri);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine('');
    outputChannel.appendLine(`Build failed: ${errorMessage}`);
    vscode.window.showErrorMessage(`Dendry build failed: ${errorMessage}`);
  }
}

function runBuildCommand(command: string, cwd: string, outputChannel: vscode.OutputChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    // Parse command into executable and args
    const parts = command.split(' ');
    const executable = parts[0];
    const args = parts.slice(1);

    const process = spawn(executable, args, {
      cwd,
      shell: true
    });

    process.stdout.on('data', (data) => {
      outputChannel.append(data.toString().replace(/\x1b\[[0-9;]*m/g, ''));
    });

    process.stderr.on('data', (data) => {
      outputChannel.append(data.toString().replace(/\x1b\[[0-9;]*m/g, ''));
    });

    process.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Build process exited with code ${code}`));
      }
    });

    process.on('error', (error) => {
      reject(error);
    });
  });
}
