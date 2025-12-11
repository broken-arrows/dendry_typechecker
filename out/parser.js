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
const vscode = __importStar(require("vscode"));
class DendryParser {
    parse(text, fileName) {
        const lines = text.split('\n');
        const ast = { nodes: [], metadata: { fileName } };
        let currentNode = null;
        let startLine = 0;
        let parsingProperties = false;
        const finalizeCurrentNode = (endLine) => {
            if (currentNode) {
                let finalEndLine = endLine;
                while (finalEndLine > startLine && lines[finalEndLine]?.trim() === '') {
                    finalEndLine--;
                }
                currentNode.range = new vscode.Range(startLine, 0, finalEndLine, lines[finalEndLine]?.length || 0);
                ast.nodes.push(currentNode);
                currentNode = null;
                parsingProperties = false;
            }
        };
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            const trimmed = line.trim();
            if (!trimmed) {
                if (currentNode && currentNode.content) {
                    currentNode.content += '\n';
                }
                continue;
            }
            if (trimmed.startsWith('---')) {
                if (currentNode) {
                    parsingProperties = false;
                    // The content starts on the next line
                    // so we skip this line
                    continue;
                }
            }
            // Priority 1: Node Declarations
            if (trimmed.startsWith('@') || trimmed.startsWith('-') || trimmed === '=') {
                finalizeCurrentNode(i - 1);
                startLine = i;
                parsingProperties = true;
                let nodeType = 'unknown';
                let nodeId = '';
                let declarationType;
                if (trimmed.startsWith('@')) {
                    const parts = trimmed.substring(1).split(' ');
                    if (parts.length === 1) {
                        nodeType = 'scene'; // Default to 'scene' if no explicit type given
                        nodeId = parts[0];
                        declarationType = 'implicit';
                    }
                    else if (parts.length >= 2) {
                        nodeType = parts[0];
                        nodeId = parts[1];
                        if (nodeType === 'scene') { // Only mark explicit if the type is 'scene'
                            declarationType = 'explicit';
                        }
                    }
                }
                else if (trimmed.startsWith('-')) {
                    nodeType = 'choice';
                }
                else if (trimmed === '=') {
                    nodeType = 'divider';
                }
                currentNode = { type: nodeType, properties: new Map(), content: '', range: new vscode.Range(i, 0, i, line.length), declarationType };
                if (nodeId)
                    currentNode.properties.set('id', nodeId);
                continue;
            }
            // Priority 2: Properties
            const propertyMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
            if (propertyMatch) {
                const key = propertyMatch[1];
                let value = propertyMatch[2];
                if (!currentNode) {
                    startLine = i;
                    currentNode = { type: 'scene', properties: new Map(), content: '', range: new vscode.Range(i, 0, i, line.length) };
                    parsingProperties = true;
                }
                // Handle multi-line JS properties
                if (value.trim().startsWith('{!')) {
                    let jsContent = value.substring(value.indexOf('{!') + 2);
                    let foundClosing = false;
                    if (jsContent.includes('!}')) { // One-liner {! !}
                        jsContent = jsContent.substring(0, jsContent.indexOf('!}')).trim();
                        foundClosing = true;
                    }
                    if (!foundClosing) {
                        let currentLineIdx = i + 1;
                        while (currentLineIdx < lines.length) {
                            const currentJsLine = lines[currentLineIdx];
                            if (currentJsLine.includes('!}')) {
                                jsContent += '\n' + currentJsLine.substring(0, currentJsLine.indexOf('!}')).trim();
                                i = currentLineIdx; // Update main loop counter to skip processed lines
                                break;
                            }
                            jsContent += '\n' + currentJsLine;
                            currentLineIdx++;
                        }
                    }
                    currentNode.properties.set(key, jsContent.trim());
                }
                else {
                    currentNode.properties.set(key, value);
                }
                continue;
            }
            // Priority 3: Comments
            if (trimmed.startsWith('#')) {
                continue;
            }
            // Default: Content
            if (currentNode) {
                if (currentNode.content || trimmed) {
                    currentNode.content = (currentNode.content ? currentNode.content + '\n' : '') + line;
                }
            }
            else {
                // If we are here, it means we have content outside of a node, which is a parsing error.
                throw new Error(`Invalid syntax on line ${i + 1}: "${line.trim()}". Content can only appear inside a scene or choice.`);
            }
        }
        finalizeCurrentNode(lines.length - 1);
        return ast;
    }
}
exports.DendryParser = DendryParser;
//# sourceMappingURL=parser.js.map