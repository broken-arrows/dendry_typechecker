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
        const lines = text.split('\n');
        const ast = {
            nodes: [],
            metadata: {}
        };
        let currentNode = null;
        let startLine = 0;
        let mode = 'dendry';
        let jsContent = '';
        let jsStartLine = 0;
        let currentJsProperty = '';
        const finalizeCurrentNode = (endLine) => {
            if (currentNode) {
                let finalEndLine = endLine;
                while (finalEndLine > startLine && lines[finalEndLine]?.trim() === '') {
                    finalEndLine--;
                }
                currentNode.range = new vscode.Range(startLine, 0, finalEndLine, lines[finalEndLine]?.length || 0);
                ast.nodes.push(currentNode);
                currentNode = null;
            }
        };
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (mode === 'javascript') {
                if (line.includes('!}')) {
                    const endJsIndex = line.indexOf('!}');
                    jsContent += line.substring(0, endJsIndex);
                    ast.nodes.push({ type: 'javascript_block', properties: new Map(), content: jsContent, range: new vscode.Range(jsStartLine, 0, i, endJsIndex + 2) });
                    jsContent = '';
                    mode = 'dendry';
                }
                else {
                    jsContent += line + '\n';
                }
                continue;
            }
            if (mode === 'javascript-property') {
                if (line.includes('!}')) {
                    const endJsIndex = line.indexOf('!}');
                    jsContent += line.substring(0, endJsIndex);
                    currentNode?.properties.set(currentJsProperty, jsContent);
                    jsContent = '';
                    currentJsProperty = '';
                    mode = 'dendry';
                }
                else {
                    jsContent += line + '\n';
                }
                continue;
            }
            if (line.includes('{!') && mode !== 'content') {
                const startJsIndex = line.indexOf('{!');
                const isProperty = line.substring(0, startJsIndex).match(/^(\s*[a-zA-Z0-9_-]+)\s*:\s*$/);
                if (isProperty && currentNode) {
                    finalizeCurrentNode(i - 1);
                    currentJsProperty = isProperty[1].trim();
                    jsContent = line.substring(startJsIndex + 2) + '\n';
                    mode = 'javascript-property';
                }
                else {
                    finalizeCurrentNode(i - 1);
                    mode = 'javascript';
                    jsStartLine = i;
                    jsContent = line.substring(startJsIndex + 2) + '\n';
                }
                continue;
            }
            const trimmed = line.trim();
            const isNodeDeclaration = trimmed.startsWith('@') || trimmed.startsWith('-') || trimmed === '=';
            if (isNodeDeclaration) {
                finalizeCurrentNode(i - 1);
                mode = 'dendry';
                startLine = i;
                let nodeType = 'unknown';
                let nodeId = '';
                if (trimmed.startsWith('@')) {
                    const parts = trimmed.substring(1).split(' ');
                    nodeType = parts[0] || 'unknown';
                    if (parts.length > 1)
                        nodeId = parts[1];
                }
                else if (trimmed.startsWith('-')) {
                    nodeType = 'choice';
                }
                else if (trimmed === '=') {
                    nodeType = 'divider';
                }
                currentNode = { type: nodeType, properties: new Map(), content: '', range: new vscode.Range(i, 0, i, line.length) };
                if (nodeId)
                    currentNode.properties.set('id', nodeId);
                continue;
            }
            if (mode === 'dendry') {
                if (!trimmed)
                    continue;
                const propertyMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
                if (propertyMatch) {
                    const key = propertyMatch[1];
                    const value = propertyMatch[2];
                    if (currentNode) {
                        currentNode.properties.set(key, value);
                    }
                    else {
                        ast.metadata[key] = value;
                    }
                    continue;
                }
                if (trimmed.startsWith('#')) {
                    continue;
                }
                mode = 'content';
            }
            if (mode === 'content') {
                if (currentNode) {
                    if (currentNode.content || trimmed !== '') {
                        currentNode.content = (currentNode.content ? currentNode.content + '\n' : '') + line;
                    }
                }
            }
        }
        finalizeCurrentNode(lines.length - 1);
        return ast;
    }
}
exports.DendryParser = DendryParser;
//# sourceMappingURL=parser.js.map