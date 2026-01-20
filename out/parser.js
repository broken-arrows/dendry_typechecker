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
        // --- Entry Rule ---
        this.dendryFile = this.RULE('dendryFile', () => {
            this.MANY(() => {
                this.SUBRULE(this.node);
            });
        });
        // --- Node Rules ---
        this.node = this.RULE('node', () => {
            this.OR([
                { ALT: () => this.SUBRULE(this.sceneNode) },
                { ALT: () => this.SUBRULE(this.choiceNode) },
                { ALT: () => this.SUBRULE(this.dividerNode) }
            ]);
        });
        this.sceneNode = this.RULE('sceneNode', () => {
            this.CONSUME(lexer_1.SceneMarker);
            this.OPTION(() => {
                this.CONSUME(lexer_1.Identifier); // Scene ID
            });
            this.MANY(() => this.SUBRULE(this.property));
            this.OPTION2(() => this.SUBRULE(this.content));
        });
        this.choiceNode = this.RULE('choiceNode', () => {
            this.CONSUME(lexer_1.ChoiceMarker);
            this.MANY(() => this.SUBRULE(this.property));
            this.OPTION(() => this.SUBRULE(this.content));
        });
        this.dividerNode = this.RULE('dividerNode', () => {
            this.CONSUME(lexer_1.DividerMarker);
        });
        // --- Property & Content Rules ---
        this.property = this.RULE('property', () => {
            this.CONSUME(lexer_1.Identifier);
            this.CONSUME(lexer_1.Colon);
            this.SUBRULE(this.propertyValue);
        });
        this.propertyValue = this.RULE('propertyValue', () => {
            this.OR([
                { ALT: () => this.CONSUME(lexer_1.FreeText) },
                { ALT: () => this.SUBRULE(this.jsBlock) }
            ]);
        });
        this.jsBlock = this.RULE('jsBlock', () => {
            this.CONSUME(lexer_1.JsBlockStart);
            this.OPTION(() => this.CONSUME(lexer_1.JsCode));
            this.CONSUME(lexer_1.JsBlockEnd);
        });
        this.content = this.RULE('content', () => {
            this.AT_LEAST_ONE(() => {
                this.OR([
                    { ALT: () => this.CONSUME(lexer_1.FreeText) },
                    { ALT: () => this.CONSUME(lexer_1.NewLine) },
                    { ALT: () => this.CONSUME(lexer_1.TripleDash) },
                ]);
            });
        });
        this.performSelfAnalysis();
    }
}
exports.DendryParser = DendryParser;
// ----------------- VISITOR TO CREATE AST -----------------
const parser = new DendryParser();
const BaseCstVisitor = parser.getBaseCstVisitorConstructor();
class CstToAstVisitor extends BaseCstVisitor {
    constructor() {
        super();
        this.validateVisitor();
    }
    dendryFile(children) {
        const nodes = children.node?.map(node => this.visit(node, node)) || [];
        return { nodes: nodes.filter(n => n), metadata: {} };
    }
    sceneNode(children, cstNode) {
        const properties = new Map();
        if (children.Identifier) {
            properties.set('id', children.Identifier[0].image);
        }
        const props = children.property?.map((p) => this.visit(p, p)) || [];
        props.forEach((p) => properties.set(p.key, p.value));
        // Use the passed CST node's location for the range
        const location = cstNode.location;
        if (!location)
            throw new Error("CST Node is missing location info.");
        if (!location.startLine || !location.startColumn || !location.endLine || !location.endColumn) {
            throw new Error("CST Node has incomplete location info.");
        }
        return {
            type: 'scene',
            properties,
            content: children.content ? this.visit(children.content[0], children.content[0]) : '',
            range: new vscode.Range(location.startLine - 1, location.startColumn - 1, location.endLine - 1, location.endColumn - 1)
        };
    }
    choiceNode(children, cstNode) {
        const properties = new Map();
        const props = children.property?.map((p) => this.visit(p, p)) || [];
        props.forEach((p) => properties.set(p.key, p.value));
        // Use the passed CST node's location for the range
        const location = cstNode.location;
        if (!location)
            throw new Error("CST Node is missing location info.");
        if (!location.startLine || !location.startColumn || !location.endLine || !location.endColumn) {
            throw new Error("CST Node has incomplete location info.");
        }
        return {
            type: 'choice',
            properties,
            content: children.content ? this.visit(children.content[0], children.content[0]) : '',
            range: new vscode.Range(location.startLine - 1, location.startColumn - 1, location.endLine - 1, location.endColumn - 1)
        };
    }
    dividerNode(children, cstNode) {
        // Use the passed CST node's location for the range
        const location = cstNode.location;
        if (!location)
            throw new Error("CST Node is missing location info.");
        if (!location.startLine || !location.startColumn || !location.endLine || !location.endColumn) {
            throw new Error("CST Node has incomplete location info.");
        }
        return {
            type: 'divider',
            properties: new Map(),
            content: '',
            range: new vscode.Range(location.startLine - 1, location.startColumn - 1, location.endLine - 1, location.endColumn - 1)
        };
    }
    property(children) {
        const key = children.Identifier[0].image;
        const value = this.visit(children.propertyValue[0], children.propertyValue[0]);
        return { key, value };
    }
    propertyValue(children) {
        if (children.FreeText) {
            return children.FreeText[0].image;
        }
        if (children.jsBlock) {
            return this.visit(children.jsBlock[0], children.jsBlock[0]);
        }
        return '';
    }
    jsBlock(children) {
        return children.JsCode ? children.JsCode[0].image : '';
    }
    content(children) {
        // This is tricky because we need to reconstruct the content with correct spacing and newlines.
        // For now, let's just join the text. A more sophisticated approach might be needed.
        let fullContent = '';
        const allTokens = [];
        if (children.FreeText)
            allTokens.push(...children.FreeText);
        if (children.NewLine)
            allTokens.push(...children.NewLine);
        if (children.TripleDash)
            allTokens.push(...children.TripleDash);
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
function parseText(text, fileName) {
    const lexResult = lexer_1.DendryLexer.tokenize(text);
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
//# sourceMappingURL=parser.js.map