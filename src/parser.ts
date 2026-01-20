import * as vscode from 'vscode';
import { CstParser, CstNode, IToken } from 'chevrotain';
import { allTokens, DendryLexer, Identifier, SceneMarker, ChoiceMarker, DividerMarker, Colon, FreeText, JsBlockStart, JsBlockEnd, JsCode, NewLine, TripleDash } from './lexer';

// ----------------- AST
export interface DendryNode {
    type: string;
    properties: Map<string, any>;
    content: string;
    range: vscode.Range;
    declarationType?: 'explicit' | 'implicit';
}

export interface DendryAST {
    nodes: DendryNode[];
    metadata: {
        fileName?: string;
        title?: string;
        author?: string;
        rootScene?: string;
    };
}


// ----------------- CST TYPES (for the visitor) -----------------
// These are not strictly necessary but are good for TypeScript typing
export interface DendryFileCstNode extends CstNode {
  name: 'dendryFile';
  children: {
    node?: CstNode[];
  };
}

// ----------------- PARSER -----------------

export class DendryParser extends CstParser {
  constructor() {
    super(allTokens);
    this.performSelfAnalysis();
  }

  // --- Entry Rule ---
  public dendryFile = this.RULE('dendryFile', () => {
    this.MANY(() => {
      this.SUBRULE(this.node);
    });
  });

  // --- Node Rules ---
  private node = this.RULE('node', () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.sceneNode) },
      { ALT: () => this.SUBRULE(this.choiceNode) },
      { ALT: () => this.SUBRULE(this.dividerNode) }
    ]);
  });

  private sceneNode = this.RULE('sceneNode', () => {
    this.CONSUME(SceneMarker);
    this.OPTION(() => {
        this.CONSUME(Identifier); // Scene ID
    });
    this.MANY(() => this.SUBRULE(this.property));
    this.OPTION2(() => this.SUBRULE(this.content));
  });

  private choiceNode = this.RULE('choiceNode', () => {
    this.CONSUME(ChoiceMarker);
    this.MANY(() => this.SUBRULE(this.property));
    this.OPTION(() => this.SUBRULE(this.content));
  });

  private dividerNode = this.RULE('dividerNode', () => {
    this.CONSUME(DividerMarker);
  });

  // --- Property & Content Rules ---
  private property = this.RULE('property', () => {
    this.CONSUME(Identifier);
    this.CONSUME(Colon);
    this.SUBRULE(this.propertyValue);
  });

  private propertyValue = this.RULE('propertyValue', () => {
    this.OR([
      { ALT: () => this.CONSUME(FreeText) },
      { ALT: () => this.SUBRULE(this.jsBlock) }
    ]);
  });

  private jsBlock = this.RULE('jsBlock', () => {
    this.CONSUME(JsBlockStart);
    this.OPTION(() => this.CONSUME(JsCode));
    this.CONSUME(JsBlockEnd);
  });

  private content = this.RULE('content', () => {
      this.AT_LEAST_ONE(() => {
          this.OR([
              { ALT: () => this.CONSUME(FreeText) },
              { ALT: () => this.CONSUME(NewLine) },
              { ALT: () => this.CONSUME(TripleDash) },
          ]);
      });
  });

}

// ----------------- VISITOR TO CREATE AST -----------------
const parser = new DendryParser();
const BaseCstVisitor = parser.getBaseCstVisitorConstructor();

class CstToAstVisitor extends BaseCstVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  dendryFile(children: DendryFileCstNode['children']): DendryAST {
    const nodes = children.node?.map(node => this.visit(node, node)) || [];
    return { nodes: nodes.filter(n => n), metadata: {} };
  }

  sceneNode(children: any, cstNode: CstNode): DendryNode {
    const properties = new Map<string, any>();
    if (children.Identifier) {
        properties.set('id', children.Identifier[0].image);
    }
    const props = children.property?.map((p: any) => this.visit(p, p)) || [];
    props.forEach((p: any) => properties.set(p.key, p.value));

    // Use the passed CST node's location for the range
    const location = (cstNode as CstNode).location;
    if (!location) throw new Error("CST Node is missing location info.");
    if (!location.startLine || !location.startColumn || !location.endLine || !location.endColumn) {
        throw new Error("CST Node has incomplete location info.");
    }

    return {
        type: 'scene',
        properties,
        content: children.content ? this.visit(children.content[0], children.content[0]) : '',
        range: new vscode.Range(
            location.startLine - 1,
            location.startColumn - 1,
            location.endLine! - 1,
            location.endColumn! - 1
        )
    };
  }

  choiceNode(children: any, cstNode: CstNode): DendryNode {
    const properties = new Map<string, any>();
    const props = children.property?.map((p: any) => this.visit(p, p)) || [];
    props.forEach((p: any) => properties.set(p.key, p.value));

    // Use the passed CST node's location for the range
    const location = (cstNode as CstNode).location;
    if (!location) throw new Error("CST Node is missing location info.");
    if (!location.startLine || !location.startColumn || !location.endLine || !location.endColumn) {
        throw new Error("CST Node has incomplete location info.");
    }

    return {
        type: 'choice',
        properties,
        content: children.content ? this.visit(children.content[0], children.content[0]) : '',
        range: new vscode.Range(
            location.startLine - 1,
            location.startColumn - 1,
            location.endLine! - 1,
            location.endColumn! - 1
        )
    };
  }
  
  dividerNode(children: any, cstNode: CstNode): DendryNode {
    // Use the passed CST node's location for the range
    const location = (cstNode as CstNode).location;
    if (!location) throw new Error("CST Node is missing location info.");
    if (!location.startLine || !location.startColumn || !location.endLine || !location.endColumn) {
        throw new Error("CST Node has incomplete location info.");
    }

    return {
        type: 'divider',
        properties: new Map(),
        content: '',
        range: new vscode.Range(
            location.startLine - 1,
            location.startColumn - 1,
            location.endLine! - 1,
            location.endColumn! - 1
        )
    };
  }

  property(children: any): { key: string, value: any } {
    const key = children.Identifier[0].image;
    const value = this.visit(children.propertyValue[0], children.propertyValue[0]);
    return { key, value };
  }

  propertyValue(children: any) {
    if (children.FreeText) {
      return children.FreeText[0].image;
    }
    if (children.jsBlock) {
      return this.visit(children.jsBlock[0], children.jsBlock[0]);
    }
    return '';
  }

  jsBlock(children: any) {
    return children.JsCode ? children.JsCode[0].image : '';
  }

  content(children: any): string {
    // This is tricky because we need to reconstruct the content with correct spacing and newlines.
    // For now, let's just join the text. A more sophisticated approach might be needed.
    let fullContent = '';
    const allTokens: IToken[] = [];
    if(children.FreeText) allTokens.push(...children.FreeText);
    if(children.NewLine) allTokens.push(...children.NewLine);
    if(children.TripleDash) allTokens.push(...children.TripleDash);

    // Sort tokens by their start offset to reconstruct the content in order
    allTokens.sort((a, b) => a.startOffset - b.startOffset);
    
    // This is still a simplification. A perfect reconstruction would need to look at
    // the original text between the tokens.
    fullContent = allTokens.map(t => t.image).join('');
    return fullContent;
  }
}

const toAstVisitor = new CstToAstVisitor();

// ----------------- PARSER INSTANCE -----------------

export function parseText(text: string, fileName: string): { ast: DendryAST, errors: any[], lexErrors: any[] } {
    const lexResult = DendryLexer.tokenize(text);
    // setting a new input will RESET the parser instance's state.
    parser.input = lexResult.tokens;
    const cst = parser.dendryFile();

    if (parser.errors.length > 0) {
        return {
            ast: { nodes: [], metadata: { fileName } },
            errors: parser.errors,
            lexErrors: lexResult.errors
        };
    }
    
    const ast = toAstVisitor.visit(cst, cst);
    ast.metadata.fileName = fileName;

    return {
        ast,
        errors: [],
        lexErrors: lexResult.errors
    };
}