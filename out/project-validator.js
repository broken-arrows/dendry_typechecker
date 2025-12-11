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
exports.DendryProjectValidator = void 0;
const vscode = __importStar(require("vscode"));
const parser_1 = require("./parser");
const validator_1 = require("./validator");
class DendryProjectValidator {
    constructor() {
        this.parser = new parser_1.DendryParser();
        this.validator = new validator_1.DendryValidator(false); // Initialize with strictMode false for now
        // Caches
        this.fileData = new Map();
        this.globalSceneIds = new Set();
        this.globalQualityIds = new Set();
    }
    async _parseAndExtractLocalIds(document) {
        const fileUri = document.uri;
        const localSceneIds = new Set();
        const localQualityIds = new Set();
        const diagnostics = [];
        try {
            const ast = this.parser.parse(document.getText(), fileUri.fsPath);
            for (const node of ast.nodes) {
                const id = node.properties.get('id');
                if (id) {
                    if (node.type === 'scene') {
                        localSceneIds.add(id);
                    }
                    else if (node.type === 'quality') {
                        localQualityIds.add(id);
                    }
                }
            }
            this.fileData.set(fileUri, { ast, localSceneIds, localQualityIds });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const range = new vscode.Range(0, 0, 0, 1);
            const diagnostic = new vscode.Diagnostic(range, `Error parsing file: ${message}`, vscode.DiagnosticSeverity.Error);
            diagnostics.push(diagnostic);
            this.fileData.delete(fileUri); // Remove from cache if parsing failed
        }
        return diagnostics;
    }
    async validateProject(workspaceFiles, changedFileUri) {
        const finalDiagnostics = new Map();
        // 1. Remove deleted files from cache
        const currentWorkspaceFilePaths = new Set(workspaceFiles.map(uri => uri.toString()));
        for (const cachedUri of this.fileData.keys()) {
            if (!currentWorkspaceFilePaths.has(cachedUri.toString())) {
                this.fileData.delete(cachedUri);
            }
        }
        // 2. Parse/re-parse changed file or new files
        let filesToParse = [];
        if (changedFileUri) {
            filesToParse.push(changedFileUri);
        }
        else {
            // If no specific file changed, parse all files not yet in cache
            filesToParse = workspaceFiles.filter(uri => !this.fileData.has(uri));
        }
        for (const fileUri of filesToParse) {
            let document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === fileUri.toString());
            if (!document) {
                try {
                    document = await vscode.workspace.openTextDocument(fileUri);
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    const range = new vscode.Range(0, 0, 0, 1);
                    finalDiagnostics.set(fileUri, [new vscode.Diagnostic(range, `Error opening file: ${message}`, vscode.DiagnosticSeverity.Error)]);
                    continue;
                }
            }
            const parsingDiags = await this._parseAndExtractLocalIds(document);
            if (parsingDiags.length > 0) {
                finalDiagnostics.set(fileUri, parsingDiags);
            }
        }
        // 3. Rebuild global IDs from all cached file data
        this.globalSceneIds.clear();
        this.globalQualityIds.clear();
        this.fileData.forEach(data => {
            data.localSceneIds.forEach(id => this.globalSceneIds.add(id));
            data.localQualityIds.forEach(id => this.globalQualityIds.add(id));
        });
        // 4. Validate all files in cache against updated global IDs
        for (const [fileUri, data] of this.fileData) {
            // Skip validation if parsing already produced errors for this file
            if (finalDiagnostics.has(fileUri)) {
                continue;
            }
            let document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === fileUri.toString());
            if (!document) {
                // Should ideally not happen if file is in fileData and still in workspaceFiles, but as a safeguard
                try {
                    document = await vscode.workspace.openTextDocument(fileUri);
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    const range = new vscode.Range(0, 0, 0, 1);
                    finalDiagnostics.set(fileUri, [new vscode.Diagnostic(range, `Error opening file for validation: ${message}`, vscode.DiagnosticSeverity.Error)]);
                    continue;
                }
            }
            try {
                const validationDiagnostics = this.validator.validate(data.ast, document, this.fileData);
                if (validationDiagnostics.length > 0) {
                    finalDiagnostics.set(fileUri, validationDiagnostics);
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const range = new vscode.Range(0, 0, 0, 1);
                finalDiagnostics.set(fileUri, [new vscode.Diagnostic(range, `Error validating file: ${message}`, vscode.DiagnosticSeverity.Error)]);
            }
        }
        return finalDiagnostics;
    }
}
exports.DendryProjectValidator = DendryProjectValidator;
//# sourceMappingURL=project-validator.js.map