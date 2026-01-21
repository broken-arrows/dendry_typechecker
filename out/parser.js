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
exports.parseText = parseText;
const vscode = __importStar(require("vscode"));
// ----------------- PARSER -----------------
class DendryHandParser {
    constructor(text, fileName) {
        this.text = text;
        this.fileName = fileName;
        this.currentLine = 0;
        this.nodes = [];
        this.metadata = {};
        this.lines = text.split(/\r?\n/);
    }
    parse() {
        const errors = [];
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
                }
                else if (this.isDivider(line)) {
                    this.parseDivider();
                }
                else if (line.trim() === '' || this.isComment(line)) {
                    this.currentLine++;
                }
                else {
                    // Unexpected content outside a scene
                    this.currentLine++;
                }
            }
            this.metadata.fileName = this.fileName;
            return {
                ast: { nodes: this.nodes, metadata: this.metadata },
                errors: []
            };
        }
        catch (error) {
            return {
                ast: { nodes: this.nodes, metadata: this.metadata },
                errors: [{ message: error.message, line: this.currentLine }]
            };
        }
    }
    parseMetadata() {
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
            }
            else {
                // Not metadata anymore
                break;
            }
        }
    }
    parseRootSection() {
        const contentLines = [];
        const contentStart = this.currentLine;
        while (this.currentLine < this.lines.length) {
            const line = this.lines[this.currentLine];
            // Stop at first explicit scene
            if (this.isSceneMarker(line) || this.isDivider(line)) {
                break;
            }
            if (this.isChoice(line)) {
                this.parseChoice();
            }
            else {
                contentLines.push(line);
                this.currentLine++;
            }
        }
    }
    parseScene() {
        const startLine = this.currentLine;
        const line = this.lines[this.currentLine];
        const match = line.match(/^@(\w+)?(?::(.*))?$/);
        const sceneId = match?.[1]?.trim() || '';
        const title = match?.[2]?.trim() || '';
        const properties = new Map();
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
            }
            else {
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
            }
            else {
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
    parseChoice() {
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
    parseDivider() {
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
    parsePropertyLine(line, lineNum) {
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
    parseJsBlock(firstLine, startLine) {
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
    isSceneMarker(line) {
        return /^@\w*/.test(line.trim());
    }
    isChoice(line) {
        return /^-\s/.test(line);
    }
    isDivider(line) {
        return /^=+$/.test(line.trim());
    }
    isProperty(line) {
        return /^\w+[\w-]*:/.test(line.trim());
    }
    isComment(line) {
        return /^#(?![a-zA-Z_])/.test(line.trim());
    }
}
// ----------------- PARSER ENTRY -----------------
function parseText(text, fileName) {
    const parser = new DendryHandParser(text, fileName);
    const result = parser.parse();
    return {
        ast: result.ast,
        errors: result.errors,
        lexErrors: [] // No lexer in hand-written parser
    };
}
//# sourceMappingURL=parser.js.map