import * as vscode from 'vscode';
import { DendryAST, DendryNode } from './parser';
import { checkScript, Finding, FindingSeverity } from './js-check';
import { convertCondition, convertAction, ConversionResult } from './dendry-logic/shorthand';
import { splitActionChunks } from './dendry-logic/chunks';

type FileData = {
  ast: DendryAST;
  localSceneIds: Set<string>;
  localQualityIds: Set<string>;
};

export class DendryValidator {
  private strictMode: boolean;
  private extraLibraries: string[];
  private sceneIds: Set<string> = new Set();
  private qualityIds: Set<string> = new Set();
  private qdisplayFiles: Set<string> = new Set();
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
    'call',
    'check-success-go-to',
    'check-failure-go-to',
    'is-special',
    'go-to',
    'set-bg',
    'audio',
    'call',
    'is-hand',
    'card-image',
    'face-image',
    'is-deck',
    'max-cards',
    'is-pinned-card',
    'is-card',
    'broad-difficulty',
    'check-quality',
    'game-over',
    'achievement'
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

  constructor() {
    const config = vscode.workspace.getConfiguration('dendry');
    this.strictMode = config.get<boolean>('validation.strict', false);
    this.extraLibraries = config.get<string[]>('validation.jsLibraries', ['d3']);
  }

  validate(
    ast: DendryAST,
    document: vscode.TextDocument,
    allFileData: Map<vscode.Uri, FileData>,
    qdisplayFiles: string[]
  ): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    this._allFileData = allFileData;
    this.qdisplayFiles = new Set(qdisplayFiles);

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
      if (node.interpolations && node.interpolations.length > 0) {
        this.validateInterpolations(node.interpolations, diagnostics);
      }
    }

    if (ast.metadata.rootScene) {
      this.validateSceneReference(ast.metadata.rootScene, new vscode.Range(0, 0, 0, 0), diagnostics);
    }

    return diagnostics;
  }

  public validateQDisplayFile(document: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();
    const lines = text.split(/\r?\n/);

    // 1. Check for empty first line
    if (lines.length > 0 && lines[0].trim() !== '') {
        diagnostics.push(
            this.createDiagnostic(
                new vscode.Range(0, 0, 0, lines[0].length),
                '`.qdisplay.dry` files must start with an empty line.',
                vscode.DiagnosticSeverity.Error
            )
        );
    }

    const rangeRegex = /^\(([\d.-]*)\.\.([\d.-]*)\)\s*(.*)/;
    let previousEnd: number | null = null;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        if (trimmedLine === '' || trimmedLine.startsWith('#')) {
            continue;
        }

        const match = trimmedLine.match(rangeRegex);

        if (!match) {
            diagnostics.push(
                this.createDiagnostic(
                    new vscode.Range(i, 0, i, line.length),
                    'Invalid format. Expected `(start..end) text` or `(..end) text` or `(start..) text`.',
                    vscode.DiagnosticSeverity.Error
                )
            );
            continue;
        }

        const [, startStr, endStr, html] = match;
        const start = startStr === '' ? -Infinity : parseFloat(startStr);
        const end = endStr === '' ? Infinity : parseFloat(endStr);

        if (isNaN(start) || isNaN(end)) {
            diagnostics.push(
                this.createDiagnostic(
                    new vscode.Range(i, 0, i, line.length),
                    'Invalid range values. Start and end must be numbers.',
                    vscode.DiagnosticSeverity.Error
                )
            );
            continue;
        }

        if (start > end) {
            diagnostics.push(
                this.createDiagnostic(
                    new vscode.Range(i, 0, i, line.length),
                    'Start of range must be less than end of range.',
                    vscode.DiagnosticSeverity.Error
                )
            );
        }

        if (previousEnd !== null && start < previousEnd) {
            diagnostics.push(
                this.createDiagnostic(
                    new vscode.Range(i, 0, i, line.length),
                    'Overlapping or out-of-order ranges are not allowed.',
                    vscode.DiagnosticSeverity.Warning
                )
            );
        }

        previousEnd = end;
    }

    return diagnostics;
  }

  private validateInterpolations(interpolations: DendryNode['interpolations'], diagnostics: vscode.Diagnostic[]): void {
    const validIdentifierRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

    for (const interpolation of interpolations) {
      // Validate variable name format
      if (!validIdentifierRegex.test(interpolation.variable)) {
        diagnostics.push(
          this.createDiagnostic(
            interpolation.range,
            `Invalid variable name "${interpolation.variable}". Variable names must start with a letter or underscore, followed by letters, numbers, or underscores only.`,
            vscode.DiagnosticSeverity.Error
          )
        );
      }

      // Validate qdisplay reference
      if (interpolation.qdisplay) {
        // First validate the qdisplay name format
        if (!validIdentifierRegex.test(interpolation.qdisplay)) {
          diagnostics.push(
            this.createDiagnostic(
              interpolation.range,
              `Invalid qdisplay name "${interpolation.qdisplay}". QDisplay names must start with a letter or underscore, followed by letters, numbers, or underscores only.`,
              vscode.DiagnosticSeverity.Error
            )
          );
        } else if (!this.qdisplayFiles.has(interpolation.qdisplay)) {
          // Use the fullText to find the exact position of the qdisplay identifier
          const fullText = interpolation.fullText || '';
          const qdisplayIndex = fullText.lastIndexOf(interpolation.qdisplay);

          if (qdisplayIndex !== -1) {
            const qdisplayStart = interpolation.range.start.character + qdisplayIndex;
            const qdisplayEnd = qdisplayStart + interpolation.qdisplay.length;
            const qdisplayRange = new vscode.Range(
              interpolation.range.start.line,
              qdisplayStart,
              interpolation.range.end.line,
              qdisplayEnd
            );
            diagnostics.push(
              this.createDiagnostic(
                qdisplayRange,
                `QDisplay file "${interpolation.qdisplay}.qdisplay.dry" not found.`,
                vscode.DiagnosticSeverity.Error
              )
            );
          } else {
            // Fallback if we can't find it
            diagnostics.push(
              this.createDiagnostic(
                interpolation.range,
                `QDisplay file "${interpolation.qdisplay}.qdisplay.dry" not found.`,
                vscode.DiagnosticSeverity.Error
              )
            );
          }
        }
      }
    }
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

    const id = node.properties.get('id');
    if (id !== undefined && (typeof id !== 'string' || id.trim() === '')) {
      diagnostics.push(this.createDiagnostic(sceneDeclarationRange, `Scene "id" cannot be empty.`, vscode.DiagnosticSeverity.Error));
    }

    // Check for duplicate properties
    const propertyLines = new Map<string, number>();
    const nodeText = document.getText(node.range);
    const nodeLines = nodeText.split('\n');
    let currentLine = node.range.start.line;
    let insideJsBlock = false;

    for (let i = 0; i < nodeLines.length; i++) {
      const line = nodeLines[i].trim();
      // Check for JS block start/end in the line
      if (line.includes('{!')) {
        insideJsBlock = true;
      }
      if (line.includes('!}')) {
        insideJsBlock = false;
        continue; // Skip the closing line
      }

      // Skip duplicate checking inside JS blocks
      if (insideJsBlock) {
        continue;
      }

      const match = line.match(/^([\w-]+):/);
      if (match) {
        const propKey = match[1];
        if (propertyLines.has(propKey) && this.SCENE_PROPERTIES.has(propKey)) {
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
            `Unrecognized scene property: "${key}"`,
            this.strictMode ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Hint
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
        key === 'max-cards' ||
        key === 'broad-difficulty'
      ) {
        this.validateNumber(value, r, key, diagnostics);
      }

      if (
        key === 'new-page' ||
        key === 'is-special' ||
        key === 'is-hand' ||
        key === 'is-deck' ||
        key === 'is-pinned-card' ||
        key === 'is-card' ||
        key === 'game-over'
      ) {
        this.validateBoolean(value, r, key, diagnostics);
      }

      if (key === 'view-if' || key === 'choose-if' || key === 'check-quality') {
          diagnostics.push(...this.validatePredicateValue(String(value ?? ''), r));
      } else if (key.startsWith('on-')) {
          diagnostics.push(...this.validateActionValue(String(value ?? ''), r));
      }

      if (key === 'go-to' || key === 'set-jump' || key === 'call' || key === 'check-success-go-to' || key === 'check-failure-go-to') {
        this.validateGoTo(String(value ?? ''), r, diagnostics);
      }
    }

    this.validateSceneContent(node, document, diagnostics);

    return diagnostics;
  }

  private validateSceneContent(node: DendryNode, document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]): void {
      // Get all content from the scene (between properties and next scene/end)
      const startLine = node.range.start.line;
      const endLine = node.range.end.line;

    for (let i = startLine; i < endLine; i++) {
        const lineText = document.lineAt(i).text;
        if (lineText.trim().startsWith('#')) {
            continue; // Skip comments
        }
        this.validateInlineConditionalsInLine(lineText, i, diagnostics);
    }
  }

  private validateInlineConditionalsInLine(lineText: string, lineNum: number, diagnostics: vscode.Diagnostic[]) {
      // Match ONLY: [? condition : text ?]
      // Brackets are REQUIRED
      const regex = /(\[\?\s*)([^:]+?)\s*:\s*([^?]*)\?\]/gi;
      let match;

      while ((match = regex.exec(lineText)) !== null) {
          const conditionPrefix = match[1]; // '[?'
          const condition = match[2].trim();

          if (!condition) {
              const fullMatchStart = match.index;
              const fullMatchEnd = regex.lastIndex;
              const errRange = new vscode.Range(lineNum, fullMatchStart, lineNum, fullMatchEnd);
              diagnostics.push(this.createDiagnostic(errRange, 'Inline conditional is missing a condition before :', vscode.DiagnosticSeverity.Error));
              continue;
          }

          const preParsedCondition = '(' + condition.slice(2) + ')';

          // Precise condition range: after [? if up to (but not including) first :
          const conditionStartCol = match.index + conditionPrefix.length;
          const conditionEndCol = conditionStartCol + condition.length;
          const conditionRange = new vscode.Range(lineNum, conditionStartCol, lineNum, conditionEndCol);

          // Validate ONLY condition as Dendry logic (condition context: = -> ==)
          const conditionDiagnostics = this.validateDendryCondition(preParsedCondition, conditionRange);
          diagnostics.push(...conditionDiagnostics);
      }
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

      if (key === 'view-if' || key === 'choose-if') {
          diagnostics.push(...this.validatePredicateValue(String(value ?? ''), r));
      } else if (key.startsWith('on-')) {
          diagnostics.push(...this.validateActionValue(String(value ?? ''), r));
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
      const dashIndex = lineText.indexOf('-');
      if (dashIndex !== -1) {
        let contentStart = dashIndex + 1;
        // Skip one space if present
        if (contentStart < lineText.length && lineText[contentStart] === ' ') {
          contentStart++;
        }
        choiceContent = lineText.substring(contentStart).trim();
      }
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

    // Check for scene references - similar to go-to but without conditional support
    // First remove inline dendry conditions and comments
    const cleaned = choiceContent.replace(/\{[^}]*\?\?[^}]*\}/g, ''); // ignore inline dendry brackets

    // Match scene IDs (can start with letter/digit/underscore, continue with word chars or hyphens, including qualified refs)
    const match = cleaned.match(/@([\w-]+(?:\.[\w-]+)?)/);
    if (match) {
      const sceneRef = match[1].trim();

      // Compute precise range for sceneRef on this line
      const fullLineText = document.lineAt(node.range.start.line).text;
      const atIndex = fullLineText.indexOf('@');
      if (atIndex !== -1) {
        const start = atIndex + 1; // Position after '@'
        const end = start + sceneRef.length;
        const sceneRefRange = new vscode.Range(
          node.range.start.line,
          start,
          node.range.start.line,
          end
        );
        // Validate scene reference (supports both simple and qualified references)
        this.validateSceneReference(sceneRef, sceneRefRange, diagnostics);
      } else {
        // Fallback to node range if we can't find the '@' symbol
        this.validateSceneReference(sceneRef, node.range, diagnostics);
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
      if (match && !trimmed.startsWith('@') && this.SCENE_PROPERTIES.has(match[1])) {
        const propKey = match[1];
        if (seenProperties.has(propKey)) {
          const duplicateRange = new vscode.Range(i, 0, i, lines[i].length);
          diagnostics.push(
            this.createDiagnostic(
              duplicateRange,
              `Duplicate property: "${propKey}" (first defined on line ${seenProperties.get(propKey)! + 1})`,
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
      const valueText = line.substring(colonIndex + 1).trim();

      // Calculate proper range for JS blocks
      let range: vscode.Range;

      if (valueText.startsWith('{!')) {
        // Multi-line JS block - calculate the actual JS code range
        const afterOpen = valueText.substring(2); // Remove {!

        if (afterOpen.trim().length > 0 && !afterOpen.includes('!}')) {
          // Code starts on same line as {!
          const startCol = colonIndex + 1 + valueText.indexOf('{!') + 2;
          range = new vscode.Range(lineIndex, startCol, lineIndex, line.length);
        } else if (valueText.includes('!}')) {
          // Single line: {! code !}
          const startCol = colonIndex + 1 + valueText.indexOf('{!') + 2;
          const endCol = colonIndex + 1 + valueText.indexOf('!}');
          range = new vscode.Range(lineIndex, startCol, lineIndex, endCol);
        } else {
          // Multi-line block with code starting on next line.
          // Anchor on the `{!` line itself: the parser leaves a leading
          // `\n` in the unwrapped value so source line 0 maps to the
          // (empty) tail of the `{!` line and source line N maps to the
          // Nth content line below — matches findRangeForProperty.
          const startLine = lineIndex;
          const startCol = 0;

          // Find the closing !}
          let endLine = startLine + 1;
          for (let i = endLine; i < firstSceneLine; i++) {
            if (lines[i].includes('!}')) {
              endLine = i;
              const endCol = lines[i].indexOf('!}');
              range = new vscode.Range(startLine, startCol, endLine, endCol);
              break;
            }
          }

          // If we didn't find closing, use until end of metadata
          if (!range!) {
            range = new vscode.Range(startLine, startCol, firstSceneLine - 1, lines[firstSceneLine - 1].length);
          }
        }
      } else {
        // Regular single-line value
        const valueStart = colonIndex + 1;
        range = new vscode.Range(lineIndex, valueStart, lineIndex, line.length);
      }

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
      if (key === 'view-if' || key === 'choose-if') {
        diagnostics.push(...this.validatePredicateValue(String(value ?? ''), range));
      } else if (key.startsWith('on-')) {
        diagnostics.push(...this.validateActionValue(String(value ?? ''), range));
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
        // Check tags in metadata (top-level scene properties)
        if (fileData.ast.metadata.tags) {
            const metadataTags = String(fileData.ast.metadata.tags)
                .split(/[,\s]+/)
                .map(t => t.trim())
                .filter(t => t.length > 0);

            if (metadataTags.includes(tagName)) {
                tagFound = true;
                break;
            }
        }

        // Check tags in explicit scene declarations
        for (const node of fileData.ast.nodes) {
            if (node.type === 'scene') {
                const tags = node.properties.get('tags');
                if (tags) {
                    const tagList = String(tags)
                        .split(/[,\s]+/)
                        .map(t => t.trim())
                        .filter(t => t.length > 0);

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
                `Tag "${tagName}" is not defined in any scene. Add 'tags: ${tagName}' to a scene to define it.`,
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

          if (ifIndex !== -1) {
            // Format: "scene_id if condition"
            const sceneId = trimmed.substring(0, ifIndex).trim();
            let condition = trimmed.substring(ifIndex + 4).trim();

            if (condition.endsWith(' else')) {
              diagnostics.push(
                  this.createDiagnostic(
                      range,
                      'Malformed "else" statement. Did you mean to include a statement after "else"?',
                      vscode.DiagnosticSeverity.Error
                  )
              );
            } else if (condition.includes(' else ')) {
              condition = condition.split(' else ')[0].trim();
              const elseGoTo = trimmed.split(' else ')[1].trim();
              if (elseGoTo) {
                this.validateGoTo(elseGoTo, range, diagnostics);
              }
            }

            if (sceneId && sceneId !== 'jumpScene' && sceneId !== "backSpecialScene" && sceneId !=='backScene') {
                this.validateSceneReference(sceneId, range, diagnostics);
            }

            if (condition) {
                const conditionDiagnostics = this.validateDendryCondition(condition, range);
                diagnostics.push(...conditionDiagnostics);
            }
          } else {
              // Could be:
              // 1. Just a scene ID: "scene_id"
              // 2. An assignment/action: "variable = value"
              // Check if it looks like a scene reference (no operators)
              const hasOperators = /[=+\-*/<>]/.test(trimmed);
              if (trimmed.endsWith(' if')) {
                diagnostics.push(
                      this.createDiagnostic(
                          range,
                          'Malformed "if" statement. Did you mean to include a condition after "if"?',
                          vscode.DiagnosticSeverity.Error
                      )
                  );
              } else if (!hasOperators && trimmed !== 'jumpScene' && trimmed !== "backSpecialScene" && trimmed !=='backScene') {
                  // Treat as scene reference
                  this.validateSceneReference(trimmed, range, diagnostics);
              } else if (hasOperators) {
                  // It's an action/assignment - validate as Dendry logic
                  const actionDiagnostics = this.validateDendryAction(trimmed, range);
                  diagnostics.push(...actionDiagnostics);
              }
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
        // Anchor on the `{!` line itself: the parser leaves a leading `\n`
        // in the unwrapped value so source line 0 is empty, which makes
        // anchor.start.line + sourceLine map correctly to document lines.
        startLine = propertyAbsLine;
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

    // Get the actual line from the document for accurate column positioning
    const actualLine = document.lineAt(line).text;
    const colonIndex = actualLine.indexOf(':');
    if (colonIndex !== -1) {
        // Calculate from the actual document line
        const afterColon = actualLine.substring(colonIndex + 1);
        const valueStart = afterColon.length - afterColon.trimStart().length;
        const startCol = colonIndex + 1 + valueStart;
        const endCol = startCol + afterColon.trim().length;
        return new vscode.Range(line, startCol, line, endCol);
    } else {
        // Fallback to previous calculation
        const startCol = nodeRange.start.character + valueStartIndex + leftTrim;
        const endCol = startCol + valueText.trim().length;
        return new vscode.Range(line, startCol, line, endCol);
    }
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

  // ---------- JavaScript / Dendry-shorthand validation ----------
  //
  // Top-level entry points (matched to property kind):
  //  - validatePredicateValue: `view-if`, `choose-if`, `check-quality`.
  //    Mixing logic + magic is rejected per upstream `makeCompile`.
  //  - validateActionValue:    `on-arrival`, `on-departure`, `on-display`,
  //    and any other `on-*`. Mixed values are chunk-split per upstream
  //    `validateActions`; alternating chunks dispatch to magic (JS
  //    block) or logic (Dendry shorthand) validation.
  //  - validateDendryCondition / validateDendryAction: legacy single-
  //    chunk dispatch, still used from within go-to validation and
  //    inline-conditional checking.

  private validatePredicateValue(value: string, range: vscode.Range): vscode.Diagnostic[] {
    // The parser unwraps pure `{! ... !}` blocks; if the value still
    // contains `{!` or `!}`, it must have surrounding text — which
    // upstream rejects.
    if (containsMagicMarker(value)) {
      return [
        this.createDiagnostic(
          range,
          'Magic in a predicate must have no other content surrounding it. Wrap the entire value in `{! !}` or use Dendry logic exclusively.',
          vscode.DiagnosticSeverity.Error
        ),
      ];
    }
    return this.runJsValidation(value, range, /* isAction */ false);
  }

  private validateActionValue(value: string, range: vscode.Range): vscode.Diagnostic[] {
    if (!containsMagicMarker(value)) {
      return this.runJsValidation(value, range, /* isAction */ true);
    }

    // Mixed: alternate logic + magic chunks.
    const diagnostics: vscode.Diagnostic[] = [];
    const chunks = splitActionChunks(value);
    for (const chunk of chunks) {
      const chunkAnchor = this.chunkAnchor(value, chunk.offset, range);
      if (chunk.kind === 'magic') {
        diagnostics.push(...this.validateAsJsBlock(chunk.source, chunkAnchor));
      } else {
        diagnostics.push(...this.validateAsShorthand(chunk.source, chunkAnchor, /* isAction */ true));
      }
    }
    return diagnostics;
  }

  private validateDendryCondition(code: string, range: vscode.Range): vscode.Diagnostic[] {
    return this.runJsValidation(code, range, /* isAction */ false);
  }

  private validateDendryAction(code: string, range: vscode.Range): vscode.Diagnostic[] {
    return this.runJsValidation(code, range, /* isAction */ true);
  }

  // Single-chunk validation: pick path based on source shape (the
  // multi-line / has-newline heuristic).
  private runJsValidation(code: string, range: vscode.Range, isAction: boolean): vscode.Diagnostic[] {
    const isJsBlock = range.start.line !== range.end.line || code.includes('\n');
    if (isJsBlock) return this.validateAsJsBlock(code, range);
    return this.validateAsShorthand(code, range, isAction);
  }

  private validateAsJsBlock(code: string, anchor: vscode.Range): vscode.Diagnostic[] {
    const findings = checkScript(code, {
      extraGlobals: this.extraJsGlobals(),
      checkUndefined: true,
      undefinedSeverity: this.strictMode ? 'warning' : 'hint',
    });
    return findings.map(f => this.findingToDiagnostic(f, anchor));
  }

  private validateAsShorthand(code: string, anchor: vscode.Range, isAction: boolean): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const conversion = isAction ? convertAction(code) : convertCondition(code);

    for (const err of conversion.errors) {
      diagnostics.push(this.createDiagnostic(anchor, err.message, vscode.DiagnosticSeverity.Error));
    }

    for (const warn of conversion.prefixWarnings) {
      const warnRange = this.offsetToRange(anchor, code, warn.offset, warn.length);
      diagnostics.push(
        this.createDiagnostic(
          warnRange,
          `Potentially invalid use of prefix "${warn.prefix}". Are you sure you are not referring to "${warn.identifier}"?`,
          vscode.DiagnosticSeverity.Warning
        )
      );
    }

    const findings = checkScript(conversion.jsSource, {
      extraGlobals: this.extraJsGlobals(),
      checkUndefined: false,
    });
    for (const f of findings) {
      // Position-mapping through the shorthand conversion is unreliable,
      // so report the whole property range — matches prior behavior.
      if (f.kind === 'parse-error') {
        diagnostics.push(
          this.createDiagnostic(
            anchor,
            `Dendry logic Error: ${stripJsErrorPrefix(f.message)}`,
            vscode.DiagnosticSeverity.Error
          )
        );
      } else if (f.kind === 'assignment-in-condition') {
        diagnostics.push(
          this.createDiagnostic(anchor, f.message, this.severityFor(f.severity))
        );
      }
      // typos/undefined are skipped in shorthand mode (matches prior behavior)
    }

    return diagnostics;
  }

  // For chunked actions: compute a single-point anchor at the chunk's
  // start position within the document.
  private chunkAnchor(value: string, chunkOffset: number, propertyAnchor: vscode.Range): vscode.Range {
    const before = value.substring(0, chunkOffset);
    const lineDelta = (before.match(/\n/g) ?? []).length;
    const lastNewline = before.lastIndexOf('\n');
    const colInLine = lastNewline === -1 ? chunkOffset : chunkOffset - lastNewline - 1;
    const startLine = propertyAnchor.start.line + lineDelta;
    const startCol = lineDelta === 0
      ? propertyAnchor.start.character + colInLine
      : colInLine;
    return new vscode.Range(startLine, startCol, startLine, startCol);
  }

  private extraJsGlobals(): Iterable<string> {
    return [
      ...this.extraLibraries,
      ...this.qualityIds,
      ...this.sceneIds,
    ];
  }

  private findingToDiagnostic(f: Finding, anchor: vscode.Range): vscode.Diagnostic {
    const startLine = anchor.start.line + f.startLine;
    const endLine = anchor.start.line + f.endLine;
    const startCol = f.startLine === 0 ? anchor.start.character + f.startColumn : f.startColumn;
    const endCol = f.endLine === 0 ? anchor.start.character + f.endColumn : f.endColumn;
    const range = new vscode.Range(startLine, startCol, endLine, endCol);
    // TEMP DEBUG: remove after diagnosing line-position mismatch
    console.log(
      `[dendry-debug] finding(${f.kind}): src=(${f.startLine},${f.startColumn})-(${f.endLine},${f.endColumn})` +
      ` anchor=(${anchor.start.line},${anchor.start.character})` +
      ` -> doc=(${startLine},${startCol})-(${endLine},${endCol})` +
      ` msg="${f.message}"`
    );
    return this.createDiagnostic(range, f.message, this.severityFor(f.severity));
  }

  private severityFor(s: FindingSeverity): vscode.DiagnosticSeverity {
    switch (s) {
      case 'error': return vscode.DiagnosticSeverity.Error;
      case 'warning': return vscode.DiagnosticSeverity.Warning;
      case 'hint': return vscode.DiagnosticSeverity.Hint;
    }
  }

  // Convert a (offset, length) inside `source` into a vscode.Range,
  // anchored at `anchor` (which corresponds to source position 0).
  // Assumes `source` is single-line — used only in the shorthand path.
  private offsetToRange(anchor: vscode.Range, source: string, offset: number, length: number): vscode.Range {
    const before = source.substring(0, offset);
    const lineBreaks = before.split('\n');
    const lineDelta = lineBreaks.length - 1;
    const colInLine = lineBreaks[lineBreaks.length - 1].length;
    const startLine = anchor.start.line + lineDelta;
    const startCol = lineDelta === 0 ? anchor.start.character + colInLine : colInLine;
    return new vscode.Range(startLine, startCol, startLine, startCol + length);
  }


  private validateSceneReference(sceneId: string, range: vscode.Range, diagnostics: vscode.Diagnostic[]): void {
    if (sceneId === 'jumpScene' || sceneId === 'backSpecialScene' || sceneId === 'backScene') {
      return; // Valid reference, no error
    }

    // Check for qualified scene reference (filename.sceneid)
    if (sceneId.includes('.')) {
      const parts = sceneId.split('.');
      if (parts.length === 2) {
        const [fileName, localSceneId] = parts;

        // Find the file with this name
        let fileFound = false;
        let sceneFound = false;

        for (const [uri, fileData] of this._allFileData) {
          // Extract filename without .scene.dry extension
          // Handle both forward and backward slashes
          const pathParts = uri.fsPath.split(/[/\\]/);
          const fullFileName = pathParts.pop();
          const uriFileName = fullFileName?.replace(/\.scene\.dry$/, '');

          if (uriFileName === fileName) {
            fileFound = true;
            // Check if the scene exists in that file
            if (fileData.localSceneIds.has(localSceneId)) {
              sceneFound = true;
              break;
            }
          }
        }


        if (!fileFound) {
          diagnostics.push(this.createDiagnostic(
            range,
            `Reference to undefined file '${fileName}'. Expected a file named '${fileName}.scene.dry'`,
            vscode.DiagnosticSeverity.Error
          ));
        } else if (!sceneFound) {
          diagnostics.push(this.createDiagnostic(
            range,
            `Scene '${localSceneId}' not found in file '${fileName}.scene.dry'`,
            vscode.DiagnosticSeverity.Error
          ));
        }
      } else {
        // Invalid format (multiple dots or other issues)
        diagnostics.push(this.createDiagnostic(
          range,
          `Invalid qualified scene reference '${sceneId}'. Expected format: 'filename.sceneid'`,
          vscode.DiagnosticSeverity.Error
        ));
      }
    } else {
      // Simple local id - check global scene IDs
      if (!this.sceneIds.has(sceneId)) {
        diagnostics.push(this.createDiagnostic(
          range,
          `Reference to undefined scene '${sceneId}'`,
          vscode.DiagnosticSeverity.Error
        ));
      }
    }
  }

  private createDiagnostic(range: vscode.Range, message: string, severity: vscode.DiagnosticSeverity): vscode.Diagnostic {
    const d = new vscode.Diagnostic(range, message, severity);
    d.source = 'dendry';
    return d;
  }
}

// "JavaScript Error: <msg>" comes back from js-check; strip the prefix
// so we can re-prefix as "Dendry logic Error: <msg>" in shorthand mode.
function stripJsErrorPrefix(msg: string): string {
  return msg.replace(/^JavaScript Error:\s*/, '');
}

// True if the value still contains a magic marker. The parser
// unwraps pure `{! ... !}` blocks, so the only way a value reaches
// the validator with `{!` or `!}` in it is if there's surrounding
// content — i.e. mixed shorthand + magic.
function containsMagicMarker(value: string): boolean {
  return value.includes('{!') || value.includes('!}');
}
