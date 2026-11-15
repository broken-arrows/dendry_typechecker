import * as vscode from 'vscode';
import { ABSOLUTE_SCENE_ID, RELATIVE_SCENE_ID, sceneIdFromPath } from './scene-ids';
import { dendryFileKind } from './file-kinds';
import { ControlSource, controlPropertySource } from './scene-control';
import { parseRichContent, RichContent } from './rich-content';

// ----------------- AST -----------------
export interface DendryNode {
  type: 'scene' | 'choice' | 'divider' | 'quality' | 'info';
  properties: Map<string, any>;
  content: string;
  richContent: { parsed: RichContent; linked: boolean }[];
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
  private rootPropertyRanges = new Map<string, vscode.Range>();
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
    const properties = new Map<string, any>();
    this.parseSceneProperties(properties, this.rootPropertyRanges);
    this.metadata = Object.fromEntries(properties);
  }

  // Header boundaries, spelling, duplicates and source ranges are shared by
  // the implicit root and explicit sections. Never rescan prose or magic as headers.
  private parseSceneProperties(properties: Map<string, any>, ranges: Map<string, vscode.Range>): void {
    while (this.currentLine < this.lines.length) {
      const lineNum = this.currentLine;
      const line = this.lines[lineNum];
      if (!line.trim()) { this.currentLine++; break; }
      if (line.startsWith('#')) { this.currentLine++; continue; }
      if (!/^[A-Za-z][A-Za-z_ -]*[A-Za-z]\s*:/.test(line)) {
        if (!this.isSceneMarker(line)) this.errors.push({
          message: 'Invalid property definition. A blank line must separate properties and body content.', line: lineNum,
        });
        break;
      }
      const property = this.parsePropertyLine(line, lineNum);
      const key = normalizePropertyName(property.key);
      if (['id', 'sections', 'content', 'options'].includes(key)) {
        this.errors.push({ message: `Property '${key}' is a reserved name.`, line: lineNum });
      } else if (ranges.has(key) || (key === 'type' && ranges === this.rootPropertyRanges)) {
        this.errors.push({ message: `Duplicate property '${key}' is already defined.`, line: lineNum });
      } else {
        properties.set(key, property.value);
        ranges.set(key, this.propertyRange(lineNum, property.endLine));
      }
      this.currentLine = property.endLine + 1;
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
        propertyRanges.set(key, this.propertyRange(lineNum, property.endLine));
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
      richContent: kind === 'quality' ? [this.bodyContent(body.source, false)] : [],
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
      propertyRanges: this.rootPropertyRanges,
      content,
      richContent: [this.bodyContent(body.source, true), ...this.scenePropertyContent(this.rootPropertyRanges)],
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

    const propertyRanges = new Map<string, vscode.Range>();
    this.parseSceneProperties(properties, propertyRanges);

    const body = this.parseBody(sceneId);
    const content = body.content;

    const endLine = this.currentLine - 1;
    this.nodes.push({
        type: 'scene',
        declarationType: 'explicit',
        properties,
        propertyRanges,
        content,
        richContent: [this.bodyContent(body.source, true), ...this.scenePropertyContent(propertyRanges)],
        range: new vscode.Range(startLine, 0, Math.max(startLine, endLine), 0),
        contentRange: this.bodyRange(body.startLine, body.endLine),
    });

  }


  private parseBody(parentSceneId?: string, stopAtDivider = true): { content: string; source: ControlSource; startLine: number; endLine: number } {
    const startLine = this.currentLine;
    const content: ControlSource[] = [];
    let pendingBlank: number | undefined;
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
        this.currentLine++;
        continue;
      }
      if (!line.trim()) {
        if (inOptions) { inOptions = false; afterOptions = true; }
        if (!afterOptions && content.length && pendingBlank === undefined) pendingBlank = this.currentLine;
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
        if (pendingBlank !== undefined) {
          content.push(ControlSource.literal('', pendingBlank));
          pendingBlank = undefined;
        }
        content.push(ControlSource.literal(line, this.currentLine));
        endLine = this.currentLine++;
        separated = false;
      }
    }
    const pieces = content.flatMap((source, index) => {
      if (!index) return [source];
      const previous = content[index - 1], position = previous.position(previous.text.length);
      return [ControlSource.literal('\n', position.line, position.character), source];
    });
    const source = pieces.length ? ControlSource.join(pieces) : ControlSource.literal('', Math.min(startLine, this.lines.length - 2));
    return { content: source.text, source, startLine, endLine };
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
    // Upstream's option title uses '.', so gobbled magic containing a newline
    // cannot be an inline option title. A separate - title: property can be.
    const match = content.match(/^([@#][^\s:]+)(?:\s*:\s*(.*))?$/);
    if (match && (match[1][0] === '#' ? /^#[\w-]+$/.test(match[1]) : RELATIVE_SCENE_ID.test(match[1].slice(1)))) {
      if (targets.has(match[1])) this.errors.push({ message: `Option with id/tag '${match[1]}' already specified.`, line: lineNum });
      targets.add(match[1]);
      const properties = new Map<string, any>([['id', match[1]]]);
      if (match[2]) properties.set('title', match[2]);
      const declarationRange = this.propertyRange(lineNum, endLine);
      const node: DendryNode = {
        type: 'choice', parentSceneId, properties, content,
        propertyRanges: match[2] ? new Map([['title', declarationRange]]) : new Map(),
        richContent: this.scenePropertyContent(match[2] ? new Map([['title', declarationRange]]) : new Map()),
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
      previous.propertyRanges!.set(key, this.propertyRange(lineNum, property.endLine));
      previous.range = this.propertyRange(previous.range.start.line, property.endLine);
      if (['title', 'subtitle', 'unavailable-subtitle'].includes(key)) {
        previous.richContent.push(...this.scenePropertyContent(new Map([[key, previous.propertyRanges!.get(key)!]])));
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
      richContent: [],
      range: new vscode.Range(lineNum, 0, lineNum, line.length)
    });

    this.currentLine++;
  }

  private bodyContent(source: ControlSource, linked: boolean): DendryNode['richContent'][number] {
    return { parsed: parseRichContent(source, 'paragraphs'), linked };
  }

  private scenePropertyContent(ranges: Map<string, vscode.Range>): DendryNode['richContent'] {
    const result: DendryNode['richContent'] = [];
    for (const key of ['title', 'subtitle', 'unavailable-subtitle']) {
      const range = ranges.get(key);
      if (!range) continue;
      const source = controlPropertySource(this.lines.slice(range.start.line, range.end.line + 1).join('\n'), range.start.line);
      result.push({ parsed: parseRichContent(source, 'inline'), linked: false });
    }
    return result;
  }

  // Reads a property line, gobbling continuation lines and tracking
  // magic-block state. Mirrors the upstream dry.js parser: a property
  // value extends across follow-on lines that are either indented (when
  // out of magic) or anything-goes (when in magic, until a line whose
  // last `!}` closes magic). Multiple magic blocks per value are
  // allowed.
  //
  // Retain language delimiters. Code dispatch must distinguish shorthand,
  // one JavaScript block and multiple independent action blocks.
  private propertyRange(start: number, end: number): vscode.Range {
    // Unclosed blocks may consume the appended parser sentinel. Keep source
    // ranges in the real document so diagnostics still work while typing.
    const last = Math.min(end, Math.max(0, this.lines.length - 2));
    return new vscode.Range(start, 0, last, this.lines[last].length);
  }

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

    const value = parts.join('').trim();
    return { key, value, endLine: lastConsumed };
  }

  private isSceneMarker(line: string): boolean {
    return line.startsWith('@');
  }

  private isDivider(line: string): boolean {
    return /^=+$/.test(line.trim());
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
