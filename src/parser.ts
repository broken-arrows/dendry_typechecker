import * as vscode from 'vscode';
import { CstParser, CstNode, IToken } from 'chevrotain';
import {
  allTokens,
  DendryLexer,
  Identifier,
  SceneMarker,
  ChoiceMarker,
  DividerMarker,
  Colon,
  FreeText,
  JsBlockStart,
  JsBlockEnd,
  JsCode,
  NewLine,
  TripleDash,
  TagMarker
} from './lexer';

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
export class DendryParser extends CstParser {
  constructor() {
    super(allTokens);
    this.performSelfAnalysis();
  }

  // Helpers: treat markers as "structure" only when they start a line.
  private startsNodeStructure = () => {
    const t = this.LA(1) as any;
    return (
      (t.tokenType === SceneMarker ||
      t.tokenType === ChoiceMarker ||
      t.tokenType === DividerMarker ||
      t.tokenType === TripleDash) &&
      t.startColumn === 1
    );
  };


  // --- Entry rule ---
  public dendryFile = this.RULE('dendryFile', () => {
    // Consume any leading newlines
    this.MANY(() => this.CONSUME(NewLine));
    
    // Metadata properties at top: "key: value"
    this.MANY1(() => {
      this.SUBRULE(this.property);
    });
    
    // Everything else until we hit an explicit scene at column 1
    this.MANY2(() => {
      this.OR([
        {
          GATE: () => {
            const t = this.LA(1) as any;
            return t.tokenType === ChoiceMarker && t.startColumn === 1;
          },
          ALT: () => this.SUBRULE(this.choiceNode)
        },
        {
          GATE: () => {
            const t = this.LA(1) as any;
            // Don't match if we're at a scene/divider at column 1
            return !(t.startColumn === 1 && (t.tokenType === SceneMarker || t.tokenType === DividerMarker));
          },
          ALT: () => this.SUBRULE(this.contentOrBlank)
        }
      ]);
    });
    
    // Explicit nodes (@scene... or divider)
    this.MANY3(() => this.SUBRULE(this.node));
  });

  private sceneNode = this.RULE('sceneNode', () => {
    this.CONSUME(SceneMarker);
    this.OPTION(() => this.CONSUME(Identifier));
    this.OPTION2(() => this.CONSUME(Colon));
    this.OPTION3(() => this.CONSUME(NewLine));
    
    // Properties
    this.MANY(() => this.SUBRULE(this.property));
    
    // Scene body: content and choices until the next scene
    this.MANY1(() => {
      this.OR([
        {
          GATE: () => {
            const t = this.LA(1) as any;
            return t.tokenType === ChoiceMarker && t.startColumn === 1;
          },
          ALT: () => this.SUBRULE(this.choiceNode)
        },
        {
          GATE: () => {
            const t = this.LA(1) as any;
            // Don't match if we're at a scene/divider at column 1
            return !(t.startColumn === 1 && (t.tokenType === SceneMarker || t.tokenType === DividerMarker));
          },
          ALT: () => this.SUBRULE(this.contentOrBlank)
        }
      ]);
    });
  });


  // New simpler rule that handles both content and blank lines
  private contentOrBlank = this.RULE('contentOrBlank', () => {
    this.OR([
      { ALT: () => this.CONSUME(NewLine) },
      { ALT: () => this.SUBRULE(this.content) }
    ]);
  });

  private content = this.RULE('content', () => {
    // At least one actual content token (not newline, not structural at col 1)
    this.AT_LEAST_ONE(() => {
      this.OR([
        { ALT: () => this.CONSUME(FreeText) },
        { ALT: () => this.CONSUME(Identifier) },
        { ALT: () => this.CONSUME(Colon) },
        { ALT: () => this.CONSUME(TripleDash) },
        {
          GATE: () => ((this.LA(1) as any).startColumn ?? 1) !== 1,
          ALT: () => this.CONSUME(ChoiceMarker)
        },
        {
          GATE: () => ((this.LA(1) as any).startColumn ?? 1) !== 1,
          ALT: () => this.CONSUME(DividerMarker)
        },
        {
          GATE: () => ((this.LA(1) as any).startColumn ?? 1) !== 1,
          ALT: () => this.CONSUME(SceneMarker)
        }
      ]);
    });
    // Consume trailing newlines as part of this content
    this.MANY(() => this.CONSUME(NewLine));
  });



  private node = this.RULE('node', () => {
    this.OR([
      {
        GATE: () => (this.LA(1) as any).tokenType === SceneMarker && (this.LA(1) as any).startColumn === 1,
        ALT: () => this.SUBRULE(this.sceneNode)
      },
      {
        GATE: () => (this.LA(1) as any).tokenType === DividerMarker && (this.LA(1) as any).startColumn === 1,
        ALT: () => this.SUBRULE(this.dividerNode)
      }
    ]);
  });

  private choiceNode = this.RULE('choiceNode', () => {
    this.CONSUME(ChoiceMarker);
    
    // Consume all content tokens on this line until we hit a newline or EOF
    this.MANY(() => {
      this.OR([
        { ALT: () => this.CONSUME(FreeText) },
        { ALT: () => this.CONSUME(SceneMarker) },
        { ALT: () => this.CONSUME(Identifier) },
        { ALT: () => this.CONSUME(Colon) },
        { ALT: () => this.CONSUME(TripleDash) },
        { ALT: () => this.CONSUME(TagMarker) },  // Add this line
        // Allow '=' mid-line in choice content
        { 
          GATE: () => ((this.LA(1) as any).startColumn ?? 1) !== 1,
          ALT: () => this.CONSUME(DividerMarker) 
        }
      ]);
    });
    
    // Always try to consume the newline at the end
    this.OPTION(() => this.CONSUME(NewLine));
  });

  private dividerNode = this.RULE('dividerNode', () => {
    this.CONSUME(DividerMarker);
    this.OPTION(() => this.CONSUME(NewLine));
  });

  private property = this.RULE('property', () => {
    // Only treat it as a property if it's "Identifier ':'"
    this.CONSUME(Identifier);
    this.CONSUME(Colon);
    this.SUBRULE(this.propertyValue);
    this.OPTION(() => this.CONSUME(NewLine));
  });

  private propertyValue = this.RULE('propertyValue', () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.jsBlock) },
      {
        ALT: () => {
          this.AT_LEAST_ONE(() => {
            this.OR1([
              { ALT: () => this.CONSUME(FreeText) },
              { ALT: () => this.CONSUME(Identifier) },
              { ALT: () => this.CONSUME(Colon) },
              { ALT: () => this.CONSUME(ChoiceMarker) },
              { ALT: () => this.CONSUME(DividerMarker) },
              { ALT: () => this.CONSUME(SceneMarker) },
              { ALT: () => this.CONSUME(TripleDash) }
            ]);
          });
        }
      }
    ]);
  });

  private jsBlock = this.RULE('jsBlock', () => {
    this.CONSUME(JsBlockStart);
    this.OPTION(() => this.CONSUME(JsCode));
    this.CONSUME(JsBlockEnd);
  });
}

// ----------------- VISITOR (CST -> AST) -----------------
const parserInstance = new DendryParser();
const BaseCstVisitor = parserInstance.getBaseCstVisitorConstructor();

function rangeFromCstLocation(cstNode: CstNode): vscode.Range {
  const loc: any = (cstNode as any).location;
  if (!loc?.startLine || !loc?.startColumn || !loc?.endLine || !loc?.endColumn) {
    return new vscode.Range(0, 0, 0, 0);
  }
  return new vscode.Range(loc.startLine - 1, loc.startColumn - 1, loc.endLine - 1, loc.endColumn - 1);
}

function joinTokensPreservingOrder(tokens: IToken[]): string {
  const sorted = [...tokens].sort((a, b) => a.startOffset - b.startOffset);
  return sorted.map(t => t.image).join('');
}

class CstToAstVisitor extends BaseCstVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  dendryFile(children: any): DendryAST {
    const metadata: DendryAST['metadata'] = {};

    // Collect top-level properties as metadata
    if (children.property) {
      const props = children.property.map((p: any) => this.visit(p));
      for (const p of props) {
        if (p) metadata[p.key] = p.value;
      }
    }

    const nodes: DendryNode[] = [];

    // Collect root-level choice nodes
    if (children.choiceNode) {
      for (const c of children.choiceNode) {
        const choiceAstNode = this.visit(c);
        if (choiceAstNode) nodes.push(choiceAstNode);
      }
    }

    // Collect explicit scene/divider nodes
    if (children.node) {
      for (const n of children.node) {
        const astNode = this.visit(n);
        if (astNode) nodes.push(astNode);
      }
    }

    return { nodes, metadata };
  }

  node(children: any): DendryNode {
    if (children.sceneNode) return this.visit(children.sceneNode[0]);
    if (children.dividerNode) return this.visit(children.dividerNode[0]);
    return undefined as any;
  }

  sceneNode(children: any, cstNode: CstNode): DendryNode {
    const props = new Map<string, any>();

    // children.Identifier may include the scene id
    if (children.Identifier?.[0]) {
      props.set('id', children.Identifier[0].image);
    }

    if (children.property) {
      for (const p of children.property) {
        const kv = this.visit(p);
        if (kv) props.set(kv.key, kv.value);
      }
    }

    const content = '';

    return {
      type: 'scene',
      declarationType: 'explicit',
      properties: props,
      content,
      range: rangeFromCstLocation(cstNode)
    };
  }

  choiceNode(children: any, cstNode: CstNode): DendryNode {
    const props = new Map();
    
    // Collect all tokens in order to reconstruct content
    const tokens: IToken[] = [];
    if (children.FreeText) tokens.push(...children.FreeText);
    if (children.SceneMarker) tokens.push(...children.SceneMarker);
    if (children.Identifier) tokens.push(...children.Identifier);
    if (children.Colon) tokens.push(...children.Colon);
    if (children.DividerMarker) tokens.push(...children.DividerMarker);
    if (children.TripleDash) tokens.push(...children.TripleDash);
    if (children.TagMarker) tokens.push(...children.TagMarker);
    
    const content = joinTokensPreservingOrder(tokens);
    
    return {
      type: 'choice',
      properties: props,
      content,
      range: rangeFromCstLocation(cstNode)
    };
  }


  dividerNode(children: any, cstNode: CstNode): DendryNode {
    return {
      type: 'divider',
      properties: new Map(),
      content: '',
      range: rangeFromCstLocation(cstNode)
    };
  }

  property(children: any) {
    const key = children.Identifier[0].image;
    const value = this.visit(children.propertyValue[0]);
    return { key, value };
  }

  propertyValue(children: any) {
    if (children.jsBlock) return this.visit(children.jsBlock[0]);

    const tokens: IToken[] = [];
    if (children.FreeText) tokens.push(...children.FreeText);
    if (children.Identifier) tokens.push(...children.Identifier);
    if (children.Colon) tokens.push(...children.Colon);
    if (children.ChoiceMarker) tokens.push(...children.ChoiceMarker);
    if (children.DividerMarker) tokens.push(...children.DividerMarker);
    if (children.SceneMarker) tokens.push(...children.SceneMarker);
    if (children.TripleDash) tokens.push(...children.TripleDash);

    return joinTokensPreservingOrder(tokens);
  }

  jsBlock(children: any) {
    return children.JsCode?.[0]?.image ?? '';
  }

  choiceContent(children: any): string {
    const tokens: IToken[] = [];
    if (children.FreeText) tokens.push(...children.FreeText);
    if (children.SceneMarker) tokens.push(...children.SceneMarker);
    if (children.Identifier) tokens.push(...children.Identifier);
    if (children.Colon) tokens.push(...children.Colon);
    if (children.DividerMarker) tokens.push(...children.DividerMarker);
    if (children.TripleDash) tokens.push(...children.TripleDash);
    if (children.TagMarker) tokens.push(...children.TagMarker);

    return joinTokensPreservingOrder(tokens);
  }

  content(children: any): string {
    const tokens: IToken[] = [];
    if (children.FreeText) tokens.push(...children.FreeText);
    if (children.Identifier) tokens.push(...children.Identifier);
    if (children.NewLine) tokens.push(...children.NewLine);
    if (children.TripleDash) tokens.push(...children.TripleDash);
    if (children.Colon) tokens.push(...children.Colon);
    if (children.ChoiceMarker) tokens.push(...children.ChoiceMarker);
    if (children.SceneMarker) tokens.push(...children.SceneMarker);
    if (children.DividerMarker) tokens.push(...children.DividerMarker);
    if (children.JsBlockStart) tokens.push(...children.JsBlockStart);
    if (children.JsBlockEnd) tokens.push(...children.JsBlockEnd);
    if (children.JsCode) tokens.push(...children.JsCode);

    return joinTokensPreservingOrder(tokens);
  }

  contentOrBlank(children: any): string {
  // This rule just wraps NewLine or content, so delegate
  if (children.NewLine) {
    return '\n';
  }
  if (children.content) {
    return this.visit(children.content[0]);
  }
  return '';
}

}

const toAstVisitor = new CstToAstVisitor();

// ----------------- PARSER ENTRY -----------------
export function parseText(
  text: string,
  fileName: string
): { ast: DendryAST; errors: any[]; lexErrors: any[] } {
  const lexResult = DendryLexer.tokenize(text);
  parserInstance.input = lexResult.tokens;

  const cst = parserInstance.dendryFile();

  if (parserInstance.errors.length > 0) {
    return {
      ast: { nodes: [], metadata: { fileName } },
      errors: parserInstance.errors,
      lexErrors: lexResult.errors
    };
  }

  const ast = toAstVisitor.visit(cst) as DendryAST;
  ast.metadata.fileName = fileName;

  return {
    ast,
    errors: [],
    lexErrors: lexResult.errors
  };
}
