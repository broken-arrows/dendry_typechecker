import * as vscode from 'vscode';
import { DendryValidator } from './validator';
import { DendryParser } from './parser';

let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
    console.log('Dendry type checker is now active');

    diagnosticCollection = vscode.languages.createDiagnosticCollection('dendry');
    context.subscriptions.push(diagnosticCollection);

    // Validate on open
    if (vscode.window.activeTextEditor) {
        validateDocument(vscode.window.activeTextEditor.document);
    }

    // Validate on change
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.languageId === 'dendry') {
                validateDocument(event.document);
            }
        })
    );

    // Validate on open
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(document => {
            if (document.languageId === 'dendry') {
                validateDocument(document);
            }
        })
    );

    // Clear diagnostics on close
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(document => {
            diagnosticCollection.delete(document.uri);
        })
    );
}

function validateDocument(document: vscode.TextDocument) {
    const config = vscode.workspace.getConfiguration('dendry');
    if (!config.get('validation.enable', true)) {
        return;
    }

    const text = document.getText();
    const parser = new DendryParser();
    const validator = new DendryValidator(config.get('validation.strictMode', false));

    try {
        const ast = parser.parse(text, document.fileName);
        const diagnostics = validator.validate(ast, document);
        diagnosticCollection.set(document.uri, diagnostics);
    } catch (error) {
        console.error('Dendry validation error:', error);
    }
}

export function deactivate() {
    if (diagnosticCollection) {
        diagnosticCollection.dispose();
    }
}