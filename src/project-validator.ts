import * as vscode from 'vscode';
import { parseText, DendryAST, DendryNode } from './parser';
import { BUILTIN_SCENE_IDS } from './scene-ids';
import { DendryValidator } from './validator';
import { qdisplayIdFromPath } from './qdisplay';

export class DendryProjectValidator {
  private validator = new DendryValidator();
  private fileData: Map<string, { uri: vscode.Uri; ast: DendryAST; localSceneIds: Set<string>; }> = new Map();
  private parseDiagnostics = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>();
  private qdisplayDiagnostics = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>();
  private isValidating: boolean = false;
  private lastResults: Map<vscode.Uri, vscode.Diagnostic[]> | null = null;

  /**
   * Canonical cache key for a file URI. Virtual filesystem providers (notably
   * github.dev's `vscode-vfs://github/...`) can hand us *different*
   * `Uri.toString()` representations for the *same* file depending on whether it
   * came from `findFiles` or from an editor document event — differing only in
   * query/fragment or authority casing while sharing the same `.path`. Keying
   * the cache by the raw `Uri` object (reference identity) let those diverging
   * representations coexist as two entries, which made a file flag itself as a
   * duplicate filename. Collapsing to `scheme://authority/path` (lowercased
   * authority, no query/fragment) gives one entry per logical file. On desktop
   * (`file://`) this is a no-op since those URIs are already normalized.
   */
  private keyFor(uri: vscode.Uri): string {
    return `${uri.scheme}://${uri.authority.toLowerCase()}${uri.path}`;
  }

  private async _parseAndExtractLocalIds(document: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
    const diagnostics: vscode.Diagnostic[] = [];
    const { ast, errors } = parseText(document.getText(), document.uri.path);
    for (const error of errors) {
      const line = Math.min(Math.max(0, error.line), document.lineCount - 1);
      diagnostics.push(new vscode.Diagnostic(
        new vscode.Range(line, 0, line, document.lineAt(line).text.length),
        `Parser Error: ${error.message}`, vscode.DiagnosticSeverity.Error,
      ));
    }
    if (errors.length) {
      this.fileData.delete(this.keyFor(document.uri));
      this.parseDiagnostics.set(this.keyFor(document.uri), { uri: document.uri, diagnostics });
      return diagnostics;
    }
    this.parseDiagnostics.delete(this.keyFor(document.uri));
    const localSceneIds = new Set<string>();
    // The parser owns declaration syntax and source context. Never rescan raw
    // lines: an @name inside JavaScript or prose is not a scene declaration.
    for (const node of ast.nodes) {
      const id = node.properties.get('id');
      if (node.type === 'scene' && id) localSceneIds.add(id);
    }
    this.fileData.set(this.keyFor(document.uri), { uri: document.uri, ast, localSceneIds });
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
      const currentWorkspaceFileKeys = new Set(workspaceFiles.map(uri => this.keyFor(uri)));
      for (const cachedKey of this.fileData.keys()) {
        if (!currentWorkspaceFileKeys.has(cachedKey)) {
          this.fileData.delete(cachedKey);
        }
      }
      for (const key of this.parseDiagnostics.keys()) {
        if (!currentWorkspaceFileKeys.has(key)) this.parseDiagnostics.delete(key);
      }
      for (const key of this.qdisplayDiagnostics.keys()) {
        if (!currentWorkspaceFileKeys.has(key)) this.qdisplayDiagnostics.delete(key);
      }

      // 2. Parse/re-parse changed file or new files
      let filesToParse: vscode.Uri[] = [];
      if (changedFileUri) {
        filesToParse.push(changedFileUri);
      } else {
        filesToParse = workspaceFiles.filter(uri => !this.fileData.has(this.keyFor(uri)) && !this.qdisplayDiagnostics.has(this.keyFor(uri)));
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

        if (fileUri.path.endsWith('.qdisplay.dry')) {
          this.qdisplayDiagnostics.set(this.keyFor(fileUri), { uri: fileUri, diagnostics: this.validator.validateQDisplayFile(document) });
        } else {
            const parsingDiags = await this._parseAndExtractLocalIds(document);
            if (parsingDiags.length > 0) {
              finalDiagnostics.set(fileUri, parsingDiags);
            }
        }
      }

      for (const { uri, diagnostics } of this.parseDiagnostics.values()) {
        finalDiagnostics.set(uri, [...diagnostics]);
      }
      for (const { uri, diagnostics } of this.qdisplayDiagnostics.values()) {
        if (diagnostics.length) finalDiagnostics.set(uri, [...diagnostics]);
      }
      const displays = new Map<string, vscode.Uri[]>();
      for (const uri of workspaceFiles) {
        const id = qdisplayIdFromPath(uri.path);
        if (id === undefined) continue;
        const entries = displays.get(id) || [];
        if (!entries.some(entry => this.keyFor(entry) === this.keyFor(uri))) entries.push(uri);
        displays.set(id, entries);
      }
      for (const [id, entries] of displays) {
        if (entries.length < 2) continue;
        for (const uri of entries) {
          const other = entries.find(entry => entry !== uri)!;
          const diagnostics = finalDiagnostics.get(uri) || [];
          diagnostics.push(new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0),
            `Duplicate QDisplay ID '${id}' also defined at ${other.path}.`, vscode.DiagnosticSeverity.Warning));
          finalDiagnostics.set(uri, diagnostics);
        }
      }
      const qdisplayFiles = [...displays.keys()];

      // 3. Recheck declarations on every pass, including cached files. Absolute
      // IDs can collide between a dotted filename and a section in another file.
      type Definition = { uri: vscode.Uri; node: DendryNode };
      const sceneDefinitions = new Map<string, Definition[]>();
      const qualityDefinitions = new Map<string, Definition[]>();
      const addDiagnostic = (definition: Definition, message: string) => {
        const items = finalDiagnostics.get(definition.uri) || [];
        const point = definition.node.range.start;
        items.push(new vscode.Diagnostic(new vscode.Range(point, point), message, vscode.DiagnosticSeverity.Error));
        finalDiagnostics.set(definition.uri, items);
      };
      for (const data of this.fileData.values()) {
        for (const node of data.ast.nodes) {
          const id = node.properties.get('id');
          if (!id || (node.type !== 'scene' && node.type !== 'quality')) continue;
          const definitions = node.type === 'scene' ? sceneDefinitions : qualityDefinitions;
          const entries = definitions.get(id) || [];
          entries.push({ uri: data.uri, node });
          definitions.set(id, entries);
          if (node.type === 'scene' && BUILTIN_SCENE_IDS.has(id)) {
            addDiagnostic({ uri: data.uri, node }, `"${id}" is a reserved scene ID and cannot be defined.`);
          }
        }
      }
      for (const [kind, definitions] of [['scene', sceneDefinitions], ['quality', qualityDefinitions]] as const) {
        for (const [id, entries] of definitions) {
          if (entries.length < 2) continue;
          for (const entry of entries) {
            const other = entries.find(candidate => candidate !== entry)!;
            addDiagnostic(entry, `Duplicate ${kind} ID "${id}" also defined at ${other.uri.path}:${other.node.range.start.line + 1}`);
          }
        }
      }

      // Validate cached ASTs against the complete project index.
      for (const data of this.fileData.values()) {
          const fileUri = data.uri;
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
          
          let document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === fileUri.toString());
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
              } catch (error) {
                  const message = error instanceof Error ? error.message : String(error);
                  const range = new vscode.Range(0, 0, 0, 1);
                  finalDiagnostics.set(fileUri, [new vscode.Diagnostic(range, `Error reading file for validation: ${message}`, vscode.DiagnosticSeverity.Error)]);
                  continue;
              }
          }

          try {
              const validationDiagnostics = this.validator.validate(data.ast, document, this.fileData, qdisplayFiles);
              if (validationDiagnostics.length > 0) {
                finalDiagnostics.set(fileUri, [...existingDiags, ...validationDiagnostics]);
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
