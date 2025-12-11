import * as vscode from 'vscode';
import { DendryProjectValidator } from './project-validator';

let diagnosticCollection: vscode.DiagnosticCollection;
let projectValidator: DendryProjectValidator;
let lastDiagnostics: Map<vscode.Uri, vscode.Diagnostic[]> = new Map();

// Debounce function
function debounce<F extends (...args: any[]) => any>(func: F, delay: number): (this: ThisParameterType<F>, ...args: Parameters<F>) => void {
    let timeout: NodeJS.Timeout | undefined;
    return function(this: ThisParameterType<F>, ...args: Parameters<F>) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Dendry type checker is now active');

    diagnosticCollection = vscode.languages.createDiagnosticCollection('dendry');
    context.subscriptions.push(diagnosticCollection);

    projectValidator = new DendryProjectValidator();

    const debouncedValidateProject = debounce(validateProject, 500);

    // Initial validation
    debouncedValidateProject();

    // Validate on change
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.languageId === 'dendry') {
                debouncedValidateProject(event.document.uri);
            }
        })
    );

    // Validate on open
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(document => {
            if (document.languageId === 'dendry') {
                debouncedValidateProject(document.uri);
            }
        })
    );

    // Re-validate on save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(document => {
            if (document.languageId === 'dendry') {
                debouncedValidateProject(document.uri);
            }
        })
    );

    // Re-validate on delete
    context.subscriptions.push(
        vscode.workspace.onDidDeleteFiles(event => {
            if (event.files.some(file => file.path.endsWith('.scene.dry'))) {
                debouncedValidateProject();
            }
        })
    );

    // Clear diagnostics on close
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(document => {
            diagnosticCollection.delete(document.uri);
            lastDiagnostics.delete(document.uri); // Also remove from our cache
        })
    );
}

async function validateProject(changedFileUri?: vscode.Uri) {
    const config = vscode.workspace.getConfiguration('dendry');
    if (!config.get('validation.enable', true)) {
        return;
    }

    const dendryFiles = await vscode.workspace.findFiles('**/*.scene.dry');

    try {
        const currentDiagnostics = await projectValidator.validateProject(dendryFiles, changedFileUri);
        const urisWithNewDiagnostics = new Set<vscode.Uri>();

        currentDiagnostics.forEach((newDiags, uri) => {
            urisWithNewDiagnostics.add(uri);
            const oldDiags = lastDiagnostics.get(uri) || [];

            // Simple comparison: check if stringified diagnostics are different
            // A more robust comparison would compare each diagnostic property
            if (JSON.stringify(newDiags) !== JSON.stringify(oldDiags)) {
                diagnosticCollection.set(uri, newDiags);
                lastDiagnostics.set(uri, newDiags);
            }
        });

        // Clear diagnostics for files that no longer have issues or were deleted
        const urisToDelete: vscode.Uri[] = [];
        lastDiagnostics.forEach((diags, uri) => {
            if (!urisWithNewDiagnostics.has(uri)) {
                urisToDelete.push(uri);
            }
        });

        urisToDelete.forEach(uri => {
            diagnosticCollection.delete(uri);
            lastDiagnostics.delete(uri);
        });

    } catch (error) {
        console.error('Dendry project validation error:', error);
        vscode.window.showErrorMessage(`Dendry validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export function deactivate() {
    if (diagnosticCollection) {
        diagnosticCollection.dispose();
    }
}