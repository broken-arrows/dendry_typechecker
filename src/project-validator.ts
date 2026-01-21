import * as vscode from 'vscode';
import { parseText, DendryAST } from './parser';
import { DendryValidator } from './validator';

export class DendryProjectValidator {
  private validator = new DendryValidator(false);
  private fileData: Map<vscode.Uri, { ast: DendryAST; localSceneIds: Set<string>; localQualityIds: Set<string>; }> = new Map();
  private globalSceneIds: Set<string> = new Set();
  private globalQualityIds: Set<string> = new Set();

  private async _parseAndExtractLocalIds(document: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
    const fileUri = document.uri;
    const localSceneIds = new Set<string>();
    const localQualityIds = new Set<string>();
    const diagnostics: vscode.Diagnostic[] = [];

    try {
      const { ast, errors, lexErrors } = parseText(document.getText(), fileUri.fsPath);

      lexErrors.forEach((error: any) => {
        const range = new vscode.Range(error.line - 1, error.column - 1, error.line - 1, error.column - 1 + error.length);
        diagnostics.push(new vscode.Diagnostic(range, `Lexer Error: ${error.message}`, vscode.DiagnosticSeverity.Error));
      });

      errors.forEach((error: any) => {
        const token = error.token;
        const range = new vscode.Range(token.startLine - 1, token.startColumn - 1, token.endLine, token.endColumn);
        diagnostics.push(new vscode.Diagnostic(range, `Parser Error: ${error.message}`, vscode.DiagnosticSeverity.Error));
      });

      if (lexErrors.length > 0 || errors.length > 0) {
        this.fileData.delete(fileUri);
        return diagnostics;
      }

      const seenIds = new Set<string>();

      // First pass: collect explicit scene declarations from properties
      for (const node of ast.nodes) {
        const id = node.properties.get('id');
        if (id) {
          if (seenIds.has(id)) {
            diagnostics.push(new vscode.Diagnostic(node.range, `Duplicate ID "${id}" found in this file.`, vscode.DiagnosticSeverity.Error));
          }
          seenIds.add(id);
          if (node.type === 'scene') {
            localSceneIds.add(id);
          } else if (node.type === 'quality') {
            localQualityIds.add(id);
          }
        }
      }

      // Second pass: extract scene IDs from @scene markers in the document text
      // This catches scenes defined as "@sceneid:" in the file
      const text = document.getText();
      const sceneMarkerRegex = /@([a-zA-Z_][a-zA-Z0-9_-]*|[0-9]+)(?:\s|:)/g;
      let match;
      while ((match = sceneMarkerRegex.exec(text)) !== null) {
        const sceneId = match[1];
        if (!seenIds.has(sceneId)) {
          localSceneIds.add(sceneId);
          seenIds.add(sceneId);
        }
      }

      this.fileData.set(fileUri, { ast, localSceneIds, localQualityIds });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const range = new vscode.Range(0, 0, 0, 1);
      const diagnostic = new vscode.Diagnostic(range, `Error parsing file: ${message}`, vscode.DiagnosticSeverity.Error);
      diagnostics.push(diagnostic);
      this.fileData.delete(fileUri);
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

    // 3. Check for duplicate IDs across all files
    const globalSceneIdToUri: Map<string, vscode.Uri> = new Map();
    const globalQualityIdToUri: Map<string, vscode.Uri> = new Map();

    for (const [fileUri, data] of this.fileData) {
      const addDiagnosticsForDuplicate = (id: string, existingUri: vscode.Uri) => {
        let existingDiags = finalDiagnostics.get(existingUri) || [];
        const existingAst = this.fileData.get(existingUri)?.ast;
        const existingNode = existingAst?.nodes.find(n => n.properties.get('id') === id);
        if (existingNode) {
          existingDiags.push(new vscode.Diagnostic(existingNode.range, `Duplicate ID "${id}" also found in ${fileUri.fsPath}`, vscode.DiagnosticSeverity.Error));
          finalDiagnostics.set(existingUri, existingDiags);
        }

        let currentDiags = finalDiagnostics.get(fileUri) || [];
        const currentNode = data.ast.nodes.find(n => n.properties.get('id') === id);
        if (currentNode) {
          currentDiags.push(new vscode.Diagnostic(currentNode.range, `Duplicate ID "${id}" also found in ${existingUri.fsPath}`, vscode.DiagnosticSeverity.Error));
          finalDiagnostics.set(fileUri, currentDiags);
        }
      };

      for (const id of data.localSceneIds) {
        const existingUri = globalSceneIdToUri.get(id);
        if (existingUri) {
          addDiagnosticsForDuplicate(id, existingUri);
        } else {
          globalSceneIdToUri.set(id, fileUri);
        }
      }

      for (const id of data.localQualityIds) {
        const existingUri = globalQualityIdToUri.get(id);
        if (existingUri) {
          addDiagnosticsForDuplicate(id, existingUri);
        } else {
          globalQualityIdToUri.set(id, fileUri);
        }
      }
    }

    // 4. Rebuild global IDs from all cached file data
    this.globalSceneIds.clear();
    this.globalQualityIds.clear();
    this.fileData.forEach(data => {
      data.localSceneIds.forEach(id => this.globalSceneIds.add(id));
      data.localQualityIds.forEach(id => this.globalQualityIds.add(id));
    });

    // 5. Validate all files in cache against updated global IDs
    for (const [fileUri, data] of this.fileData) {
      if (finalDiagnostics.has(fileUri)) {
        continue;
      }

      let document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === fileUri.toString());
      if (!document) {
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
          const existingDiagnostics = finalDiagnostics.get(fileUri) || [];
          finalDiagnostics.set(fileUri, [...existingDiagnostics, ...validationDiagnostics]);
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
