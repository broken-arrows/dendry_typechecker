import * as vscode from 'vscode';
import { ABSOLUTE_SCENE_ID, RELATIVE_SCENE_ID, sceneIdFromPath } from './scene-ids';
import { dendryFileKind } from './file-kinds';

// ----------------- AST -----------------
export interface DendryNode {
  type: 'scene' | 'choice' | 'divider' | 'quality' | 'info';
  properties: Map<string, any>;
  content: string;
  interpolations: {
    variable: string;
    qdisplay?: string;
    range: vscode.Range;
    fullText?: string;
  }[];
  range: vscode.Range;
  contentRange?: vscode.Range;
  declarationType?: 'explicit' | 'implicit';
  parentSceneId?: string;
  propertyRanges?: Map<string, vscode.Range>;
}

export interface DendryAST {
  nodes: DendryNode[];
  metadata: {
    [key: string]: any;
    fileName?: string;
    title?: string;
    author?: string;
    rootScene?: string;
  };
}

// ----------------- PARSER -----------------
class DendryHandParser {
  private lines: string[];
  private currentLine: number = 0;
  private nodes: DendryNode[] = [];
  private metadata: DendryAST['metadata'] = {};
  private errors: { message: string; line: number }[] = [];

  constructor(private text: string, private fileName: string) {
    this.lines = text.split(/\r?\n/);
  }

  parse(): { ast: DendryAST; errors: any[] } {
    
    try {
      const kind = dendryFileKind(this.fileName);
      if (kind === 'quality' || kind === 'info') {
        this.parseStandalone(kind);
        this.metadata.fileName = this.fileName;
        return { ast: { nodes: this.nodes, metadata: this.metadata }, errors: this.errors };
      }
      const rootId = sceneIdFromPath(this.fileName);
      if (rootId !== undefined && !ABSOLUTE_SCENE_ID.test(rootId)) {
        this.errors.push({ message: `Invalid filename-derived scene ID '${rootId}'.`, line: 0 });
      }
      // Phase 1: Parse metadata at the top
      this.parseMetadata();

      // Phase 2: Parse root content and choices (before first @scene)
      this.parseRootSection();

      // Phase 3: Parse explicit scene declarations
      while (this.currentLine < this.lines.length) {
        const line = this.lines[this.currentLine];
        
        if (this.isSceneMarker(line)) {
          this.parseScene();
        } else if (this.isDivider(line)) {
          this.parseDivider();
        } else if (line.trim() === '' || this.isComment(line)) {
          this.currentLine++;
        } else {
          // Unexpected content outside a scene
          this.currentLine++;
        }
      }

      this.metadata.fileName = this.fileName;
      return {
        ast: { nodes: this.nodes, metadata: this.metadata },
        errors: this.errors
      };
    } catch (error: any) {
      return {
        ast: { nodes: this.nodes, metadata: this.metadata },
        errors: [...this.errors, { message: error.message, line: this.currentLine }]
      };
    }
  }

  private parseMetadata() {
    while (this.currentLine < this.lines.length) {
      const line = this.lines[this.currentLine];

      // Stop at first non-metadata line
      if (line.trim() === '') {
        this.currentLine++;
        break;
      }
      if (this.isComment(line)) {
        this.currentLine++;
        continue;
      }

      if (this.isProperty(line) && !this.isSceneMarker(line) && !this.isChoice(line)) {
        const { key, value, endLine } = this.parsePropertyLine(line, this.currentLine);
        this.metadata[key] = value;
        this.currentLine = endLine + 1;
      } else {
        // Not metadata anymore
        break;
      }
    }
  }

  private parseStandalone(kind: 'quality' | 'info'): void {
    const filename = this.fileName.split(/[/\\]/).pop() || '';
    const id = kind === 'quality' ? filename.slice(0, -'.quality.dry'.length) : 'info';
    const properties = new Map<string, any>([['id', id]]);
    if (kind === 'quality') properties.set('type', 'quality');
    const propertyRanges = new Map<string, vscode.Range>();
    while (this.currentLine < this.lines.length) {
      const lineNum = this.currentLine;
      const line = this.lines[lineNum];
      if (!line.trim()) { this.currentLine++; break; }
      if (line.startsWith('#')) { this.currentLine++; continue; }
      if (!/^\s*[A-Za-z][A-Za-z_ -]*[A-Za-z]\s*:/.test(line)) {
        this.errors.push({ message: 'Invalid property definition. A blank line must separate properties and body content.', line: lineNum });
        this.currentLine++;
        continue;
      }
      const property = this.parsePropertyLine(line, lineNum);
      const key = normalizePropertyName(property.key);
      if (['id', 'sections', 'content', 'options'].includes(key)) {
        this.errors.push({ message: `Property '${key}' is a reserved name.`, line: lineNum });
      } else if (properties.has(key)) {
        this.errors.push({ message: `Property '${key}' is already defined.`, line: lineNum });
      } else {
        properties.set(key, property.value);
        this.metadata[key] = property.value;
        propertyRanges.set(key, new vscode.Range(lineNum, 0, property.endLine, this.lines[property.endLine].length));
      }
      this.currentLine = property.endLine + 1;
    }
    const firstBodyNode = this.nodes.length;
    const body = this.parseBody(undefined, false);
    const options = this.nodes.splice(firstBodyNode);
    if (options.length) this.errors.push({ message: `Options are not supported in ${kind} files.`, line: options[0].range.start.line });
    if (this.currentLine < this.lines.length) {
      this.errors.push({ message: `Sections are not supported in ${kind} files.`, line: this.currentLine });
    }
    const lastLine = Math.max(0, this.lines.length - 2);
    this.nodes.push({
      type: kind, properties, propertyRanges, content: body.content,
      range: new vscode.Range(0, 0, lastLine, this.lines[lastLine].length),
      contentRange: this.bodyRange(body.startLine, body.endLine),
      // info body is opaque in the upstream schema; quality descriptions are rich content.
      interpolations: kind === 'quality' ? this.parseInterpolations(body.content, body.startLine) : [],
    });
    this.currentLine = this.lines.length;
  }

  private parseRootSection() {
    const body = this.parseBody(sceneIdFromPath(this.fileName));

    // Scene files have a filename-derived implicit scene before their sections.
    const rootId = sceneIdFromPath(this.fileName);
    if (rootId === undefined) return;

    const properties = new Map<string, any>(Object.entries(this.metadata));
    properties.set('id', rootId);
    const content = body.content;
    // parseText appends a newline sentinel; source ranges must stop at the
    // original document's last line, including for empty/property-only roots.
    const lastSourceLine = Math.max(0, this.lines.length - 2);
    const endLine = Math.min(Math.max(0, this.currentLine - 1), lastSourceLine);
    const endCharacter = this.currentLine === 0 ? 0 : this.lines[endLine].length;
    this.nodes.unshift({
      type: 'scene',
      declarationType: 'implicit',
      properties,
      content,
      interpolations: this.parseInterpolations(content, body.startLine),
      range: new vscode.Range(0, 0, endLine, endCharacter),
      contentRange: body.startLine > endLine
        ? new vscode.Range(endLine, endCharacter, endLine, endCharacter)
        : this.bodyRange(body.startLine, body.endLine),
    });
  }

  private parseScene() {
    const startLine = this.currentLine;
    const line = this.lines[this.currentLine];
    
    const localId = line.slice(1).trim();
    const rootId = sceneIdFromPath(this.fileName);
    if (!ABSOLUTE_SCENE_ID.test(localId)) {
      this.errors.push({ message: `Invalid scene section declaration '${line}'.`, line: startLine });
    } else if (localId === rootId) {
      this.errors.push({ message: `Section cannot reuse the file ID '${rootId}'.`, line: startLine });
    }
    const sceneId = rootId ? `${rootId}.${localId}` : localId;

    const properties = new Map<string, any>();
    if (sceneId) {
      properties.set('id', sceneId);
    }

    this.currentLine++;

    // Parse scene properties
    while (this.currentLine < this.lines.length) {
      const line = this.lines[this.currentLine];

      if (line.trim() === '') {
        this.currentLine++;
        break;
      }
      if (this.isComment(line)) {
        this.currentLine++;
        continue;
      }

      if (this.isProperty(line) && !this.isSceneMarker(line) && !this.isChoice(line)) {
        const { key, value, endLine } = this.parsePropertyLine(line, this.currentLine);
        properties.set(key, value);
        this.currentLine = endLine + 1;
      } else {
        break;
      }
    }

    const body = this.parseBody(sceneId);
    const content = body.content;
    const contentInterpolations = this.parseInterpolations(content, body.startLine);

    // Also collect interpolations from property values
    const propertyInterpolations: DendryNode['interpolations'] = [];
    for (const [key, value] of properties.entries()) {
        // Check properties that can contain text with interpolations
        if (key === 'title' || key === 'subtitle' || key === 'unavailable-subtitle') {
            const propLine = this.findPropertyLine(startLine, key);
            const propInterps = this.parsePropertyInterpolations(value, key, propLine);
            // Adjust column offset to account for "key: " prefix
            const colonOffset = key.length + 2; // "key: "
            propInterps.forEach(interp => {
                interp.range = new vscode.Range(
                    interp.range.start.line,
                    interp.range.start.character + colonOffset,
                    interp.range.end.line,
                    interp.range.end.character + colonOffset
                );
            });
            propertyInterpolations.push(...propInterps);
        }
    }

    const allInterpolations = [...contentInterpolations, ...propertyInterpolations];

    const endLine = this.currentLine - 1;
    this.nodes.push({
        type: 'scene',
        declarationType: 'explicit',
        properties,
        content,
        interpolations: allInterpolations,
        range: new vscode.Range(startLine, 0, Math.max(startLine, endLine), 0),
        contentRange: this.bodyRange(body.startLine, body.endLine),
    });

  }

  private findPropertyLine(startLine: number, propertyKey: string): number {
      // Search from startLine forward to find the line with this property
      for (let i = 0; i < 20; i++) { // Search up to 20 lines ahead
          const lineIndex = startLine + i;
          if (lineIndex >= this.lines.length) break;
          const line = this.lines[lineIndex];
          if (line.trim().startsWith(`${propertyKey}:`)) {
              return lineIndex;
          }
      }
      return startLine;
}


  private parseBody(parentSceneId?: string, stopAtDivider = true): { content: string; startLine: number; endLine: number } {
    const startLine = this.currentLine;
    const content: string[] = [];
    let separated = true;
    let inOptions = false;
    let afterOptions = false;
    let choice: DendryNode | undefined;
    const targets = new Set<string>();
    let endLine = startLine - 1;
    while (this.currentLine < this.lines.length) {
      const line = this.lines[this.currentLine];
      if (this.isSceneMarker(line) || (stopAtDivider && this.isDivider(line))) break;
      if (line.startsWith('#')) {
        if (!inOptions && !afterOptions) content.push('');
        this.currentLine++;
        continue;
      }
      if (!line.trim()) {
        if (inOptions) { inOptions = false; afterOptions = true; }
        if (!afterOptions) { content.push(line); endLine = this.currentLine; }
        separated = true;
        this.currentLine++;
        continue;
      }
      if (afterOptions) {
        this.errors.push({ message: 'Found content after an options block.', line: this.currentLine++ });
        continue;
      }
      if (separated && /^-(?!-)/.test(line)) inOptions = true;
      if (inOptions) {
        if (!line.startsWith('-')) {
          this.errors.push({ message: 'Hyphens are required in an option block.', line: this.currentLine++ });
        } else {
          choice = this.parseChoice(parentSceneId, choice, targets);
        }
      } else {
        content.push(line);
        endLine = this.currentLine++;
        separated = false;
      }
    }
    return { content: content.join('\n'), startLine, endLine };
  }

  private bodyRange(startLine: number, endLine: number): vscode.Range {
    const lastLine = Math.max(0, this.lines.length - 2);
    const end = Math.min(Math.max(0, endLine), lastLine);
    if (startLine > endLine) {
      const point = Math.min(startLine, lastLine);
      const column = startLine > lastLine ? this.lines[point].length : 0;
      return new vscode.Range(point, column, point, column);
    }
    return new vscode.Range(Math.min(startLine, end), 0, end, this.lines[end].length);
  }

  private parseChoice(parentSceneId: string | undefined, previous: DendryNode | undefined, targets: Set<string>): DendryNode | undefined {
    const lineNum = this.currentLine;
    const line = this.lines[lineNum];
    const raw = line.slice(1).trim();
    // Reuse upstream-style continuation/magic collection for the entire option
    // declaration. The synthetic key is only used to collect its value.
    const collected = this.parsePropertyLine(`option: ${raw}`, lineNum);
    const endLine = collected.endLine;
    this.currentLine = endLine + 1;
    const content = String(collected.value);
    const match = content.match(/^([@#][^\s:]+)(?:\s*:\s*([\s\S]*))?$/);
    if (match && (match[1][0] === '#' ? /^#[\w-]+$/.test(match[1]) : RELATIVE_SCENE_ID.test(match[1].slice(1)))) {
      if (targets.has(match[1])) this.errors.push({ message: `Option with id/tag '${match[1]}' already specified.`, line: lineNum });
      targets.add(match[1]);
      const properties = new Map<string, any>([['id', match[1]]]);
      if (match[2]) properties.set('title', match[2]);
      const declarationRange = new vscode.Range(lineNum, 0, endLine, this.lines[endLine].length);
      const node: DendryNode = {
        type: 'choice', parentSceneId, properties, content,
        propertyRanges: match[2] ? new Map([['title', declarationRange]]) : new Map(),
        interpolations: this.parseInterpolations(this.lines.slice(lineNum, endLine + 1).join('\n'), lineNum),
        range: declarationRange,
      };
      this.nodes.push(node);
      return node;
    }
    const propertyMatch = raw.match(/^([A-Za-z][A-Za-z_ -]*[A-Za-z])\s*:/);
    if (!propertyMatch) {
      this.errors.push({ message: 'Invalid property or option definition.', line: lineNum });
      return previous;
    }
    const property = this.parsePropertyLine(raw, lineNum);
    const key = normalizePropertyName(property.key);
    if (['id', 'sections', 'content', 'options'].includes(key)) {
      this.errors.push({ message: `Property '${key}' is a reserved name.`, line: lineNum });
    } else if (!previous) {
      this.errors.push({ message: 'Property found in options before an option is defined.', line: lineNum });
    } else if (previous.properties.has(key)) {
      this.errors.push({ message: `Choice property '${key}' is already defined.`, line: lineNum });
    } else {
      previous.properties.set(key, property.value);
      previous.propertyRanges!.set(key, new vscode.Range(lineNum, 0, property.endLine, this.lines[property.endLine].length));
      previous.range = new vscode.Range(previous.range.start.line, 0, property.endLine, this.lines[property.endLine].length);
      if (['title', 'subtitle', 'unavailable-subtitle'].includes(key)) {
        previous.interpolations.push(...this.parseInterpolations(this.lines.slice(lineNum, property.endLine + 1).join('\n'), lineNum));
      }
    }
    return previous;
  }


  private parseDivider() {
    const lineNum = this.currentLine;
    const line = this.lines[this.currentLine];

    this.nodes.push({
      type: 'divider',
      properties: new Map(),
      content: '',
      interpolations: [],
      range: new vscode.Range(lineNum, 0, lineNum, line.length)
    });

    this.currentLine++;
  }

  private parseInterpolations(text: string, offset: number): DendryNode['interpolations'] {
      const interpolations: DendryNode['interpolations'] = [];
      
      // Split text into lines and filter out comment lines
      const lines = text.split('\n');
      let processedText = '';
      
      for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip comment lines
          if (line.trim().startsWith('#')) {
              processedText += '\n';
          } else {
              processedText += line + '\n';
          }
      }
      
      // First, find all inline conditionals and extract their text parts
      const inlineConditionalRegex = /\[\?\s*[^:]+?\s*:\s*([^?]*)\?\]/g;
      let conditionalMatch;
      const conditionalTextRanges: Array<{text: string, startOffset: number}> = [];
      
      while ((conditionalMatch = inlineConditionalRegex.exec(processedText)) !== null) {
          const textPart = conditionalMatch[1];
          const textStartOffset = conditionalMatch.index + conditionalMatch[0].indexOf(':') + 1;
          // Trim leading whitespace and adjust offset
          const trimmedStart = textPart.length - textPart.trimStart().length;
          conditionalTextRanges.push({
              text: textPart.trim(),
              startOffset: textStartOffset + trimmedStart
          });
      }
      
      // Parse interpolations from the full text (including those in conditionals)
      const interpolationRegex = /\[\+\s*([^\s:]+)\s*(?::\s*([^\s+]+))?\s*\+\]/g;
      let match;
      
      while ((match = interpolationRegex.exec(processedText)) !== null) {
        const [fullMatch, variable, qdisplay] = match;
        const start = match.index;

        // Calculate line and character position
        const textBeforeMatch = processedText.substring(0, start);
        const lineBreaks = textBeforeMatch.split('\n');
        const line = lineBreaks.length - 1 + offset;
        const character = lineBreaks[lineBreaks.length - 1].length;

        interpolations.push({
          variable,
          qdisplay,
          range: new vscode.Range(line, character, line, character + fullMatch.length),
          fullText: fullMatch 
        });
      }
      
      return interpolations;
  }


  private parsePropertyInterpolations(propertyValue: any, propertyKey: string, lineNumber: number): DendryNode['interpolations'] {
      if (typeof propertyValue !== 'string') return [];
      
      const interpolations: DendryNode['interpolations'] = [];
      const regex = /\[\+\s*([^\s:]+)\s*(?::\s*([^\s+]+))?\s*\+\]/g;
      let match;
      
      while ((match = regex.exec(propertyValue)) !== null) {
          const [fullMatch, variable, qdisplay] = match;
          const startCol = match.index;
          
          interpolations.push({
              variable,
              qdisplay,
              range: new vscode.Range(lineNumber, startCol, lineNumber, startCol + fullMatch.length),
              fullText: fullMatch
          });
      }
      
      return interpolations;
}


  // Reads a property line, gobbling continuation lines and tracking
  // magic-block state. Mirrors the upstream dry.js parser: a property
  // value extends across follow-on lines that are either indented (when
  // out of magic) or anything-goes (when in magic, until a line whose
  // last `!}` closes magic). Multiple magic blocks per value are
  // allowed.
  //
  // Backward-compat: if the entire collected value is a single
  // `{! ... !}` block (no surrounding text), the braces are stripped
  // and the inside is returned. This preserves the prior behavior for
  // the common case `view-if: {! foo() !}`. Values that mix Dendry
  // shorthand with `{! ... !}` blocks are returned with braces intact;
  // the validator will chunk-split them in step 3.
  private parsePropertyLine(line: string, lineNum: number): { key: string; value: any; endLine: number } {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      return { key: '', value: '', endLine: lineNum };
    }

    const key = line.substring(0, colonIndex).trim();
    const firstValuePart = line.substring(colonIndex + 1);

    let inMagic = endsInMagic(false, firstValuePart);
    const parts: string[] = [inMagic ? firstValuePart + '\n' : firstValuePart];

    let lastConsumed = lineNum;
    for (let j = lineNum + 1; j < this.lines.length; j++) {
      let thisLine = this.lines[j];

      if (!inMagic) {
        // Out of magic: only consume if the line is indented.
        if (!isIndentedContinuation(thisLine)) break;
      }

      const startedInMagic = inMagic;
      inMagic = endsInMagic(inMagic, thisLine);
      lastConsumed = j;

      if (!startedInMagic) {
        // Joining out-of-magic continuation: strip surrounding
        // whitespace and prefix with a single space.
        thisLine = ' ' + thisLine.trim();
      } else {
        // In magic: preserve content but trim trailing whitespace.
        thisLine = thisLine.replace(/\s*$/, '');
      }
      if (inMagic) thisLine = thisLine + '\n';
      parts.push(thisLine);
    }

    let value = parts.join('').trim();

    // Backward-compat: unwrap a single, complete magic block.
    const pureBlock = value.match(/^\{!([\s\S]*)!\}$/);
    if (pureBlock) value = pureBlock[1];

    return { key, value, endLine: lastConsumed };
  }

  private isSceneMarker(line: string): boolean {
    return line.startsWith('@');
  }

  private isChoice(line: string): boolean {
    return /^-/.test(line.trim());
  }

  private isDivider(line: string): boolean {
    return /^=+$/.test(line.trim());
  }

  private isProperty(line: string): boolean {
    return /^\w+[\w-]*:/.test(line.trim());
  }

  private isComment(line: string): boolean {
    return /^#(?![a-zA-Z_])/.test(line.trim());
  }
}

// ----------------- MAGIC-BLOCK STATE HELPERS -----------------

// Retain kebab-case keys in this extension's AST while accepting upstream's
// camel/Pascal case, space, underscore and hyphen property spellings.
export function normalizePropertyName(name: string): string {
  const camelCase = /^[a-z]+(?:[A-Z][a-z]+)*$/;
  if (!camelCase.test(name)) {
    const initialLower = name[0].toLowerCase() + name.slice(1);
    name = camelCase.test(initialLower) ? initialLower : name.toLowerCase().replace(/[_ -]+(.)/g, (_, letter: string) => letter.toUpperCase());
  }
  return name.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
}

// True when a line *ends* inside a `{! ... !}` magic block, given the
// state when the line started. Mirrors `dry.js:108 endsInMagic`.
function endsInMagic(startedInMagic: boolean, line: string): boolean {
  const lastStart = line.lastIndexOf('{!');
  const lastEnd = line.lastIndexOf('!}');
  if (lastEnd > lastStart) return false;
  if (lastStart > lastEnd) return true;
  // Both -1: state unchanged.
  return startedInMagic;
}

// True when a line is an indented continuation (whitespace followed by
// non-whitespace). Blank lines and lines starting at column 0
// terminate a property value.
function isIndentedContinuation(line: string): boolean {
  return /^\s+\S/.test(line);
}

// ----------------- PARSER ENTRY -----------------
export function parseText(
  text: string,
  fileName: string
): { ast: DendryAST; errors: any[]} {
  // we need to add one extra line at the end to ensure the parser captures the last line properly
  text += '\n';
  const parser = new DendryHandParser(text, fileName);
  const result = parser.parse();
  
  
  return {
    ast: result.ast,
    errors: result.errors,
  };
}
