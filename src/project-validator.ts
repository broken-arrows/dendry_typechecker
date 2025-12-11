import * as vscode from 'vscode';
import { DendryParser, DendryAST } from './parser';
import { DendryValidator } from './validator';

export class DendryProjectValidator {
    private parser = new DendryParser();
    private validator = new DendryValidator(false); // Initialize with strictMode false for now

    // Caches
    private fileData: Map<vscode.Uri, { ast: DendryAST; localSceneIds: Set<string>; localQualityIds: Set<string>; }> = new Map();
    private globalSceneIds: Set<string> = new Set();
    private globalQualityIds: Set<string> = new Set();

    private async _parseAndExtractLocalIds(document: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
        const fileUri = document.uri;
        const localSceneIds = new Set<string>();
        const localQualityIds = new Set<string>();
        const diagnostics: vscode.Diagnostic[] = [];

        try {
            const ast = this.parser.parse(document.getText(), fileUri.fsPath);
            for (const node of ast.nodes) {
                const id = node.properties.get('id');
                if (id) {
                    if (node.type === 'scene') {
                        localSceneIds.add(id);
                    } else if (node.type === 'quality') {
                        localQualityIds.add(id);
                    }
                }
            }
            this.fileData.set(fileUri, { ast, localSceneIds, localQualityIds });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const range = new vscode.Range(0, 0, 0, 1);
            const diagnostic = new vscode.Diagnostic(range, `Error parsing file: ${message}`, vscode.DiagnosticSeverity.Error);
            diagnostics.push(diagnostic);
            this.fileData.delete(fileUri); // Remove from cache if parsing failed
        }
        return diagnostics;
    }

    async validateProject(workspaceFiles: vscode.Uri[], changedFileUri?: vscode.Uri): Promise<Map<vscode.Uri, vscode.Diagnostic[]>> {
        const finalDiagnostics: Map<vscode.Uri, vscode.Diagnostic[]> = new Map();
        
        // 1. Remove deleted files from cache
        const currentWorkspaceFilePaths = new Set(workspaceFiles.map(uri => uri.toString()));
        for (const cachedUri of this.fileData.keys()) {
            if (!currentWorkspaceFilePaths.has(cachedUri.toString())) {
                this.fileData.delete(cachedUri);
            }
        }

        // 2. Parse/re-parse changed file or new files
        let filesToParse: vscode.Uri[] = [];
        if (changedFileUri) {
            filesToParse.push(changedFileUri);
        } else {
            // If no specific file changed, parse all files not yet in cache
            filesToParse = workspaceFiles.filter(uri => !this.fileData.has(uri));
        }

        for (const fileUri of filesToParse) {
            let document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === fileUri.toString());
            if (!document) {
                try {
                    document = await vscode.workspace.openTextDocument(fileUri);
                } catch (error) {
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
                } catch (error) {
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
            } catch (error) {
                 const message = error instanceof Error ? error.message : String(error);
                 const range = new vscode.Range(0, 0, 0, 1);
                 finalDiagnostics.set(fileUri, [new vscode.Diagnostic(range, `Error validating file: ${message}`, vscode.DiagnosticSeverity.Error)]);
            }
        }

        return finalDiagnostics;
    }
}
