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
    parse(text) {
        const lines = text.split('\\n');
        const ast = {
            nodes: [],
            metadata: {}
        };
        let currentNode = null;
        let currentProperty = null;
        let startLine = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            // Skip empty lines and comments
            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) {
                continue;
            }
            // Property assignment
            if (trimmed.includes(':') && !trimmed.startsWith('@')) {
                const colonIndex = trimmed.indexOf(':');
                const key = trimmed.substring(0, colonIndex).trim();
                const value = trimmed.substring(colonIndex + 1).trim();
                if (currentNode) {
                    currentNode.properties.set(key, value);
                    if (key === 'id' || key === 'title') {
                        currentProperty = key;
                    }
                }
                else {
                    // Metadata
                    ast.metadata[key] = value;
                }
                continue;
            }
            // Scene/Quality/Choice declaration
            if (trimmed.startsWith('@') || trimmed === '-' || trimmed === '=' ||
                trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                // Save previous node
                if (currentNode) {
                    currentNode.range = new vscode.Range(startLine, 0, i - 1, lines[i - 1].length);
                    ast.nodes.push(currentNode);
                }
                // Determine node type
                let nodeType = 'unknown';
                if (trimmed.startsWith('@')) {
                    const parts = trimmed.substring(1).split(' ');
                    nodeType = parts[0] || 'unknown';
                }
                else if (trimmed.startsWith('- ') || trimmed === '-') {
                    nodeType = 'choice';
                }
                else if (trimmed === '=') {
                    nodeType = 'divider';
                }
                currentNode = {
                    type: nodeType,
                    properties: new Map(),
                    content: '',
                    range: new vscode.Range(i, 0, i, line.length)
                };
                startLine = i;
                continue;
            }
            // Content
            if (currentNode && trimmed) {
                currentNode.content += (currentNode.content ? '\\n' : '') + trimmed;
            }
        }
        // Add last node
        if (currentNode) {
            currentNode.range = new vscode.Range(startLine, 0, lines.length - 1, lines[lines.length - 1].length);
            ast.nodes.push(currentNode);
        }
        return ast;
    }
}
exports.DendryParser = DendryParser;
//# sourceMappingURL=parser.js.map