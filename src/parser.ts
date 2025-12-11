import * as vscode from 'vscode';

export interface DendryNode {
    type: string;
    properties: Map<string, any>;
    content: string;
    range: vscode.Range;
    declarationType?: 'explicit' | 'implicit'; // Added for scene declaration type
}

export interface DendryAST {
    nodes: DendryNode[];
    metadata: {
        fileName?: string;
        title?: string;
        author?: string;
        rootScene?: string;
    };
}

export class DendryParser {
    parse(text: string, fileName: string): DendryAST {
        const lines = text.split('\n');
        const ast: DendryAST = { nodes: [], metadata: { fileName } };

        let currentNode: DendryNode | null = null;
        let startLine = 0;
        let parsingProperties = false;

        const finalizeCurrentNode = (endLine: number) => {
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
                let declarationType: 'explicit' | 'implicit' | undefined;

                if (trimmed.startsWith('@')) {
                    const parts = trimmed.substring(1).split(' ');
                    if (parts.length === 1) {
                        nodeType = 'scene'; // Default to 'scene' if no explicit type given
                        nodeId = parts[0];
                        declarationType = 'implicit';
                    } else if (parts.length >= 2) {
                        nodeType = parts[0];
                        nodeId = parts[1];
                        if (nodeType === 'scene') { // Only mark explicit if the type is 'scene'
                            declarationType = 'explicit';
                        }
                    }
                } else if (trimmed.startsWith('-')) {
                    nodeType = 'choice';
                } else if (trimmed === '=') {
                    nodeType = 'divider';
                }

                currentNode = { type: nodeType, properties: new Map(), content: '', range: new vscode.Range(i, 0, i, line.length), declarationType };
                if (nodeId) currentNode.properties.set('id', nodeId);
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
                } else {
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
            } else {
                // If we are here, it means we have content outside of a node, which is a parsing error.
                throw new Error(`Invalid syntax on line ${i + 1}: "${line.trim()}". Content can only appear inside a scene or choice.`);
            }
        }

        finalizeCurrentNode(lines.length - 1);
        return ast;
    }
}