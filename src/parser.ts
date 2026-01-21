import * as vscode from 'vscode';

// ----------------- AST -----------------
export interface DendryNode {
  type: 'scene' | 'choice' | 'divider' | 'quality';
  properties: Map<string, any>;
  content: string;
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
    const errors: any[] = [];

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
        const { key, value } = this.parsePropertyLine(line, this.currentLine);
        this.metadata[key] = value;
        this.currentLine++;
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
        const { key, value } = this.parsePropertyLine(line, this.currentLine);
        properties.set(key, value);
        this.currentLine++;
      } else {
        break;
      }
    }

    // Parse scene content and choices
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
        this.currentLine++;
      }
    }

    const endLine = this.currentLine - 1;
    this.nodes.push({
      type: 'scene',
      declarationType: 'explicit',
      properties,
      content: '',
      range: new vscode.Range(startLine, 0, Math.max(startLine, endLine), 0)
    });
  }

  private parseChoice() {
    const lineNum = this.currentLine;
    const line = this.lines[this.currentLine];
    
    // Remove leading '- ' and trim
    const content = line.substring(line.indexOf('-') + 1).trim();

    this.nodes.push({
      type: 'choice',
      properties: new Map(),
      content,
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
      range: new vscode.Range(lineNum, 0, lineNum, line.length)
    });

    this.currentLine++;
  }

  private parsePropertyLine(line: string, lineNum: number): { key: string; value: any; endLine: number } {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      return { key: '', value: '', endLine: lineNum };
    }

    const key = line.substring(0, colonIndex).trim();
    const valueStart = line.substring(colonIndex + 1).trim();

    // Check for JS block
    if (valueStart.startsWith('{!')) {
      const { value, endLine } = this.parseJsBlock(valueStart, lineNum);
      return { key, value, endLine };
    }

    return { key, value: valueStart, endLine: lineNum };
  }

  private parseJsBlock(firstLine: string, startLine: number): { value: string; endLine: number } {
    let jsCode = '';
    let currentLineNum = startLine;

    // Check if it closes on the same line
    const sameLineMatch = firstLine.match(/\{!(.*?)!\}/s);
    if (sameLineMatch) {
      return { value: sameLineMatch[1], endLine: startLine };
    }

    // Multi-line JS block
    jsCode = firstLine.substring(2); // Remove {!
    currentLineNum++;

    while (currentLineNum < this.lines.length) {
      const line = this.lines[currentLineNum];
      const closeIndex = line.indexOf('!}');
      
      if (closeIndex !== -1) {
        jsCode += '\n' + line.substring(0, closeIndex);
        this.currentLine = currentLineNum;
        return { value: jsCode, endLine: currentLineNum };
      }

      jsCode += '\n' + line;
      currentLineNum++;
    }

    // Unclosed JS block
    this.currentLine = currentLineNum;
    return { value: jsCode, endLine: currentLineNum };
  }

  private isSceneMarker(line: string): boolean {
    return /^@\w*/.test(line.trim());
  }

  private isChoice(line: string): boolean {
    return /^-\s/.test(line);
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

// ----------------- PARSER ENTRY -----------------
export function parseText(
  text: string,
  fileName: string
): { ast: DendryAST; errors: any[]; lexErrors: any[] } {
  const parser = new DendryHandParser(text, fileName);
  const result = parser.parse();
  
  return {
    ast: result.ast,
    errors: result.errors,
    lexErrors: [] // No lexer in hand-written parser
  };
}
