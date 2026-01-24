import * as vscode from 'vscode';
import { parseText, DendryAST } from './parser';
import { DendryValidator } from './validator';

export class DendryProjectValidator {
  private validator = new DendryValidator(false);
  private fileData: Map<vscode.Uri, { ast: DendryAST; localSceneIds: Set<string>; localQualityIds: Set<string>; }> = new Map();
  private globalSceneIds: Set<string> = new Set();
  private globalQualityIds: Set<string> = new Set();
  private isValidating: boolean = false;
  private lastResults: Map<vscode.Uri, vscode.Diagnostic[]> | null = null;

  private async _parseAndExtractLocalIds(document: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
    const fileUri = document.uri;
    const localSceneIds = new Set<string>();
    const localQualityIds = new Set<string>();
    const diagnostics: vscode.Diagnostic[] = [];

    try {
      const { ast, errors, lexErrors } = parseText(document.getText(), fileUri.fsPath);
      const text = document.getText();
      
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
      const idToLine = new Map<string, number>();

      // First pass: collect explicit scene declarations from properties
      for (const node of ast.nodes) {
        const id = node.properties.get('id');
        if (id) {
          if (seenIds.has(id)) {
            // Now text is available here
            const lines = text.split(/\r?\n/);
            const sceneDeclarationRange = new vscode.Range(
              node.range.start.line,
              0,
              node.range.start.line,
              lines[node.range.start.line]?.length || 0
            );
            
            diagnostics.push(
              new vscode.Diagnostic(
                sceneDeclarationRange, 
                `Duplicate ID "${id}" found in this file (first defined on line ${(idToLine.get(id) || 0) + 1})`, 
                vscode.DiagnosticSeverity.Error
              )
            );
          }
          
          if (!seenIds.has(id)) {
            seenIds.add(id);
            idToLine.set(id, node.range.start.line);
          }
          
          if (node.type === 'scene') {
            localSceneIds.add(id);
          } else if (node.type === 'quality') {
            localQualityIds.add(id);
          }
        }
      }

      // Second pass: extract scene IDs from scene markers at the START OF LINES only
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Only match scene at the START of a line (scene declarations, not references)
        const match = line.match(/^@([a-zA-Z0-9_][\w-]*)(?:\s|:|$)/); // Added boundary check
        if (match) {
          const sceneId = match[1];
          if (!seenIds.has(sceneId)) {
            localSceneIds.add(sceneId);
            seenIds.add(sceneId);
          }
        }
      }

      
      // Extract scene ID from filename (e.g., "scene_id.scene.dry" -> "scene_id")
      const fileName = fileUri.fsPath.split(/[/\\]/).pop() || '';
      const fileBasedSceneId = fileName.replace(/\.scene\.dry$/, '');
      
      // Add the filename-based scene ID if valid
      if (fileBasedSceneId && fileBasedSceneId !== fileName && !seenIds.has(fileBasedSceneId)) {
          localSceneIds.add(fileBasedSceneId);
          seenIds.add(fileBasedSceneId);
      }
      
      // Check for reserved scene ID "jumpScene"
      if (seenIds.has('jumpScene') || seenIds.has("backSpecialScene")) {
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
              const line = lines[i].trim();
              const match = line.match(/^@(jumpScene)(?:\s|:|$)/);
              if (match) {
                  const reservedIdRange = new vscode.Range(i, 0, i, lines[i].length);
                  diagnostics.push(
                      new vscode.Diagnostic(
                          reservedIdRange,
                          `"jumpScene" is a reserved scene ID and cannot be used. Choose a different ID.`,
                          vscode.DiagnosticSeverity.Error
                      )
                  );
                  break;
              }
              const matchBack = line.match(/^@(backSpecialScene)(?:\s|:|$)/);
              if (matchBack) {
                  const reservedIdRange = new vscode.Range(i, 0, i, lines[i].length);
                  diagnostics.push(
                      new vscode.Diagnostic(
                          reservedIdRange,
                          `"backSpecialScene" is a reserved scene ID and cannot be used. Choose a different ID.`,
                          vscode.DiagnosticSeverity.Error
                      )
                  );
                  break;
              }
          }
          // Also check in nodes
          for (const node of ast.nodes) {
              const id = node.properties.get('id');
              if (id === 'jumpScene') {
                  const nodeLines = text.split(/\r?\n/);
                  const reservedIdRange = new vscode.Range(
                      node.range.start.line,
                      0,
                      node.range.start.line,
                      nodeLines[node.range.start.line]?.length || 0
                  );
                  diagnostics.push(
                      new vscode.Diagnostic(
                          reservedIdRange,
                          `"jumpScene" is a reserved scene ID and cannot be used. Choose a different ID.`,
                          vscode.DiagnosticSeverity.Error
                      )
                  );
              } else if (id === "backSpecialScene") {
                  const nodeLines = text.split(/\r?\n/);
                  const reservedIdRange = new vscode.Range(
                      node.range.start.line,  
                      0,
                      node.range.start.line,
                      nodeLines[node.range.start.line]?.length || 0
                  );
                  diagnostics.push(
                      new vscode.Diagnostic(
                          reservedIdRange,
                          `"backSpecialScene" is a reserved scene ID and cannot be used. Choose a different ID.`,
                          vscode.DiagnosticSeverity.Error
                      )
                  );
              }
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
    if (this.isValidating) {
      return this.lastResults || new Map();
    }
    this.isValidating = true;
    
    try {
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

        if (fileUri.fsPath.endsWith('.qdisplay.dry')) {
            const qdisplayDiags = this.validator.validateQDisplayFile(document);
            if (qdisplayDiags.length > 0) {
                finalDiagnostics.set(fileUri, qdisplayDiags);
            }
        } else {
            const parsingDiags = await this._parseAndExtractLocalIds(document);
            if (parsingDiags.length > 0) {
              finalDiagnostics.set(fileUri, parsingDiags);
            }
        }
      }

      // 3. Check for duplicate IDs across all files
      const globalSceneIdToUri: Map<string, vscode.Uri> = new Map();
      const globalQualityIdToUri: Map<string, vscode.Uri> = new Map();

      for (const [fileUri, data] of this.fileData) {
        const addDiagnosticsForDuplicate = async (id: string, existingUri: vscode.Uri, currentUri: vscode.Uri, isScene: boolean) => {
            // Skip if it's the same file (handled separately in parseAndExtractLocalIds)
            if (existingUri.toString() === currentUri.toString()) {
              return;
            }
          
          // Helper to create range for just the scene line (async to read unopened files)
          const createSceneDeclarationRange = async (uri: vscode.Uri, sceneId: string): Promise<vscode.Range | null> => {
            // First try to get from already open documents
            let doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
            let text: string;
            
            if (doc) {
              text = doc.getText();
            } else {
              // File not open - read from filesystem
              try {
                const uint8 = await vscode.workspace.fs.readFile(uri);
                text = new TextDecoder().decode(uint8);
              } catch (error) {
                return null;
              }
            }
            
            const lines = text.split('\n');
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i].trim();
              if (line.startsWith(`@${sceneId}`) && (line === `@${sceneId}` || line[`@${sceneId}`.length] === ' ' || line[`@${sceneId}`.length] === ':')) {
                return new vscode.Range(i, 0, i, lines[i].length);
              }
            }
            return null;
          };

          // Add diagnostic to existing file
          let existingDiags = finalDiagnostics.get(existingUri) || [];
          const existingRange = await createSceneDeclarationRange(existingUri, id);
          if (existingRange) {
            const existingFileName = existingUri.fsPath.split('/').pop();
            existingDiags.push(new vscode.Diagnostic(
              existingRange,
              `Duplicate ${isScene ? 'scene' : 'quality'} ID "${id}" also found in ${fileUri.fsPath.split('/').pop()}`,
              vscode.DiagnosticSeverity.Error
            ));
            finalDiagnostics.set(existingUri, existingDiags);
          }

          // Add diagnostic to current file
          let currentDiags = finalDiagnostics.get(fileUri) || [];
          const currentRange = await createSceneDeclarationRange(fileUri, id);
          if (currentRange) {
            currentDiags.push(new vscode.Diagnostic(
              currentRange,
              `Duplicate ${isScene ? 'scene' : 'quality'} ID "${id}" also found in ${existingUri.fsPath.split('/').pop()}`,
              vscode.DiagnosticSeverity.Error
            ));
            finalDiagnostics.set(fileUri, currentDiags);
          }

        };

        for (const id of data.localSceneIds) {
          const existingUri = globalSceneIdToUri.get(id);
          if (existingUri) {
            await addDiagnosticsForDuplicate(id, existingUri, fileUri, true);
          } else {
            globalSceneIdToUri.set(id, fileUri);
          }
        }

        for (const id of data.localQualityIds) {
          const existingUri = globalQualityIdToUri.get(id);
          if (existingUri) {
            await addDiagnosticsForDuplicate(id, existingUri, fileUri, false);
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
          // ONLY skip if there were PARSING errors (not just any diagnostics)
          // We need to run full validation even if there are other types of errors
          const existingDiags = finalDiagnostics.get(fileUri) || [];
          const hasParsingErrors = existingDiags.some(diag => 
              diag.message.includes('Lexer Error:') || 
              diag.message.includes('Parser Error:') ||
              diag.message.includes('Error parsing file:') ||
              diag.message.includes('Error opening file:')
          );
          
          if (hasParsingErrors) {
              // Skip validation if we couldn't parse the file
              console.warn(`Skipping validation for ${fileUri.fsPath} due to parsing errors`);
              continue;
          }
          
          const qdisplayFiles = workspaceFiles
            .filter(file => file.fsPath.endsWith('.qdisplay.dry'))
            .map(file => file.fsPath.split(/[/\\]/).pop()?.replace('.qdisplay.dry', '') || '');

          let document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === fileUri.toString());
          let useRaw = false;
          if (!document) {
              try {
                const uint8 = await vscode.workspace.fs.readFile(fileUri);
                const text = new TextDecoder().decode(uint8);
                const lines = text.split('\n');
                document = {
                  lineAt: (lineNum: number) => ({ text: lines[lineNum] } as vscode.TextLine),
                  getText: (range?: vscode.Range) => {
                    if (!range) {
                      return text;
                    }
                    // Handle range parameter properly
                    const rangeLines = lines.slice(range.start.line, range.end.line + 1);
                    if (rangeLines.length === 0) return '';
                    if (rangeLines.length === 1) {
                      return rangeLines[0].substring(range.start.character, range.end.character);
                    }
                    // Multi-line range
                    rangeLines[0] = rangeLines[0].substring(range.start.character);
                    rangeLines[rangeLines.length - 1] = rangeLines[rangeLines.length - 1].substring(0, range.end.character);
                    return rangeLines.join('\n');
                  },
                  uri: fileUri
                } as vscode.TextDocument;
                useRaw = true;
              } catch (error) {
                  const message = error instanceof Error ? error.message : String(error);
                  const range = new vscode.Range(0, 0, 0, 1);
                  finalDiagnostics.set(fileUri, [new vscode.Diagnostic(range, `Error reading file for validation: ${message}`, vscode.DiagnosticSeverity.Error)]);
                  continue;
              }
          }

          try {
              if (fileUri.fsPath.endsWith('.qdisplay.dry')) {
                  const qdisplayDiags = this.validator.validateQDisplayFile(document);
                  if (qdisplayDiags.length > 0) {
                      const existingDiagnostics = finalDiagnostics.get(fileUri) || [];
                      finalDiagnostics.set(fileUri, [...existingDiagnostics, ...qdisplayDiags]);
                  }
              } else {
                  const validationDiagnostics = this.validator.validate(data.ast, document, this.fileData, qdisplayFiles);
                  if (validationDiagnostics.length > 0) {
                      const existingDiagnostics = finalDiagnostics.get(fileUri) || [];
                      finalDiagnostics.set(fileUri, [...existingDiagnostics, ...validationDiagnostics]);
                  }
              }
          } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              const range = new vscode.Range(0, 0, 0, 1);
              const errorDiag = new vscode.Diagnostic(range, `Error validating file: ${message}`, vscode.DiagnosticSeverity.Error);
              finalDiagnostics.set(fileUri, [...existingDiags, errorDiag]);
          }
      }

      this.lastResults = finalDiagnostics;
      return finalDiagnostics;
    } finally {
      this.isValidating = false;
    }
  }
}
