import * as vscode from 'vscode';

export interface DendryNode {
    type: string;
    properties: Map<string, any>;
    content: string;
    range: vscode.Range;
}

export interface DendryAST {
    nodes: DendryNode[];
    metadata: {
        title?: string;
        author?: string;
        rootScene?: string;
    };
}

export class DendryParser {
    parse(text: string): DendryAST {
        const lines = text.split('\n');
        const ast: DendryAST = {
            nodes: [],
            metadata: {}
        };

        let currentNode: DendryNode | null = null;
        let startLine = 0;
        let mode: 'dendry' | 'javascript' | 'content' | 'javascript-property' = 'dendry';
        let jsContent = '';
        let jsStartLine = 0;
        let currentJsProperty = '';

        const finalizeCurrentNode = (endLine: number) => {
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
                } else {
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
                } else {
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
                } else {
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
                    if (parts.length > 1) nodeId = parts[1];
                } else if (trimmed.startsWith('-')) {
                    nodeType = 'choice';
                } else if (trimmed === '=') {
                    nodeType = 'divider';
                }

                currentNode = { type: nodeType, properties: new Map(), content: '', range: new vscode.Range(i, 0, i, line.length) };
                if (nodeId) currentNode.properties.set('id', nodeId);
                continue;
            }

            if (mode === 'dendry') {
                if (!trimmed) continue;

                const propertyMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
                if (propertyMatch) {
                    const key = propertyMatch[1];
                    const value = propertyMatch[2];
                    if (currentNode) {
                        currentNode.properties.set(key, value);
                    } else {
                        ast.metadata[key as keyof typeof ast.metadata] = value;
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