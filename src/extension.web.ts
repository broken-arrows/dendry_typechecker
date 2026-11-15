import * as vscode from 'vscode';
import { activateCore, deactivateCore } from './activate-core';

/**
 * Web (browser Web Worker host) entry point for github.dev / vscode.dev.
 *
 * It wires up the same validation core as the desktop build, but does NOT
 * import the desktop build modules, which use Node paths and task execution.
 * Keeping them out of this entry's import
 * graph is what lets the web bundle build at all.
 *
 * The F5 build-and-launch command is registered here only as a stub that fails
 * loudly, since a real build needs a local Node.js toolchain.
 */
export function activate(context: vscode.ExtensionContext) {
    activateCore(context);

    const unavailable = () => {
        void vscode.window.showWarningMessage(
            'Dendry: Build and Launch (F5) is only available in desktop VS Code, not the web editor.'
        );
    };
    context.subscriptions.push(
        vscode.commands.registerCommand('dendry.debug', unavailable),
        vscode.debug.registerDebugConfigurationProvider('dendry', {
            resolveDebugConfiguration() { unavailable(); return null; }
        })
    );
}


export function deactivate() {
    deactivateCore();
}
