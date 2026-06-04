import * as vscode from 'vscode';
import { activateCore, deactivateCore } from './activate-core';
import { DendryDebugConfigurationProvider, runDendryDebug } from './debug-adapter';

/**
 * Desktop (Node.js host) entry point. Wires up the shared validation core and
 * then registers the desktop-only F5 build-and-launch feature, which depends on
 * `child_process` (via `debug-adapter.ts`) and therefore cannot run on the web.
 */
export function activate(context: vscode.ExtensionContext) {
    activateCore(context);

    // Register debug configuration provider (F5 support)
    const debugConfigProvider = new DendryDebugConfigurationProvider();
    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider('dendry', debugConfigProvider)
    );

    // Register command to build and launch
    context.subscriptions.push(
        vscode.commands.registerCommand('dendry.debug', async () => {
            const config = vscode.workspace.getConfiguration('dendry.debug');
            const buildCommand = config.get<string>('buildCommand', 'npm run dendrynexus make-html -- --pretty');
            const outputPath = config.get<string>('outputPath', 'out/html/index.html');

            await runDendryDebug({ buildCommand, outputPath });
        })
    );

    // Handle F5 debug launches
    context.subscriptions.push(
        vscode.debug.onDidStartDebugSession(async (session) => {
            if (session.type === 'dendry') {
                // Stop the debug session immediately since we don't need a real debugger
                vscode.debug.stopDebugging(session);

                // Run our build and launch
                await runDendryDebug({
                    buildCommand: session.configuration.buildCommand,
                    outputPath: session.configuration.outputPath
                });
            }
        })
    );
}


export function deactivate() {
    deactivateCore();
}
