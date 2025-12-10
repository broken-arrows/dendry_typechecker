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
        const lines = text.split('\\n');
        const ast: DendryAST = {
            nodes: [],
            metadata: {}
        };

        let currentNode: DendryNode | null = null;
        let currentProperty: string | null = null;
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
                } else {
                    // Metadata
                    ast.metadata[key as keyof typeof ast.metadata] = value;
                }
                continue;
            }

            // Scene/Quality/Choice declaration
            if (trimmed.startsWith('@') || trimmed === '-' || trimmed === '=' || 
                trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                
                // Save previous node
                if (currentNode) {
                    currentNode.range = new vscode.Range(
                        startLine, 0,
                        i - 1, lines[i - 1].length
                    );
                    ast.nodes.push(currentNode);
                }

                // Determine node type
                let nodeType = 'unknown';
                if (trimmed.startsWith('@')) {
                    const parts = trimmed.substring(1).split(' ');
                    nodeType = parts[0] || 'unknown';
                } else if (trimmed.startsWith('- ') || trimmed === '-') {
                    nodeType = 'choice';
                } else if (trimmed === '=') {
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
            currentNode.range = new vscode.Range(
                startLine, 0,
                lines.length - 1, lines[lines.length - 1].length
            );
            ast.nodes.push(currentNode);
        }

        return ast;
    }
}