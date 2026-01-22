"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const project_validator_1 = require("./project-validator");
let diagnosticCollection;
let projectValidator;
let lastDiagnostics = new Map();
let isValidating = false;
let openSuppressCount = 0;
// Debounce function
function debounce(func, delay) {
    let timeout;
    return function (...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}
const outputChannel = vscode.window.createOutputChannel('Dendry');
outputChannel.appendLine('Dendry activated');
function activate(context) {
    console.log('Dendry type checker is now active');
    outputChannel.appendLine('Dendry type checker is now active');
    diagnosticCollection = vscode.languages.createDiagnosticCollection('dendry');
    context.subscriptions.push(diagnosticCollection);
    projectValidator = new project_validator_1.DendryProjectValidator();
    const debouncedValidateProject = debounce(validateProject, 500);
    // Initial validation (delayed for workspace ready)
    if (vscode.workspace.workspaceFolders?.length) {
        outputChannel.appendLine(`Workspace ready: ${vscode.workspace.workspaceFolders.length} folders`);
        setTimeout(() => {
            outputChannel.appendLine('--- Initial full validation ---');
            debouncedValidateProject();
        }, 1000);
    }
    else {
        outputChannel.appendLine('No workspace - waiting...');
    }
    // Existing triggers
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.languageId === 'dendry') {
            outputChannel.appendLine(`Change: ${event.document.uri.fsPath}`);
            debouncedValidateProject(event.document.uri);
        }
    }));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
        if (document.languageId === 'dendry') {
            outputChannel.appendLine(`Save: ${document.uri.fsPath}`);
            debouncedValidateProject(document.uri);
        }
    }));
    context.subscriptions.push(vscode.workspace.onDidDeleteFiles(event => {
        if (event.files.some(file => file.path.endsWith('.scene.dry'))) {
            outputChannel.appendLine('Delete detected');
            debouncedValidateProject();
        }
    }));
    // Open trigger
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => {
        if (openSuppressCount > 0) {
            outputChannel.appendLine(`Open suppressed: ${document.uri.fsPath}. Count at ${openSuppressCount}.`);
            return;
        }
        if (document.languageId === 'dendry') {
            outputChannel.appendLine(`Open: ${document.uri.fsPath}`);
            debouncedValidateProject(document.uri);
        }
    }));
    // Workspace folder changes (add/remove folders)
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
        outputChannel.appendLine('Workspace folders changed');
        debouncedValidateProject();
    }));
    // Clear on close (existing)
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => {
        diagnosticCollection.delete(document.uri);
        lastDiagnostics.delete(document.uri);
    }));
}
async function validateProject(changedFileUri) {
    outputChannel.appendLine(`validateProject(${changedFileUri?.fsPath || 'full'})`);
    if (isValidating) {
        outputChannel.appendLine('Skipped: already validating');
        return;
    }
    const config = vscode.workspace.getConfiguration('dendry');
    if (!config.get('validation.enable', true)) {
        outputChannel.appendLine('Skipped: validation disabled');
        return;
    }
    isValidating = true;
    openSuppressCount++;
    try {
        const dendryFiles = await vscode.workspace.findFiles('**/*.scene.dry');
        outputChannel.appendLine(`Found ${dendryFiles.length} .scene.dry files`);
        const currentDiagnostics = await projectValidator.validateProject(dendryFiles, changedFileUri);
        // Stable key: sort diags by position + msg/severity (ignores order)
        function stableDiagKey(diags) {
            return JSON.stringify(diags.map(d => ({
                start: d.range.start.line * 10000 + d.range.start.character,
                end: d.range.end.line * 10000 + d.range.end.character,
                msg: d.message,
                sev: d.severity
            })).sort((a, b) => a.start - b.start ||
                a.end - b.end ||
                a.msg.localeCompare(b.msg) ||
                (a.sev || 0) - (b.sev || 0)));
        }
        const urisWithNewDiagnostics = new Set();
        currentDiagnostics.forEach((newDiags, uri) => {
            urisWithNewDiagnostics.add(uri);
            const oldDiags = lastDiagnostics.get(uri) || [];
            if (stableDiagKey(newDiags) !== stableDiagKey(oldDiags)) {
                diagnosticCollection.set(uri, newDiags);
                lastDiagnostics.set(uri, newDiags);
                outputChannel.appendLine(`Updated: ${uri.fsPath} (${newDiags.length} diags)`);
            }
        });
        // Clear missing/deleted
        const urisToDelete = [];
        lastDiagnostics.forEach((diags, uri) => {
            if (!urisWithNewDiagnostics.has(uri)) {
                urisToDelete.push(uri);
            }
        });
        urisToDelete.forEach(uri => {
            diagnosticCollection.delete(uri);
            lastDiagnostics.delete(uri);
            outputChannel.appendLine(`Cleared: ${uri.fsPath}`);
        });
        outputChannel.appendLine(`Updated ${urisWithNewDiagnostics.size} / cleared ${urisToDelete.length}`);
    }
    catch (error) {
        outputChannel.appendLine(`ERROR: ${error}`);
        vscode.window.showErrorMessage(`Dendry validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    finally {
        isValidating = false;
        openSuppressCount--;
        if (openSuppressCount < 0)
            openSuppressCount = 0;
    }
}
function deactivate() {
    if (diagnosticCollection) {
        diagnosticCollection.dispose();
    }
}
//# sourceMappingURL=extension.js.map