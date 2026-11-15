import * as vscode from 'vscode';
import { activateCore, deactivateCore } from './activate-core';
import { registerDesktopBuild } from './debug-adapter';

let buildFeature: vscode.Disposable | undefined;

/**
 * Desktop (Node.js host) entry point. Wires up the shared validation core and
 * then registers the desktop-only F5 build-and-launch feature, which depends on
 * desktop task execution and therefore cannot run in the web editor.
 */
export function activate(context: vscode.ExtensionContext) {
    activateCore(context);

    buildFeature = registerDesktopBuild(context);
}


export function deactivate() {
    buildFeature?.dispose();
    buildFeature = undefined;
    deactivateCore();
}
