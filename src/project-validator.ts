import * as vscode from 'vscode';
import { parseText, DendryAST, DendryNode } from './parser';
import { BUILTIN_SCENE_IDS } from './scene-ids';
import { DendryValidator } from './validator';
import { qdisplayIdFromPath, parseQDisplay } from './qdisplay';
import { uriKey } from './uri-key';
import { SourceDocument, sourceDocument } from './source-document';

export class DendryProjectValidator {
  private validator = new DendryValidator();
  private fileData: Map<string, { uri: vscode.Uri; ast: DendryAST; localSceneIds: Set<string>; document: SourceDocument; }> = new Map();
  private parseDiagnostics = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>();
  private qdisplayData = new Map<string, { uri: vscode.Uri; parsed: ReturnType<typeof parseQDisplay> }>();
  private pendingWorkspaceFiles?: vscode.Uri[];
  private pendingChangedFiles = new Map<string, vscode.Uri>();
  private pendingFullRefresh = false;
  private running?: Promise<Map<vscode.Uri, vscode.Diagnostic[]>>;

  private parseDocument(document: SourceDocument): void {
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
      this.fileData.delete(uriKey(document.uri));
      this.parseDiagnostics.set(uriKey(document.uri), { uri: document.uri, diagnostics });
      return;
    }
    this.parseDiagnostics.delete(uriKey(document.uri));
    const localSceneIds = new Set<string>();
    // The parser owns declaration syntax and source context. Never rescan raw
    // lines: an @name inside JavaScript or prose is not a scene declaration.
    for (const node of ast.nodes) {
      const id = node.properties.get('id');
      if (node.type === 'scene' && id) localSceneIds.add(id);
    }
    this.fileData.set(uriKey(document.uri), { uri: document.uri, ast, localSceneIds, document });
  }

  // Concurrent callers join the same drain. Their latest workspace inventory
  // wins, while dirty URIs accumulate until a pass consumes them.
  validateProject(workspaceFiles: vscode.Uri[], changed?: vscode.Uri | readonly vscode.Uri[]): Promise<Map<vscode.Uri, vscode.Diagnostic[]>> {
    this.pendingWorkspaceFiles = [...new Map(workspaceFiles.map(uri => [uriKey(uri), uri])).values()];
    if (changed === undefined) this.pendingFullRefresh = true;
    else for (const uri of Array.isArray(changed) ? changed : [changed as vscode.Uri]) {
      this.pendingChangedFiles.set(uriKey(uri), uri);
    }
    if (!this.running) this.running = Promise.resolve().then(() => this.drainValidation());
    return this.running;
  }

  private async drainValidation(): Promise<Map<vscode.Uri, vscode.Diagnostic[]>> {
    let results = new Map<vscode.Uri, vscode.Diagnostic[]>();
    let failed = false, failure: unknown;
    try {
      while (this.pendingWorkspaceFiles) {
        const files = this.pendingWorkspaceFiles;
        const changed = [...this.pendingChangedFiles.values()];
        const full = this.pendingFullRefresh;
        this.pendingWorkspaceFiles = undefined;
        this.pendingChangedFiles.clear();
        this.pendingFullRefresh = false;
        try {
          results = await this.validatePass(files, changed, full);
          failed = false;
        } catch (error) {
          // Keep failed invalidations for a queued or future request. Do not
          // spin retrying a failed pass when no new request has arrived.
          for (const uri of changed) if (!this.pendingChangedFiles.has(uriKey(uri))) this.pendingChangedFiles.set(uriKey(uri), uri);
          this.pendingFullRefresh ||= full;
          failed = true; failure = error;
        }
      }
      if (failed) throw failure;
      return results;
    } finally {
      this.running = undefined;
    }
  }

  private async validatePass(workspaceFiles: vscode.Uri[], changedFiles: vscode.Uri[], fullRefresh: boolean): Promise<Map<vscode.Uri, vscode.Diagnostic[]>> {
      const finalDiagnostics: Map<vscode.Uri, vscode.Diagnostic[]> = new Map();
      const projectUris = new Map(workspaceFiles.map(uri => [uriKey(uri), uri]));
      const getDiagnostics = (uri: vscode.Uri) => finalDiagnostics.get(projectUris.get(uriKey(uri))!);
      const setDiagnostics = (uri: vscode.Uri, diagnostics: vscode.Diagnostic[]) => {
        finalDiagnostics.set(projectUris.get(uriKey(uri))!, diagnostics);
      };

      // 1. Remove deleted files from cache
      const currentWorkspaceFileKeys = new Set(workspaceFiles.map(uri => uriKey(uri)));
      for (const cachedKey of this.fileData.keys()) {
        if (!currentWorkspaceFileKeys.has(cachedKey)) {
          this.fileData.delete(cachedKey);
        }
      }
      for (const key of this.parseDiagnostics.keys()) {
        if (!currentWorkspaceFileKeys.has(key)) this.parseDiagnostics.delete(key);
      }
      for (const key of this.qdisplayData.keys()) {
        if (!currentWorkspaceFileKeys.has(key)) this.qdisplayData.delete(key);
      }

      // Always include new files. Only current project members may contribute
      // symbols, including after a queued deletion or workspace-folder change.
      const changedKeys = new Set(changedFiles.map(uriKey));
      const filesToParse = workspaceFiles.filter(uri => fullRefresh || changedKeys.has(uriKey(uri)) ||
        (!this.fileData.has(uriKey(uri)) && !this.qdisplayData.has(uriKey(uri)) && !this.parseDiagnostics.has(uriKey(uri))));

      for (const fileUri of filesToParse) {
        try {
          const open = vscode.workspace.textDocuments.find(doc => uriKey(doc.uri) === uriKey(fileUri));
          const text = open ? open.getText() : new TextDecoder().decode(await vscode.workspace.fs.readFile(fileUri));
          const document = sourceDocument(fileUri, text);
          if (fileUri.path.endsWith('.qdisplay.dry')) {
            this.qdisplayData.set(uriKey(fileUri), { uri: fileUri, parsed: parseQDisplay(text, fileUri.path) });
            this.parseDiagnostics.delete(uriKey(fileUri));
          } else this.parseDocument(document);
        } catch (error) {
          this.fileData.delete(uriKey(fileUri));
          this.qdisplayData.delete(uriKey(fileUri));
          const message = error instanceof Error ? error.message : String(error);
          this.parseDiagnostics.set(uriKey(fileUri), { uri: fileUri, diagnostics: [new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 0), `Error reading file for validation: ${message}`, vscode.DiagnosticSeverity.Error,
          )] });
        }
      }

      for (const { uri, diagnostics } of this.parseDiagnostics.values()) {
        setDiagnostics(uri, [...diagnostics]);
      }

      const displays = new Map<string, vscode.Uri[]>();
      for (const uri of workspaceFiles) {
        const id = qdisplayIdFromPath(uri.path);
        if (id === undefined) continue;
        const entries = displays.get(id) || [];
        if (!entries.some(entry => uriKey(entry) === uriKey(uri))) entries.push(uri);
        displays.set(id, entries);
      }
      for (const [id, entries] of displays) {
        if (entries.length < 2) continue;
        for (const uri of entries) {
          const other = entries.find(entry => entry !== uri)!;
          const diagnostics = getDiagnostics(uri) || [];
          diagnostics.push(new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0),
            `Duplicate QDisplay ID '${id}' also defined at ${other.path}.`, vscode.DiagnosticSeverity.Warning));
          setDiagnostics(uri, diagnostics);
        }
      }
      const qdisplayFiles = [...displays.keys()];
      // Cache parsing, but recheck references against the current project each pass.
      for (const { uri, parsed } of this.qdisplayData.values()) {
        const diagnostics = this.validator.validateQDisplay(parsed, this.fileData, qdisplayFiles);
        if (diagnostics.length) setDiagnostics(uri, [...(getDiagnostics(uri) || []), ...diagnostics]);
      }

      // 3. Recheck declarations on every pass, including cached files. Absolute
      // IDs can collide between a dotted filename and a section in another file.
      type Definition = { uri: vscode.Uri; node: DendryNode };
      const sceneDefinitions = new Map<string, Definition[]>();
      const qualityDefinitions = new Map<string, Definition[]>();
      const addDiagnostic = (definition: Definition, message: string) => {
        const items = getDiagnostics(definition.uri) || [];
        const point = definition.node.range.start;
        items.push(new vscode.Diagnostic(new vscode.Range(point, point), message, vscode.DiagnosticSeverity.Error));
        setDiagnostics(definition.uri, items);
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
          const existingDiags = getDiagnostics(fileUri) || [];
          const document = data.document;

          try {
              const validationDiagnostics = this.validator.validate(data.ast, document, this.fileData, qdisplayFiles);
              if (validationDiagnostics.length > 0) {
                setDiagnostics(fileUri, [...existingDiags, ...validationDiagnostics]);
              }
          } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              const range = new vscode.Range(0, 0, 0, 1);
              const errorDiag = new vscode.Diagnostic(range, `Error validating file: ${message}`, vscode.DiagnosticSeverity.Error);
              setDiagnostics(fileUri, [...existingDiags, errorDiag]);
          }
      }

      return finalDiagnostics;
  }
}
