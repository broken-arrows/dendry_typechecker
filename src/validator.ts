import * as vscode from 'vscode';
import * as esprima from 'esprima';
import { walk } from 'esprima-walk';
import { DendryAST, DendryNode } from './parser';

export class DendryValidator {
    private strictMode: boolean;
    private sceneIds: Set<string> = new Set();
    private qualityIds: Set<string> = new Set();

    // Valid Dendry property types
    private readonly SCENE_PROPERTIES = new Set([
        'id', 'title', 'subtitle', 'tags', 'order', 'frequency',
        'max-visits', 'min-choices', 'max-choices', 'new-page',
        'signal', 'content', 'on-arrival', 'on-display', 'on-departure',
        'view-if', 'choose-if', 'priority', 'unavailable-subtitle',
        'set-jump', 'is-special'
    ]);

    private readonly QUALITY_PROPERTIES = new Set([
        'id', 'name', 'initial', 'min', 'max', 'signal'
    ]);

    private readonly CHOICE_PROPERTIES = new Set([
        'view-if', 'choose-if', 'on-choose', 'go-to', 'priority', 
        'unavailable-subtitle', 'min-choices', 'max-choices'
    ]);

    private readonly JS_GLOBAL_PREFIXES = new Set(['Q', 'S', 'V', 'P']);

    constructor(strictMode: boolean = false) {
        this.strictMode = strictMode;
    }

    validate(ast: DendryAST, document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        this.sceneIds.clear();
        this.qualityIds.clear();

        // First pass: collect all scene and quality IDs
        for (const node of ast.nodes) {
            const id = node.properties.get('id');
            if (id) {
                if (node.type === 'scene' || node.type === 'root') {
                    this.sceneIds.add(id);
                } else if (node.type === 'quality') {
                    this.qualityIds.add(id);
                }
            }
        }

        // Second pass: validate each node
        ast.nodes.forEach((node, index) => {
            // An explicit scene (not the implicit first one) must have a title.
            if (index > 0 && (node.type === 'scene' || node.type === 'root') && !node.properties.has('title')) {
                diagnostics.push(this.createDiagnostic(
                    node.range,
                    `An explicit scene declaration must have a "title" property.`, 
                    vscode.DiagnosticSeverity.Error
                ));
            }
            diagnostics.push(...this.validateNode(node, document));
        });


        // Validate rootScene if present in metadata
        if (ast.metadata.rootScene) {
            this.validateSceneReference(ast.metadata.rootScene, new vscode.Range(0, 0, 0, 0), diagnostics); // Use a dummy range for metadata
        }

        return diagnostics;
    }

    private validateNode(node: DendryNode, document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];

        switch (node.type) {
            case 'scene':
            case 'root':
                diagnostics.push(...this.validateScene(node, document));
                break;
            case 'quality':
                diagnostics.push(...this.validateQuality(node, document));
                break;
            case 'choice':
                diagnostics.push(...this.validateChoice(node, document));
                break;
            case 'javascript_block':
                diagnostics.push(...this.validateJavaScript(node.content, node.range));
                break;
        }

        return diagnostics;
    }

    private validateScene(node: DendryNode, document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];

        // Validate property types
        for (const [key, value] of node.properties.entries()) {
            if (!this.SCENE_PROPERTIES.has(key)) {
                diagnostics.push(this.createDiagnostic(
                    node.range,
                    `Unknown scene property: "${key}"`, 
                    this.strictMode ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
                ));
            }

            const propertyValueRange = this.findRangeForProperty(document, node.range, key);

            // Type checking for specific properties
            if (key === 'max-visits' || key === 'min-choices' || key === 'max-choices' || 
                key === 'frequency' || key === 'order' || key === 'priority') {
                this.validateNumber(value, propertyValueRange, key, diagnostics);
            }

            // Validate boolean properties
            if (key === 'new-page' || key === 'is-special') {
                this.validateBoolean(value, propertyValueRange, key, diagnostics);
            }

            // Validate JavaScript in on-* properties
            if (key.startsWith('on-') || key === 'view-if' || key === 'choose-if') {
                diagnostics.push(...this.validateJavaScript(value, propertyValueRange));
            }

            // Validate go-to references
            if (key === 'go-to') {
                this.validateGoTo(value, propertyValueRange, diagnostics);
            }

            // Validate set-jump references
            if (key === 'set-jump') {
                this.validateSceneReference(value, propertyValueRange, diagnostics);
            }
        }

        return diagnostics;
    }

    private validateQuality(node: DendryNode, document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];

        // Check required properties
        if (!node.properties.has('id')) {
            diagnostics.push(this.createDiagnostic(
                node.range,
                'Quality must have an "id" property',
                vscode.DiagnosticSeverity.Error
            ));
        }

        // Validate property types
        for (const [key, value] of node.properties.entries()) {
            if (!this.QUALITY_PROPERTIES.has(key)) {
                diagnostics.push(this.createDiagnostic(
                    node.range,
                    `Unknown quality property: "${key}"`, 
                    this.strictMode ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
                ));
            }

            // Type checking for numeric properties
            if (key === 'initial' || key === 'min' || key === 'max') {
                const propertyValueRange = this.findRangeForProperty(document, node.range, key);
                this.validateNumber(value, propertyValueRange, key, diagnostics);
            }
        }

        // Validate min/max constraints
        const min = node.properties.get('min');
        const max = node.properties.get('max');
        const initial = node.properties.get('initial');

        const numMin = Number(min);
        const numMax = Number(max);
        const numInitial = Number(initial);

        if (!isNaN(numMin) && !isNaN(numMax) && numMin > numMax) {
            diagnostics.push(this.createDiagnostic(
                node.range, // This range is still broad, but it's a cross-property check
                'Quality "min" value cannot be greater than "max" value',
                vscode.DiagnosticSeverity.Error
            ));
        }

        if (!isNaN(numInitial) && !isNaN(numMin) && numInitial < numMin) {
            diagnostics.push(this.createDiagnostic(
                node.range,
                'Quality "initial" value cannot be less than "min" value',
                vscode.DiagnosticSeverity.Error
            ));
        }

        if (!isNaN(numInitial) && !isNaN(numMax) && numInitial > numMax) {
            diagnostics.push(this.createDiagnostic(
                node.range,
                'Quality "initial" value cannot be greater than "max" value',
                vscode.DiagnosticSeverity.Error
            ));
        }

        return diagnostics;
    }

    private validateChoice(node: DendryNode, document: vscode.TextDocument): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];

        for (const [key, value] of node.properties.entries()) {
            if (!this.CHOICE_PROPERTIES.has(key)) {
                diagnostics.push(this.createDiagnostic(
                    node.range,
                    `Unknown choice property: "${key}"`, 
                    this.strictMode ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
                ));
            }
            
            const propertyValueRange = this.findRangeForProperty(document, node.range, key);

            if (key === 'view-if' || key === 'choose-if' || key === 'on-choose') {
                diagnostics.push(...this.validateJavaScript(value, propertyValueRange));
            }

            if (key === 'go-to') {
                this.validateGoTo(value, propertyValueRange, diagnostics);
            }

            if (key === 'priority' || key === 'min-choices' || key === 'max-choices') {
                this.validateNumber(value, propertyValueRange, key, diagnostics);
            }
        }

        return diagnostics;
    }
    
    private validateGoTo(value: string, range: vscode.Range, diagnostics: vscode.Diagnostic[]) {
        const statements = value.split(';');
        for (const statement of statements) {
            const trimmedStatement = statement.trim();
            if (!trimmedStatement) continue;

            const ifIndex = trimmedStatement.indexOf(' if ');
            let sceneId: string;
            let condition: string | null = null;

            if (ifIndex !== -1) {
                sceneId = trimmedStatement.substring(0, ifIndex).trim();
                condition = trimmedStatement.substring(ifIndex + 4).trim();
            } else {
                sceneId = trimmedStatement;
            }

            if (sceneId && sceneId !== 'jumpScene') {
                this.validateSceneReference(sceneId, range, diagnostics); // Use property range for now
            }

            if (condition) {
                // Use property range for now, a more advanced impl would find the range of the condition.
                diagnostics.push(...this.validateJavaScript(condition, range));
            }
        }
    }

    private findRangeForProperty(document: vscode.TextDocument, nodeRange: vscode.Range, key: string): vscode.Range {
        const nodeText = document.getText(nodeRange);
        const lines = nodeText.split('\n');
        
        let propertyLineIndex = -1;
        let propertyLineText = '';
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim().startsWith(key + ':')) {
                propertyLineIndex = i;
                propertyLineText = lines[i];
                break;
            }
        }

        if (propertyLineIndex === -1) {
            return nodeRange; // Fallback
        }

        const valueStartIndex = propertyLineText.indexOf(':') + 1;
        const valueText = propertyLineText.substring(valueStartIndex);

        if (valueText.trim().startsWith('{!')) {
            const startLine = nodeRange.start.line + propertyLineIndex;
            const startCol = valueStartIndex + valueText.indexOf('{!');
            let endLine = startLine;
            let endCol = startCol + 2;

            for (let i = propertyLineIndex; i < lines.length; i++) {
                const currentLineText = lines[i];
                const closingIndex = currentLineText.indexOf('!}');
                if (closingIndex !== -1) {
                    endLine = nodeRange.start.line + i;
                    endCol = closingIndex + 2;
                    return new vscode.Range(startLine, startCol, endLine, endCol);
                }
            }
            return new vscode.Range(startLine, startCol, startLine, startCol + 2);
        } else {
            const line = nodeRange.start.line + propertyLineIndex;
            const startCol = valueStartIndex + (valueText.length - valueText.trimLeft().length);
            const endCol = startCol + valueText.trim().length;
            return new vscode.Range(line, startCol, line, endCol);
        }
    }
    
    private validateNumber(value: any, range: vscode.Range, propertyName: string, diagnostics: vscode.Diagnostic[]) {
        if (isNaN(Number(value))) {
            diagnostics.push(this.createDiagnostic(
                range, `Property "${propertyName}" must be a number, got: "${value}"`, vscode.DiagnosticSeverity.Error
            ));
        }
    }

    private validateBoolean(value: any, range: vscode.Range, propertyName: string, diagnostics: vscode.Diagnostic[]) {
        if (typeof value !== 'string' || (value.toLowerCase() !== 'true' && value.toLowerCase() !== 'false')) {
            diagnostics.push(this.createDiagnostic(
                range, `Property "${propertyName}" must be "true" or "false", got: "${value}"`, vscode.DiagnosticSeverity.Error
            ));
        }
    }

    private validateJavaScript(code: string, range: vscode.Range): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const wrappedCode = `var Q, S, V, P;\n${code}`;

        try {
            const ast = esprima.parseScript(wrappedCode, { tolerant: true, loc: true });

            if ((ast as any).errors && (ast as any).errors.length > 0) {
                for (const err of (ast as any).errors) {
                    const lineOffset = err.lineNumber ? err.lineNumber - 1 : 0;
                    const col = err.column || 0;
                    const errRange = new vscode.Range(range.start.line + lineOffset, col, range.start.line + lineOffset, col + 1);
                    diagnostics.push(this.createDiagnostic(
                        errRange, `JavaScript Syntax Error: ${err.description}`, vscode.DiagnosticSeverity.Error
                    ));
                }
            }
            
            walk(ast, (node) => {
                if (node.type === 'ExpressionStatement' && node.expression.type === 'Identifier') {
                    const lineOffset = node.loc ? node.loc.start.line - 1 : 0;
                    const col = node.loc ? node.loc.start.column : 0;
                    const errRange = new vscode.Range(range.start.line + lineOffset, col, range.start.line + lineOffset, col + node.expression.name.length);
                    diagnostics.push(this.createDiagnostic(
                        errRange, `Statement has no effect.`, vscode.DiagnosticSeverity.Warning
                    ));
                }
            });

            const qualityPattern = /\bQ\.([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
            let match;
            while ((match = qualityPattern.exec(code)) !== null) {
                const qualityId = match[1];
                if (!this.qualityIds.has(qualityId)) {
                    diagnostics.push(this.createDiagnostic(
                        range, `Reference to undefined quality: "${qualityId}"`, vscode.DiagnosticSeverity.Warning
                    ));
                }
            }

            const scenePattern = /\bS\.([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
            while ((match = scenePattern.exec(code)) !== null) {
                const sceneId = match[1];
                if (!this.sceneIds.has(sceneId)) {
                    diagnostics.push(this.createDiagnostic(
                        range, `Reference to undefined scene: "${sceneId}"`, vscode.DiagnosticSeverity.Warning
                    ));
                }
            }

        } catch (error) {
            if (error instanceof Error && 'lineNumber' in error && 'column' in error) {
                const lineOffset = (error.lineNumber as number) - 1;
                const col = error.column as number;
                const errRange = new vscode.Range(range.start.line + lineOffset, col, range.start.line + lineOffset, col + 1);
                 diagnostics.push(this.createDiagnostic(
                    errRange, `JavaScript Syntax Error: ${error.message.replace(/Line \d+: /, '')}`, vscode.DiagnosticSeverity.Error
                ));
            } else {
                 diagnostics.push(this.createDiagnostic(
                    range, `Invalid JavaScript: ${error instanceof Error ? error.message : String(error)}`, vscode.DiagnosticSeverity.Error
                ));
            }
        }

        return diagnostics;
    }

    private validateSceneReference(sceneId: string, range: vscode.Range, diagnostics: vscode.Diagnostic[]): void {
        if (sceneId.includes('{') || sceneId.includes('$')) {
            return;
        }

        if (!this.sceneIds.has(sceneId)) {
            diagnostics.push(this.createDiagnostic(
                range, `Reference to undefined scene: "${sceneId}"`, vscode.DiagnosticSeverity.Error
            ));
        }
    }

    private createDiagnostic(
        range: vscode.Range,
        message: string,
        severity: vscode.DiagnosticSeverity
    ): vscode.Diagnostic {
        const diagnostic = new vscode.Diagnostic(range, message, severity);
        diagnostic.source = 'dendry';
        return diagnostic;
    }
}
