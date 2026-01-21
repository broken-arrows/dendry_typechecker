"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DendryParser = void 0;
exports.parseText = parseText;
const vscode = __importStar(require("vscode"));
const chevrotain_1 = require("chevrotain");
const lexer_1 = require("./lexer");
// ----------------- PARSER -----------------
class DendryParser extends chevrotain_1.CstParser {
    constructor() {
        super(lexer_1.allTokens);
        // Helpers: treat markers as "structure" only when they start a line.
        this.startsNodeStructure = () => {
            const t = this.LA(1);
            return ((t.tokenType === lexer_1.SceneMarker ||
                t.tokenType === lexer_1.ChoiceMarker ||
                t.tokenType === lexer_1.DividerMarker ||
                t.tokenType === lexer_1.TripleDash) &&
                t.startColumn === 1);
        };
        // --- Entry rule ---
        this.dendryFile = this.RULE('dendryFile', () => {
            // Consume any leading newlines
            this.MANY(() => this.CONSUME(lexer_1.NewLine));
            // Metadata properties at top: "key: value"
            this.MANY1(() => {
                this.SUBRULE(this.property);
            });
            // Everything else until we hit an explicit scene at column 1
            this.MANY2(() => {
                this.OR([
                    {
                        GATE: () => {
                            const t = this.LA(1);
                            return t.tokenType === lexer_1.ChoiceMarker && t.startColumn === 1;
                        },
                        ALT: () => this.SUBRULE(this.choiceNode)
                    },
                    {
                        GATE: () => {
                            const t = this.LA(1);
                            // Don't match if we're at a scene/divider at column 1
                            return !(t.startColumn === 1 && (t.tokenType === lexer_1.SceneMarker || t.tokenType === lexer_1.DividerMarker));
                        },
                        ALT: () => this.SUBRULE(this.contentOrBlank)
                    }
                ]);
            });
            // Explicit nodes (@scene... or divider)
            this.MANY3(() => this.SUBRULE(this.node));
        });
        this.sceneNode = this.RULE('sceneNode', () => {
            this.CONSUME(lexer_1.SceneMarker);
            this.OPTION(() => this.CONSUME(lexer_1.Identifier));
            this.OPTION2(() => this.CONSUME(lexer_1.Colon));
            this.OPTION3(() => this.CONSUME(lexer_1.NewLine));
            // Properties
            this.MANY(() => this.SUBRULE(this.property));
            // Scene body: content and choices until the next scene
            this.MANY1(() => {
                this.OR([
                    {
                        GATE: () => {
                            const t = this.LA(1);
                            return t.tokenType === lexer_1.ChoiceMarker && t.startColumn === 1;
                        },
                        ALT: () => this.SUBRULE(this.choiceNode)
                    },
                    {
                        GATE: () => {
                            const t = this.LA(1);
                            // Don't match if we're at a scene/divider at column 1
                            return !(t.startColumn === 1 && (t.tokenType === lexer_1.SceneMarker || t.tokenType === lexer_1.DividerMarker));
                        },
                        ALT: () => this.SUBRULE(this.contentOrBlank)
                    }
                ]);
            });
        });
        // New simpler rule that handles both content and blank lines
        this.contentOrBlank = this.RULE('contentOrBlank', () => {
            this.OR([
                { ALT: () => this.CONSUME(lexer_1.NewLine) },
                { ALT: () => this.SUBRULE(this.content) }
            ]);
        });
        this.content = this.RULE('content', () => {
            // At least one actual content token (not newline, not structural at col 1)
            this.AT_LEAST_ONE(() => {
                this.OR([
                    { ALT: () => this.CONSUME(lexer_1.FreeText) },
                    { ALT: () => this.CONSUME(lexer_1.Identifier) },
                    { ALT: () => this.CONSUME(lexer_1.Colon) },
                    { ALT: () => this.CONSUME(lexer_1.TripleDash) },
                    {
                        GATE: () => (this.LA(1).startColumn ?? 1) !== 1,
                        ALT: () => this.CONSUME(lexer_1.ChoiceMarker)
                    },
                    {
                        GATE: () => (this.LA(1).startColumn ?? 1) !== 1,
                        ALT: () => this.CONSUME(lexer_1.DividerMarker)
                    },
                    {
                        GATE: () => (this.LA(1).startColumn ?? 1) !== 1,
                        ALT: () => this.CONSUME(lexer_1.SceneMarker)
                    }
                ]);
            });
            // Consume trailing newlines as part of this content
            this.MANY(() => this.CONSUME(lexer_1.NewLine));
        });
        this.node = this.RULE('node', () => {
            this.OR([
                {
                    GATE: () => this.LA(1).tokenType === lexer_1.SceneMarker && this.LA(1).startColumn === 1,
                    ALT: () => this.SUBRULE(this.sceneNode)
                },
                {
                    GATE: () => this.LA(1).tokenType === lexer_1.DividerMarker && this.LA(1).startColumn === 1,
                    ALT: () => this.SUBRULE(this.dividerNode)
                }
            ]);
        });
        this.choiceNode = this.RULE('choiceNode', () => {
            this.CONSUME(lexer_1.ChoiceMarker);
            // Consume all content tokens on this line until we hit a newline or EOF
            this.MANY(() => {
                this.OR([
                    { ALT: () => this.CONSUME(lexer_1.FreeText) },
                    { ALT: () => this.CONSUME(lexer_1.SceneMarker) },
                    { ALT: () => this.CONSUME(lexer_1.Identifier) },
                    { ALT: () => this.CONSUME(lexer_1.Colon) },
                    { ALT: () => this.CONSUME(lexer_1.TripleDash) },
                    { ALT: () => this.CONSUME(lexer_1.TagMarker) }, // Add this line
                    // Allow '=' mid-line in choice content
                    {
                        GATE: () => (this.LA(1).startColumn ?? 1) !== 1,
                        ALT: () => this.CONSUME(lexer_1.DividerMarker)
                    }
                ]);
            });
            // Always try to consume the newline at the end
            this.OPTION(() => this.CONSUME(lexer_1.NewLine));
        });
        this.dividerNode = this.RULE('dividerNode', () => {
            this.CONSUME(lexer_1.DividerMarker);
            this.OPTION(() => this.CONSUME(lexer_1.NewLine));
        });
        this.property = this.RULE('property', () => {
            // Only treat it as a property if it's "Identifier ':'"
            this.CONSUME(lexer_1.Identifier);
            this.CONSUME(lexer_1.Colon);
            this.SUBRULE(this.propertyValue);
            this.OPTION(() => this.CONSUME(lexer_1.NewLine));
        });
        this.propertyValue = this.RULE('propertyValue', () => {
            this.OR([
                { ALT: () => this.SUBRULE(this.jsBlock) },
                {
                    ALT: () => {
                        this.AT_LEAST_ONE(() => {
                            this.OR1([
                                { ALT: () => this.CONSUME(lexer_1.FreeText) },
                                { ALT: () => this.CONSUME(lexer_1.Identifier) },
                                { ALT: () => this.CONSUME(lexer_1.Colon) },
                                { ALT: () => this.CONSUME(lexer_1.ChoiceMarker) },
                                { ALT: () => this.CONSUME(lexer_1.DividerMarker) },
                                { ALT: () => this.CONSUME(lexer_1.SceneMarker) },
                                { ALT: () => this.CONSUME(lexer_1.TripleDash) }
                            ]);
                        });
                    }
                }
            ]);
        });
        this.jsBlock = this.RULE('jsBlock', () => {
            this.CONSUME(lexer_1.JsBlockStart);
            this.OPTION(() => this.CONSUME(lexer_1.JsCode));
            this.CONSUME(lexer_1.JsBlockEnd);
        });
        this.performSelfAnalysis();
    }
}
exports.DendryParser = DendryParser;
// ----------------- VISITOR (CST -> AST) -----------------
const parserInstance = new DendryParser();
const BaseCstVisitor = parserInstance.getBaseCstVisitorConstructor();
function rangeFromCstLocation(cstNode) {
    const loc = cstNode.location;
    if (!loc?.startLine || !loc?.startColumn || !loc?.endLine || !loc?.endColumn) {
        return new vscode.Range(0, 0, 0, 0);
    }
    return new vscode.Range(loc.startLine - 1, loc.startColumn - 1, loc.endLine - 1, loc.endColumn - 1);
}
function joinTokensPreservingOrder(tokens) {
    const sorted = [...tokens].sort((a, b) => a.startOffset - b.startOffset);
    return sorted.map(t => t.image).join('');
}
class CstToAstVisitor extends BaseCstVisitor {
    constructor() {
        super();
        this.validateVisitor();
    }
    dendryFile(children) {
        const metadata = {};
        // Collect top-level properties as metadata
        if (children.property) {
            const props = children.property.map((p) => this.visit(p));
            for (const p of props) {
                if (p)
                    metadata[p.key] = p.value;
            }
        }
        const nodes = [];
        // Collect root-level choice nodes
        if (children.choiceNode) {
            for (const c of children.choiceNode) {
                const choiceAstNode = this.visit(c);
                if (choiceAstNode)
                    nodes.push(choiceAstNode);
            }
        }
        // Collect explicit scene/divider nodes
        if (children.node) {
            for (const n of children.node) {
                const astNode = this.visit(n);
                if (astNode)
                    nodes.push(astNode);
            }
        }
        return { nodes, metadata };
    }
    node(children) {
        if (children.sceneNode)
            return this.visit(children.sceneNode[0]);
        if (children.dividerNode)
            return this.visit(children.dividerNode[0]);
        return undefined;
    }
    sceneNode(children, cstNode) {
        const props = new Map();
        // children.Identifier may include the scene id
        if (children.Identifier?.[0]) {
            props.set('id', children.Identifier[0].image);
        }
        if (children.property) {
            for (const p of children.property) {
                const kv = this.visit(p);
                if (kv)
                    props.set(kv.key, kv.value);
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
    choiceNode(children, cstNode) {
        const props = new Map();
        // Collect all tokens in order to reconstruct content
        const tokens = [];
        if (children.FreeText)
            tokens.push(...children.FreeText);
        if (children.SceneMarker)
            tokens.push(...children.SceneMarker);
        if (children.Identifier)
            tokens.push(...children.Identifier);
        if (children.Colon)
            tokens.push(...children.Colon);
        if (children.DividerMarker)
            tokens.push(...children.DividerMarker);
        if (children.TripleDash)
            tokens.push(...children.TripleDash);
        if (children.TagMarker)
            tokens.push(...children.TagMarker);
        const content = joinTokensPreservingOrder(tokens);
        return {
            type: 'choice',
            properties: props,
            content,
            range: rangeFromCstLocation(cstNode)
        };
    }
    dividerNode(children, cstNode) {
        return {
            type: 'divider',
            properties: new Map(),
            content: '',
            range: rangeFromCstLocation(cstNode)
        };
    }
    property(children) {
        const key = children.Identifier[0].image;
        const value = this.visit(children.propertyValue[0]);
        return { key, value };
    }
    propertyValue(children) {
        if (children.jsBlock)
            return this.visit(children.jsBlock[0]);
        const tokens = [];
        if (children.FreeText)
            tokens.push(...children.FreeText);
        if (children.Identifier)
            tokens.push(...children.Identifier);
        if (children.Colon)
            tokens.push(...children.Colon);
        if (children.ChoiceMarker)
            tokens.push(...children.ChoiceMarker);
        if (children.DividerMarker)
            tokens.push(...children.DividerMarker);
        if (children.SceneMarker)
            tokens.push(...children.SceneMarker);
        if (children.TripleDash)
            tokens.push(...children.TripleDash);
        return joinTokensPreservingOrder(tokens);
    }
    jsBlock(children) {
        return children.JsCode?.[0]?.image ?? '';
    }
    choiceContent(children) {
        const tokens = [];
        if (children.FreeText)
            tokens.push(...children.FreeText);
        if (children.SceneMarker)
            tokens.push(...children.SceneMarker);
        if (children.Identifier)
            tokens.push(...children.Identifier);
        if (children.Colon)
            tokens.push(...children.Colon);
        if (children.DividerMarker)
            tokens.push(...children.DividerMarker);
        if (children.TripleDash)
            tokens.push(...children.TripleDash);
        if (children.TagMarker)
            tokens.push(...children.TagMarker);
        return joinTokensPreservingOrder(tokens);
    }
    content(children) {
        const tokens = [];
        if (children.FreeText)
            tokens.push(...children.FreeText);
        if (children.Identifier)
            tokens.push(...children.Identifier);
        if (children.NewLine)
            tokens.push(...children.NewLine);
        if (children.TripleDash)
            tokens.push(...children.TripleDash);
        if (children.Colon)
            tokens.push(...children.Colon);
        if (children.ChoiceMarker)
            tokens.push(...children.ChoiceMarker);
        if (children.SceneMarker)
            tokens.push(...children.SceneMarker);
        if (children.DividerMarker)
            tokens.push(...children.DividerMarker);
        if (children.JsBlockStart)
            tokens.push(...children.JsBlockStart);
        if (children.JsBlockEnd)
            tokens.push(...children.JsBlockEnd);
        if (children.JsCode)
            tokens.push(...children.JsCode);
        return joinTokensPreservingOrder(tokens);
    }
    contentOrBlank(children) {
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
function parseText(text, fileName) {
    const lexResult = lexer_1.DendryLexer.tokenize(text);
    parserInstance.input = lexResult.tokens;
    const cst = parserInstance.dendryFile();
    if (parserInstance.errors.length > 0) {
        return {
            ast: { nodes: [], metadata: { fileName } },
            errors: parserInstance.errors,
            lexErrors: lexResult.errors
        };
    }
    const ast = toAstVisitor.visit(cst);
    ast.metadata.fileName = fileName;
    return {
        ast,
        errors: [],
        lexErrors: lexResult.errors
    };
}
//# sourceMappingURL=parser.js.map