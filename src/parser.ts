import * as vscode from 'vscode';

// ----------------- AST -----------------
export interface DendryNode {
  type: 'scene' | 'choice' | 'divider' | 'quality';
  properties: Map<string, any>;
  content: string;
  interpolations: {
    variable: string;
    qdisplay?: string;
    range: vscode.Range;
    fullText?: string;
  }[];
  range: vscode.Range;
  declarationType?: 'explicit' | 'implicit';
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

  constructor(private text: string, private fileName: string) {
    this.lines = text.split(/\r?\n/);
  }

  parse(): { ast: DendryAST; errors: any[] } {
    
    try {
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
        errors: []
      };
    } catch (error: any) {
      return {
        ast: { nodes: this.nodes, metadata: this.metadata },
        errors: [{ message: error.message, line: this.currentLine }]
      };
    }
  }

  private parseMetadata() {
    while (this.currentLine < this.lines.length) {
      const line = this.lines[this.currentLine];

      // Stop at first non-metadata line
      if (line.trim() === '' || this.isComment(line)) {
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

  private parseRootSection() {
    const contentLines: string[] = [];
    const contentStart = this.currentLine;

    while (this.currentLine < this.lines.length) {
      const line = this.lines[this.currentLine];

      // Stop at first explicit scene
      if (this.isSceneMarker(line) || this.isDivider(line)) {
        break;
      }

      if (this.isChoice(line)) {
        this.parseChoice();
      } else {
        contentLines.push(line);
        this.currentLine++;
      }
    }
  }

  private parseScene() {
    const startLine = this.currentLine;
    const line = this.lines[this.currentLine];
    
    const match = line.match(/^@(\w+)?(?::(.*))?$/);
    const sceneId = match?.[1]?.trim() || '';
    const title = match?.[2]?.trim() || '';

    const properties = new Map<string, any>();
    if (sceneId) {
      properties.set('id', sceneId);
    }
    if (title) {
      properties.set('title', title);
    }

    this.currentLine++;

    // Parse scene properties
    while (this.currentLine < this.lines.length) {
      const line = this.lines[this.currentLine];

      if (line.trim() === '' || this.isComment(line)) {
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

    const contentLines: string[] = [];
    const contentStart = this.currentLine;
    while (this.currentLine < this.lines.length) {
      const line = this.lines[this.currentLine];

      // Stop at next scene or divider
      if (this.isSceneMarker(line) || this.isDivider(line)) {
        break;
      }

      if (this.isChoice(line)) {
        this.parseChoice();
      } else {
        contentLines.push(line);
        this.currentLine++;
      }
    }
    const content = contentLines.join('\n');
    const contentInterpolations = this.parseInterpolations(content, contentStart);

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
        range: new vscode.Range(startLine, 0, Math.max(startLine, endLine), 0)
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


  private parseChoice() {
    const lineNum = this.currentLine;
    const line = this.lines[this.currentLine];
    
    // Find where the actual content starts (after "-" with optional space)
    const dashIndex = line.indexOf('-');
    
    // Start position is after the dash
    let contentStart = dashIndex + 1;
    
    // Skip exactly one space if present (but only one, to preserve indentation in content)
    if (contentStart < line.length && line[contentStart] === ' ') {
      contentStart++;
    }
    
    // Extract content from after "- " or "-"
    const content = line.substring(contentStart);
    
    // Parse interpolations from the content
    const interpolations = this.parseInterpolations(content, lineNum);
    
    // Adjust all interpolation ranges to account for the "- " or "-" prefix
    interpolations.forEach(interp => {
      interp.range = new vscode.Range(
        interp.range.start.line,
        interp.range.start.character + contentStart,
        interp.range.end.line,
        interp.range.end.character + contentStart
      );
    });
    
    this.nodes.push({
      type: 'choice',
      properties: new Map(),
      content: content.trim(), // Trim for the content property
      interpolations: interpolations,
      range: new vscode.Range(lineNum, 0, lineNum, line.length)
    });
    
    this.currentLine++;
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
    return /^@\w*/.test(line.trim());
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
