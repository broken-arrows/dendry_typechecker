import * as vscode from 'vscode';
import * as esprima from 'esprima';
import { DendryAST, DendryNode } from './parser';

type FileData = {
  ast: DendryAST;
  localSceneIds: Set<string>;
  localQualityIds: Set<string>;
};

export class DendryValidator {
  private strictMode: boolean;
  private sceneIds: Set<string> = new Set();
  private qualityIds: Set<string> = new Set();
  private _allFileData: Map<vscode.Uri, FileData> = new Map();

  private readonly SCENE_PROPERTIES = new Set([
    'id',
    'title',
    'subtitle',
    'tags',
    'order',
    'frequency',
    'max-visits',
    'min-choices',
    'max-choices',
    'new-page',
    'signal',
    'content',
    'on-arrival',
    'on-display',
    'on-departure',
    'view-if',
    'choose-if',
    'priority',
    'unavailable-subtitle',
    'set-jump',
    'is-special',
    'go-to',
    'set-bg',
    'is-hand',
    'card-image',
    'face-image',
    'is-deck',
    'max-cards',
    'is-pinned-card',
    'is-card'
  ]);

  private readonly QUALITY_PROPERTIES = new Set(['id', 'name', 'initial', 'min', 'max', 'signal']);

  private readonly CHOICE_PROPERTIES = new Set([
    'view-if',
    'choose-if',
    'on-choose',
    'go-to',
    'priority',
    'unavailable-subtitle',
    'min-choices',
    'max-choices'
  ]);

  constructor(strictMode: boolean = false) {
    this.strictMode = strictMode;
  }

  validate(
    ast: DendryAST,
    document: vscode.TextDocument,
    allFileData: Map<vscode.Uri, FileData>
  ): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    this._allFileData = allFileData;

    // rebuild global IDs
    this.sceneIds.clear();
    this.qualityIds.clear();
    allFileData.forEach(d => {
      d.localSceneIds.forEach(id => this.sceneIds.add(id.trim()));
      d.localQualityIds.forEach(id => this.qualityIds.add(id.trim()));
    });

    // Validate metadata (root-level properties)
    diagnostics.push(...this.validateMetadata(ast.metadata, document));

    for (const node of ast.nodes) {
      diagnostics.push(...this.validateNode(node, document));
    }

    if (ast.metadata.rootScene) {
      this.validateSceneReference(ast.metadata.rootScene, new vscode.Range(0, 0, 0, 0), diagnostics);
    }

    return diagnostics;
  }


  private validateNode(node: DendryNode, document: vscode.TextDocument): vscode.Diagnostic[] {
    switch (node.type) {
      case 'scene':
        return this.validateScene(node, document);
      case 'quality':
        return this.validateQuality(node, document);
      case 'choice':
        return this.validateChoice(node, document);
      default:
        return [];
    }
  }

  private validateScene(node: DendryNode, document: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];

    // Check for standalone "@" (no scene ID)
    const sceneLine = document.lineAt(node.range.start.line).text.trim();
    if (sceneLine === '@' || sceneLine.match(/^@\s*$/)) {
      const sceneDeclarationRange = new vscode.Range(
        node.range.start.line,
        0,
        node.range.start.line,
        document.lineAt(node.range.start.line).text.length
      );
      diagnostics.push(
        this.createDiagnostic(
          sceneDeclarationRange,
          `Scene declaration missing identifier, expected: "@scene_id"`,
          vscode.DiagnosticSeverity.Error
        )
      );
    }


    // Create a range for just the scene declaration line
    const sceneDeclarationRange = new vscode.Range(
      node.range.start.line,
      0,
      node.range.start.line,
      document.lineAt(node.range.start.line).text.length
    );

    if (node.declarationType === 'explicit' && !node.properties.has('title')) {
      diagnostics.push(
        this.createDiagnostic(
          sceneDeclarationRange,
          `Scene missing "title" property.`,
          vscode.DiagnosticSeverity.Warning
        )
      );
    }

    const id = node.properties.get('id');
    if (id !== undefined && (typeof id !== 'string' || id.trim() === '')) {
      diagnostics.push(this.createDiagnostic(sceneDeclarationRange, `Scene "id" cannot be empty.`, vscode.DiagnosticSeverity.Error));
    }

    // Check for duplicate properties
    const propertyLines = new Map<string, number>();
    const nodeText = document.getText(node.range);
    const nodeLines = nodeText.split('\n');
    let currentLine = node.range.start.line;

    for (let i = 0; i < nodeLines.length; i++) {
      const line = nodeLines[i].trim();
      const match = line.match(/^([\w-]+):/);
      if (match) {
        const propKey = match[1];
        if (propertyLines.has(propKey)) {
          const duplicateRange = new vscode.Range(
            currentLine + i,
            0,
            currentLine + i,
            nodeLines[i].length
          );
          diagnostics.push(
            this.createDiagnostic(
              duplicateRange,
              `Duplicate property: "${propKey}" (first defined on line ${propertyLines.get(propKey)! + 1})`,
              vscode.DiagnosticSeverity.Warning
            )
          );
        } else {
          propertyLines.set(propKey, currentLine + i);
        }
      }
    }



    for (const [key, value] of node.properties.entries()) {
      const r = this.findRangeForProperty(document, node.range, key);

      if (!this.SCENE_PROPERTIES.has(key)) {
        diagnostics.push(
          this.createDiagnostic(
            r,
            `Unknown scene property: "${key}"`,
            this.strictMode ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
          )
        );
      }

      if (
        key === 'max-visits' ||
        key === 'min-choices' ||
        key === 'max-choices' ||
        key === 'frequency' ||
        key === 'order' ||
        key === 'priority' ||
        key === 'max-cards'
      ) {
        this.validateNumber(value, r, key, diagnostics);
      }

      if (
        key === 'new-page' ||
        key === 'is-special' ||
        key === 'is-hand' ||
        key === 'is-deck' ||
        key === 'is-pinned-card' ||
        key === 'is-card'
      ) {
        this.validateBoolean(value, r, key, diagnostics);
      }

      if (key.startsWith('on-') || key === 'view-if' || key === 'choose-if') {
        diagnostics.push(...this.validateJavaScript(String(value ?? ''), r));
      }

      if (key === 'go-to') {
        this.validateGoTo(String(value ?? ''), r, diagnostics);
      }

      if (key === 'set-jump') {
        this.validateSceneReference(String(value ?? ''), r, diagnostics);
      }
    }

    return diagnostics;
  }

  private validateQuality(node: DendryNode, document: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];

    if (!node.properties.has('id')) {
      diagnostics.push(
        this.createDiagnostic(node.range, 'Quality must have an "id" property', vscode.DiagnosticSeverity.Error)
      );
    }

    for (const [key, value] of node.properties.entries()) {
      if (!this.QUALITY_PROPERTIES.has(key)) {
        diagnostics.push(
          this.createDiagnostic(
            node.range,
            `Unknown quality property: "${key}"`,
            this.strictMode ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
          )
        );
      }

      if (key === 'initial' || key === 'min' || key === 'max') {
        const r = this.findRangeForProperty(document, node.range, key);
        this.validateNumber(value, r, key, diagnostics);
      }
    }

    // Cross-property checks
    const min = Number(node.properties.get('min'));
    const max = Number(node.properties.get('max'));
    const initial = Number(node.properties.get('initial'));

    if (!isNaN(min) && !isNaN(max) && min > max) {
      diagnostics.push(
        this.createDiagnostic(node.range, 'Quality "min" value cannot be greater than "max" value', vscode.DiagnosticSeverity.Error)
      );
    }

    if (!isNaN(initial) && !isNaN(min) && initial < min) {
      diagnostics.push(
        this.createDiagnostic(node.range, 'Quality "initial" value cannot be less than "min" value', vscode.DiagnosticSeverity.Error)
      );
    }

    if (!isNaN(initial) && !isNaN(max) && initial > max) {
      diagnostics.push(
        this.createDiagnostic(node.range, 'Quality "initial" value cannot be greater than "max" value', vscode.DiagnosticSeverity.Error)
      );
    }

    return diagnostics;
  }

  private validateChoice(node: DendryNode, document: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];

    for (const [key, value] of node.properties.entries()) {
      const r = this.findRangeForProperty(document, node.range, key);

      if (!this.CHOICE_PROPERTIES.has(key)) {
        diagnostics.push(
          this.createDiagnostic(
            node.range,
            `Unknown choice property: "${key}"`,
            this.strictMode ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
          )
        );
      }

      if (key === 'view-if' || key === 'choose-if' || key === 'on-choose') {
        diagnostics.push(...this.validateJavaScript(String(value ?? ''), r));
      }

      if (key === 'go-to') {
        this.validateGoTo(String(value ?? ''), r, diagnostics);
      }

      if (key === 'priority' || key === 'min-choices' || key === 'max-choices') {
        this.validateNumber(value, r, key, diagnostics);
      }
    }

    let choiceContent = node.content ?? '';
    // If content is empty, try to extract from the document line
    if (!choiceContent || choiceContent.trim() === '') {
      const lineText = document.lineAt(node.range.start.line).text;
      choiceContent = lineText.substring(lineText.indexOf('-') + 1).trim();
    }

    // Check for tag references (- #tag_name)
    const tagMatch = choiceContent.match(/^#([a-zA-Z_][a-zA-Z0-9_-]*)/);
    if (tagMatch) {
      const tagName = tagMatch[1];
      // Find the range of the tag in the document
      const fullLineText = document.lineAt(node.range.start.line).text;
      const hashIndex = fullLineText.indexOf('#');
      if (hashIndex !== -1) {
        const tagStart = hashIndex + 1; // Position after #
        const tagEnd = tagStart + tagName.length;
        const tagRange = new vscode.Range(
          node.range.start.line,
          tagStart,
          node.range.start.line,
          tagEnd
        );
        this.validateTag(tagName, tagRange, diagnostics);
      }
      return diagnostics; // Tag choices don't have scene references
    }

    // Check for scene references
    // Check for scene references
    // First remove inline dendry conditions and comments
    const cleaned = choiceContent.replace(/\[\?.*?\?\]/g, '');// ignore inline dendry brackets
    // Match scene IDs: can start with letter/digit/underscore, continue with word chars or hyphens
    const match = cleaned.match(/@([\w][\w-]*)(?::\s*(.+))?/);

    if (match) {
      const sceneId = match[1].trim();
      // Compute precise range for @sceneId on this line
      const fullLineText = document.lineAt(node.range.start.line).text;
      const atIndex = fullLineText.indexOf('@');
      if (atIndex !== -1) {
        const start = atIndex + 1; // Position after @
        const end = start + sceneId.length;
        const sceneIdRange = new vscode.Range(
          node.range.start.line,
          start,
          node.range.start.line,
          end
        );
        this.validateSceneReference(sceneId, sceneIdRange, diagnostics);
      } else {
        // Fallback to node range if we can't find the @ symbol
        this.validateSceneReference(sceneId, node.range, diagnostics);
      }
    }

    return diagnostics;
  }

  private validateMetadata(metadata: DendryAST['metadata'], document: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();
    const lines = text.split(/\r?\n/);

    // Find where scenes start (stop checking metadata there)
    let firstSceneLine = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().match(/^@\w/)) {
        firstSceneLine = i;
        break;
      }
    }

    // Check for duplicate metadata properties
    const seenProperties = new Map<string, number>();
    for (let i = 0; i < firstSceneLine; i++) {
      const trimmed = lines[i].trim();
      const match = trimmed.match(/^([\w-]+):/);
      if (match && !trimmed.startsWith('@')) {
        const propKey = match[1];
        if (seenProperties.has(propKey)) {
          const duplicateRange = new vscode.Range(i, 0, i, lines[i].length);
          diagnostics.push(
            this.createDiagnostic(
              duplicateRange,
              `Duplicate metadata property: "${propKey}" (first defined on line ${seenProperties.get(propKey)! + 1})`,
              vscode.DiagnosticSeverity.Warning
            )
          );
        } else {
          seenProperties.set(propKey, i);
        }
      }
    }

    for (const [key, value] of Object.entries(metadata)) {
      // Skip internal properties
      if (key === 'fileName') continue;

      // Find the line with this property (only in the metadata section)
      let lineIndex = -1;
      for (let i = 0; i < firstSceneLine; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith(`${key}:`) && !trimmed.startsWith('@')) {
          lineIndex = i;
          break;
        }
      }

      if (lineIndex === -1) continue;

      const line = lines[lineIndex];
      const colonIndex = line.indexOf(':');
      const valueStart = colonIndex + 1;
      
      const range = new vscode.Range(
        lineIndex,
        valueStart,
        lineIndex,
        line.length
      );

      // Validate boolean properties
      if (key === 'new-page' || key === 'is-special' || key === 'is-hand' || 
          key === 'is-deck' || key === 'is-pinned-card' || key === 'is-card') {
        this.validateBoolean(value, range, key, diagnostics);
      }

      // Validate number properties
      if (key === 'max-visits' || key === 'min-choices' || key === 'max-choices' || 
          key === 'frequency' || key === 'order' || key === 'priority' || key === 'max-cards') {
        this.validateNumber(value, range, key, diagnostics);
      }

      // Validate JavaScript properties
      if (key.startsWith('on-') || key === 'view-if' || key === 'choose-if') {
        diagnostics.push(...this.validateJavaScript(String(value ?? ''), range));
      }

      // Validate go-to
      if (key === 'go-to') {
        this.validateGoTo(String(value ?? ''), range, diagnostics);
      }
    }

    return diagnostics;
  }

  private validateTag(tagName: string, range: vscode.Range, diagnostics: vscode.Diagnostic[]): void {
    // Check if any scene in the project has this tag
    let tagFound = false;
    for (const [uri, fileData] of this._allFileData) {
      for (const node of fileData.ast.nodes) {
        if (node.type === 'scene') {
          const tags = node.properties.get('tags');
          if (tags) {
            const tagList = String(tags).split(/[,\s]+/).map(t => t.trim()).filter(t => t);
            if (tagList.includes(tagName)) {
              tagFound = true;
              break;
            }
          }
        }
      }
      if (tagFound) break;
    }

    if (!tagFound) {
      diagnostics.push(
        this.createDiagnostic(
          range,
          `Tag "${tagName}" is not defined in any scene`,
          vscode.DiagnosticSeverity.Error
        )
      );
    }
  }

  private validateGoTo(value: string, range: vscode.Range, diagnostics: vscode.Diagnostic[]) {
    const statements = value.split(';');
    for (const st of statements) {
      const trimmed = st.trim();
      if (!trimmed) continue;

      const ifIndex = trimmed.indexOf(' if ');
      let sceneId = '';
      let condition: string | null = null;

      if (ifIndex !== -1) {
        sceneId = trimmed.substring(0, ifIndex).trim();
        condition = trimmed.substring(ifIndex + 4).trim();
      } else {
        sceneId = trimmed;
      }

      if (sceneId && sceneId !== 'jumpScene') {
        this.validateSceneReference(sceneId, range, diagnostics);
      }

      if (condition) {
        diagnostics.push(...this.validateJavaScript(condition, range));
      }
    }
  }

  private findRangeForProperty(document: vscode.TextDocument, nodeRange: vscode.Range, key: string): vscode.Range {
    const nodeText = document.getText(nodeRange);
    const lines = nodeText.split('\n');
    let propertyLineIndex = -1;
    let propertyLineText = '';

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith(key + ':')) {
        propertyLineIndex = i;
        propertyLineText = lines[i];
        break;
      }
    }

    if (propertyLineIndex === -1) return nodeRange;

    const valueStartIndex = propertyLineText.indexOf(':') + 1;
    const valueText = propertyLineText.substring(valueStartIndex);

    // JS block case
    if (valueText.trim().startsWith('{!')) {
      const propertyAbsLine = nodeRange.start.line + propertyLineIndex;
      const openRel = valueText.indexOf('{!');

      // JS starts either after "{!" on same line, or at next line column 0
      const afterOpen = valueText.substring(openRel + 2);
      let startLine: number;
      let startCol: number;

      if (afterOpen.trim().length > 0) {
        startLine = propertyAbsLine;
        startCol = nodeRange.start.character + valueStartIndex + openRel + 2;
      } else {
        startLine = propertyAbsLine + 1;
        startCol = 0;
      }

      // Find closing "!}"
      for (let i = propertyLineIndex; i < lines.length; i++) {
        const closingIndex = lines[i].indexOf('!}');
        if (closingIndex !== -1) {
          const endLine = nodeRange.start.line + i;
          const endCol = (i === propertyLineIndex ? nodeRange.start.character : 0) + closingIndex;
          return new vscode.Range(startLine, startCol, endLine, endCol);
        }
      }

      // fallback: highlight at least "{!"
      const openAbsCol = nodeRange.start.character + valueStartIndex + openRel;
      return new vscode.Range(propertyAbsLine, openAbsCol, propertyAbsLine, openAbsCol + 2);
    }

    // Normal scalar value on same line
    const line = nodeRange.start.line + propertyLineIndex;
    const leftTrim = valueText.length - valueText.trimStart().length;
    const startCol = nodeRange.start.character + valueStartIndex + leftTrim;
    const endCol = startCol + valueText.trim().length;
    return new vscode.Range(line, startCol, line, endCol);
  }

  private validateNumber(value: any, range: vscode.Range, propertyName: string, diagnostics: vscode.Diagnostic[]) {
    if (isNaN(Number(value))) {
      diagnostics.push(
        this.createDiagnostic(
          range,
          `Property "${propertyName}" must be a number, got: "${value}"`,
          vscode.DiagnosticSeverity.Error
        )
      );
    }
  }

  private validateBoolean(value: any, range: vscode.Range, propertyName: string, diagnostics: vscode.Diagnostic[]) {
    if (
      typeof value !== 'string' ||
      (value.toLowerCase() !== 'true' && value.toLowerCase() !== 'false')
    ) {
      diagnostics.push(
        this.createDiagnostic(
          range,
          `Property "${propertyName}" must be "true" or "false", got: "${value}"`,
          vscode.DiagnosticSeverity.Error
        )
      );
    }
  }

  private validateJavaScript(code: string, range: vscode.Range): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const wrappedCode = `var Q, S, V, P;\n${code}`;

    try {
      const ast = esprima.parseScript(wrappedCode, { loc: true, tolerant: false });
      // Additional checks for common errors
      this.checkJavaScriptAst(ast, code, range, diagnostics);
      this.checkUndefinedIdentifiers(code, range, diagnostics);
    } catch (error: any) {
      const errLineNumber: number = typeof error?.lineNumber === 'number' ? error.lineNumber : 1;
      const errColumn: number = typeof error?.column === 'number' ? error.column : 0;
      const lineOffset = Math.max(0, errLineNumber - 2);
      const colBase = lineOffset === 0 ? range.start.character : 0;

      const errRange = new vscode.Range(
        range.start.line + lineOffset,
        colBase + errColumn,
        range.start.line + lineOffset,
        colBase + errColumn + 1
      );

      diagnostics.push(
        this.createDiagnostic(
          errRange,
          `JavaScript Error: ${error.description || error.message}`,
          vscode.DiagnosticSeverity.Error
        )
      );
    }

    return diagnostics;
  }

  private checkJavaScriptAst(ast: any, code: string, range: vscode.Range, diagnostics: vscode.Diagnostic[]): void {
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;

      // Check for assignment in if condition (common mistake)
      if (node.type === 'IfStatement' && node.test?.type === 'AssignmentExpression') {
        const loc = node.test.loc;
        if (loc) {
          const errRange = new vscode.Range(
            range.start.line + loc.start.line - 2,
            (loc.start.line === 2 ? range.start.character : 0) + loc.start.column,
            range.start.line + loc.end.line - 2,
            (loc.end.line === 2 ? range.start.character : 0) + loc.end.column
          );

          diagnostics.push(
            this.createDiagnostic(
              errRange,
              `Possible mistake: assignment (=) in condition, did you mean comparison (==)?`,
              vscode.DiagnosticSeverity.Warning
            )
          );
        }
      }

      // Recursively walk the AST
      for (const key in node) {
        if (key === 'loc' || key === 'range') continue;
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(walk);
        } else if (child && typeof child === 'object') {
          walk(child);
        }
      }
    };

    walk(ast);
  }

  private checkUndefinedIdentifiers(code: string, range: vscode.Range, diagnostics: vscode.Diagnostic[]): void {
    try {
      const ast = esprima.parseScript(`var Q, S, V, P;\n${code}`, { loc: true, tolerant: false });
      
      const definedVars = new Set(['Q', 'S', 'V', 'P', 'console', 'Math', 'Date', 'JSON', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'undefined', 'null', 'true', 'false', 'Object', 'Array', 'String', 'Number', 'Boolean']);
      const declaredInCode = new Set<string>();
      
      const collectDeclarations = (node: any) => {
        if (!node || typeof node !== 'object') return;
        
        if (node.type === 'VariableDeclarator' && node.id?.name) {
          declaredInCode.add(node.id.name);
        }
        if (node.type === 'FunctionDeclaration' && node.id?.name) {
          declaredInCode.add(node.id.name);
        }
        
        for (const key in node) {
          if (key === 'loc' || key === 'range') continue;
          const child = node[key];
          if (Array.isArray(child)) {
            child.forEach(collectDeclarations);
          } else if (child && typeof child === 'object') {
            collectDeclarations(child);
          }
        }
      };
      
      collectDeclarations(ast);
      declaredInCode.forEach(v => definedVars.add(v));
      
      const checkIdentifiers = (node: any, parent: any = null) => {
        if (!node || typeof node !== 'object') return;
        
        if (node.type === 'Identifier' && node.name && !definedVars.has(node.name)) {
          const loc = node.loc;
          if (loc) {
            const errRange = new vscode.Range(
              range.start.line + loc.start.line - 2,
              (loc.start.line === 2 ? range.start.character : 0) + loc.start.column,
              range.start.line + loc.end.line - 2,
              (loc.end.line === 2 ? range.start.character : 0) + loc.end.column
            );
            
            // Check if this is actually a reference (not a property name)
            const isPropertyName = parent && (
              (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) ||
              (parent.type === 'Property' && parent.key === node && !parent.computed)
            );
            
            if (!isPropertyName) {
              diagnostics.push(
                this.createDiagnostic(
                  errRange,
                  `Undefined identifier: "${node.name}"`,
                  vscode.DiagnosticSeverity.Warning
                )
              );
            }
          }
        }
        
        // Recursively check children
        for (const key in node) {
          if (key === 'loc' || key === 'range') continue;
          const child = node[key];
          if (Array.isArray(child)) {
            child.forEach(c => checkIdentifiers(c, node));
          } else if (child && typeof child === 'object') {
            checkIdentifiers(child, node);
          }
        }
      };
      
      checkIdentifiers(ast);
    } catch (error) {
      // Parsing already failed, errors already reported
    }
  }

  private validateSceneReference(sceneId: string, range: vscode.Range, diagnostics: vscode.Diagnostic[]): void {
    if (sceneId.includes('{') || sceneId.includes('$')) return; // dynamic references ignored for now

    // Simple local/global id
    if (!sceneId.includes('.')) {
      if (!this.sceneIds.has(sceneId)) {
        diagnostics.push(
          this.createDiagnostic(range, `Reference to undefined scene: "${sceneId}"`, vscode.DiagnosticSeverity.Error)
        );
      }
      return;
    }

    // Dotted references: file.scene OR file.nestedSceneId
    const parts = sceneId.split('.');
    if (parts.length !== 2) {
      diagnostics.push(
        this.createDiagnostic(
          range,
          `Invalid scene reference format: "${sceneId}". Expected "sceneId", "file.scene", or "file.nestedSceneId".`,
          vscode.DiagnosticSeverity.Error
        )
      );
      return;
    }

    const filePrefix = parts[0];
    const second = parts[1];

    if (second === 'scene') {
      const targetFileName = `${filePrefix}.scene.dry`;
      const fileFound = Array.from(this._allFileData.keys()).some(uri => {
        const fileName = uri.fsPath.split('/').pop()?.split('\\').pop();
        return fileName === targetFileName;
      });

      if (!fileFound) {
        diagnostics.push(
          this.createDiagnostic(range, `Reference to non-existent file: "${targetFileName}"`, vscode.DiagnosticSeverity.Error)
        );
      }
      return;
    }

    // Look for file.sceneId pattern
    let targetFileUri: vscode.Uri | undefined;
    for (const uri of this._allFileData.keys()) {
      const fileName = uri.fsPath.split('/').pop()?.split('\\').pop();
      if (fileName === `${filePrefix}.scene.dry`) {
        targetFileUri = uri;
        break;
      }
    }

    if (!targetFileUri) {
      diagnostics.push(
        this.createDiagnostic(
          range,
          `File "${filePrefix}.scene.dry" not found for reference "${sceneId}"`,
          vscode.DiagnosticSeverity.Error
        )
      );
      return;
    }

    const entry = this._allFileData.get(targetFileUri);
    if (entry && !entry.localSceneIds.has(second)) {
      diagnostics.push(
        this.createDiagnostic(
          range,
          `Scene "${second}" not found in file "${filePrefix}.scene.dry"`,
          vscode.DiagnosticSeverity.Error
        )
      );
    }
  }

  private createDiagnostic(range: vscode.Range, message: string, severity: vscode.DiagnosticSeverity): vscode.Diagnostic {
    const d = new vscode.Diagnostic(range, message, severity);
    d.source = 'dendry';
    return d;
  }
}
