import * as vscode from 'vscode';
import { DendryProjectValidator } from './project-validator';

let diagnosticCollection: vscode.DiagnosticCollection;
let projectValidator: DendryProjectValidator;
let lastDiagnostics: Map<vscode.Uri, vscode.Diagnostic[]> = new Map();
let isValidating = false;
let openSuppressCount = 0;

// Debounce function
function debounce<F extends (...args: any[]) => any>(func: F, delay: number): (this: ThisParameterType<F>, ...args: Parameters<F>) => void {
    let timeout: NodeJS.Timeout | undefined;
    return function(this: ThisParameterType<F>, ...args: Parameters<F>) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}

const outputChannel = vscode.window.createOutputChannel('Dendry');
outputChannel.appendLine('Dendry activated');

export function activate(context: vscode.ExtensionContext) {
    console.log('Dendry type checker is now active');
    outputChannel.appendLine('Dendry type checker is now active');

    diagnosticCollection = vscode.languages.createDiagnosticCollection('dendry');
    context.subscriptions.push(diagnosticCollection);

    projectValidator = new DendryProjectValidator();

    const debouncedValidateProject = debounce(validateProject, 500);

    // Initial validation (delayed for workspace ready)
    if (vscode.workspace.workspaceFolders?.length) {
        outputChannel.appendLine(`Workspace ready: ${vscode.workspace.workspaceFolders.length} folders`);
        setTimeout(() => {
            outputChannel.appendLine('--- Initial full validation ---');
            debouncedValidateProject();
        }, 1000);
    } else {
        outputChannel.appendLine('No workspace - waiting...');
    }

    // Existing triggers
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.languageId === 'dendry') {
                outputChannel.appendLine(`Change: ${event.document.uri.fsPath}`);
                debouncedValidateProject(event.document.uri);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(document => {
            if (document.languageId === 'dendry') {
                outputChannel.appendLine(`Save: ${document.uri.fsPath}`);
                debouncedValidateProject(document.uri);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidDeleteFiles(event => {
            if (event.files.some(file => file.path.endsWith('.scene.dry') || file.path.endsWith('.qdisplay.dry'))) {
                outputChannel.appendLine('Delete detected');
                debouncedValidateProject();
            }
        })
    );

    // Open trigger
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(document => {
            if (openSuppressCount > 0) {
                outputChannel.appendLine(`Open suppressed: ${document.uri.fsPath}. Count at ${openSuppressCount}.`);
                return;
            }
            if (document.languageId === 'dendry') {
                outputChannel.appendLine(`Open: ${document.uri.fsPath}`);
                debouncedValidateProject(document.uri);
            }
        })
    );

    // Workspace folder changes (add/remove folders)
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            outputChannel.appendLine('Workspace folders changed');
            debouncedValidateProject();
        })
    );

    // Clear on close (existing)
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(document => {
            diagnosticCollection.delete(document.uri);
            lastDiagnostics.delete(document.uri);
        })
    );
}


async function validateProject(changedFileUri?: vscode.Uri) {
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
        // Get exclude patterns from configuration
        const excludePatterns = config.get<string[]>('validation.exclude', [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/build/**',
            '**/out/**'
        ]);

        // Build exclude pattern string
        const excludePattern = excludePatterns.length > 1 
            ? `{${excludePatterns.join(',')}}` 
            : excludePatterns[0] || undefined;

        const sceneFilesPromise = vscode.workspace.findFiles(
            '**/*.scene.dry',
            excludePattern
        );
        const qdisplayFilesPromise = vscode.workspace.findFiles(
            '**/*.qdisplay.dry',
            excludePattern
        );

        const [sceneFiles, qdisplayFiles] = await Promise.all([sceneFilesPromise, qdisplayFilesPromise]);
        const dendryFiles = [...sceneFiles, ...qdisplayFiles];
        
        outputChannel.appendLine(`Found ${dendryFiles.length} Dendry files (${sceneFiles.length} scenes, ${qdisplayFiles.length} qdisplays)`);

        const currentDiagnostics = await projectValidator.validateProject(dendryFiles, changedFileUri);

        // Stable key: sort diags by position + msg/severity (ignores order)
        function stableDiagKey(diags: vscode.Diagnostic[]): string {
            return JSON.stringify(
                diags.map(d => ({
                    start: d.range.start.line * 10000 + d.range.start.character,
                    end: d.range.end.line * 10000 + d.range.end.character,
                    msg: d.message,
                    sev: d.severity
                })).sort((a, b) =>
                    a.start - b.start ||
                    a.end - b.end ||
                    a.msg.localeCompare(b.msg) ||
                    (a.sev || 0) - (b.sev || 0)
                )
            );
        }

        const urisWithNewDiagnostics = new Set<vscode.Uri>();
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
        const urisToDelete: vscode.Uri[] = [];
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
    } catch (error) {
        outputChannel.appendLine(`ERROR: ${error}`);
        vscode.window.showErrorMessage(`Dendry validation failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        isValidating = false;
        openSuppressCount--;
        if (openSuppressCount < 0) openSuppressCount = 0;
    }
}


export function deactivate() {
    if (diagnosticCollection) {
        diagnosticCollection.dispose();
    }
}
