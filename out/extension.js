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
// Debounce function
function debounce(func, delay) {
    let timeout;
    return function (...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}
function activate(context) {
    console.log('Dendry type checker is now active');
    diagnosticCollection = vscode.languages.createDiagnosticCollection('dendry');
    context.subscriptions.push(diagnosticCollection);
    projectValidator = new project_validator_1.DendryProjectValidator();
    const debouncedValidateProject = debounce(validateProject, 500);
    // Initial validation
    debouncedValidateProject();
    // Validate on change
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.languageId === 'dendry') {
            debouncedValidateProject(event.document.uri);
        }
    }));
    // Validate on open
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => {
        if (document.languageId === 'dendry') {
            debouncedValidateProject(document.uri);
        }
    }));
    // Re-validate on save
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
        if (document.languageId === 'dendry') {
            debouncedValidateProject(document.uri);
        }
    }));
    // Re-validate on delete
    context.subscriptions.push(vscode.workspace.onDidDeleteFiles(event => {
        if (event.files.some(file => file.path.endsWith('.scene.dry'))) {
            debouncedValidateProject();
        }
    }));
    // Clear diagnostics on close
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => {
        diagnosticCollection.delete(document.uri);
        lastDiagnostics.delete(document.uri); // Also remove from our cache
    }));
}
async function validateProject(changedFileUri) {
    const config = vscode.workspace.getConfiguration('dendry');
    if (!config.get('validation.enable', true)) {
        return;
    }
    const dendryFiles = await vscode.workspace.findFiles('**/*.scene.dry');
    try {
        const currentDiagnostics = await projectValidator.validateProject(dendryFiles, changedFileUri);
        const urisWithNewDiagnostics = new Set();
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
        const urisToDelete = [];
        lastDiagnostics.forEach((diags, uri) => {
            if (!urisWithNewDiagnostics.has(uri)) {
                urisToDelete.push(uri);
            }
        });
        urisToDelete.forEach(uri => {
            diagnosticCollection.delete(uri);
            lastDiagnostics.delete(uri);
        });
    }
    catch (error) {
        console.error('Dendry project validation error:', error);
        vscode.window.showErrorMessage(`Dendry validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function deactivate() {
    if (diagnosticCollection) {
        diagnosticCollection.dispose();
    }
}
//# sourceMappingURL=extension.js.map