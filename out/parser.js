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
        const contentLines = [];
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
                contentLines.push(line);
                this.currentLine++;
            }
        }
        const content = contentLines.join('\n');
        const contentInterpolations = this.parseInterpolations(content, contentStart);
        // Also collect interpolations from property values
        const propertyInterpolations = [];
        for (const [key, value] of properties.entries()) {
            // Check properties that can contain text with interpolations
            if (key === 'title' || key === 'subtitle' || key === 'unavailable-subtitle') {
                const propLine = this.findPropertyLine(startLine, key);
                const propInterps = this.parsePropertyInterpolations(value, key, propLine);
                // Adjust column offset to account for "key: " prefix
                const colonOffset = key.length + 2; // "key: "
                propInterps.forEach(interp => {
                    interp.range = new vscode.Range(interp.range.start.line, interp.range.start.character + colonOffset, interp.range.end.line, interp.range.end.character + colonOffset);
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
    findPropertyLine(startLine, propertyKey) {
        // Search from startLine forward to find the line with this property
        for (let i = 0; i < 20; i++) { // Search up to 20 lines ahead
            const lineIndex = startLine + i;
            if (lineIndex >= this.lines.length)
                break;
            const line = this.lines[lineIndex];
            if (line.trim().startsWith(`${propertyKey}:`)) {
                return lineIndex;
            }
        }
        return startLine;
    }
    parseChoice() {
        const lineNum = this.currentLine;
        const line = this.lines[this.currentLine];
        // Find where the actual content starts (after "- ")
        const dashIndex = line.indexOf('-');
        const contentStart = dashIndex + 1; // Position after '-'
        // Skip any whitespace after the dash
        let contentOffset = contentStart;
        while (contentOffset < line.length && line[contentOffset] === ' ') {
            contentOffset++;
        }
        // Extract content from after "- "
        const content = line.substring(contentStart).trim();
        // Parse interpolations from the content
        const interpolations = this.parseInterpolations(content, lineNum);
        // Adjust all interpolation ranges to account for the "- " prefix
        interpolations.forEach(interp => {
            interp.range = new vscode.Range(interp.range.start.line, interp.range.start.character + contentOffset, interp.range.end.line, interp.range.end.character + contentOffset);
        });
        this.nodes.push({
            type: 'choice',
            properties: new Map(),
            content,
            interpolations: interpolations,
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
            interpolations: [],
            range: new vscode.Range(lineNum, 0, lineNum, line.length)
        });
        this.currentLine++;
    }
    parseInterpolations(text, offset) {
        const interpolations = [];
        // Split text into lines and filter out comment lines
        const lines = text.split('\n');
        let processedText = '';
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Skip comment lines
            if (line.trim().startsWith('#')) {
                processedText += '\n';
            }
            else {
                processedText += line + '\n';
            }
        }
        // First, find all inline conditionals and extract their text parts
        const inlineConditionalRegex = /\[\?\s*[^:]+?\s*:\s*([^?]*)\?\]/g;
        let conditionalMatch;
        const conditionalTextRanges = [];
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
    parsePropertyInterpolations(propertyValue, propertyKey, lineNumber) {
        if (typeof propertyValue !== 'string')
            return [];
        const interpolations = [];
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
    parsePropertyLine(line, lineNum) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) {
            return { key: '', value: '', endLine: lineNum };
        }
        const key = line.substring(0, colonIndex).trim();
        let valueStart = line.substring(colonIndex + 1).trim();
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