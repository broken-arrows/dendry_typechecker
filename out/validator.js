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
exports.DendryValidator = void 0;
const vscode = __importStar(require("vscode"));
const esprima = __importStar(require("esprima"));
const esprima_walk_1 = require("esprima-walk");
class DendryValidator {
    constructor(strictMode = false) {
        this.sceneIds = new Set();
        this.qualityIds = new Set();
        this._allFileData = new Map();
        // Valid Dendry property types
        this.SCENE_PROPERTIES = new Set([
            'id', 'title', 'subtitle', 'tags', 'order', 'frequency',
            'max-visits', 'min-choices', 'max-choices', 'new-page',
            'signal', 'content', 'on-arrival', 'on-display', 'on-departure',
            'view-if', 'choose-if', 'priority', 'unavailable-subtitle',
            'set-jump', 'is-special', 'go-to', 'set-bg', 'is-hand', 'card-image', 'face-image', 'is-deck', 'max-cards', 'is-pinned-card', 'is-card'
        ]);
        this.QUALITY_PROPERTIES = new Set([
            'id', 'name', 'initial', 'min', 'max', 'signal'
        ]);
        this.CHOICE_PROPERTIES = new Set([
            'view-if', 'choose-if', 'on-choose', 'go-to', 'priority',
            'unavailable-subtitle', 'min-choices', 'max-choices'
        ]);
        this.JS_GLOBAL_PREFIXES = new Set(['Q', 'S', 'V', 'P']);
        this.strictMode = strictMode;
    }
    validate(ast, document, allFileData) {
        const diagnostics = [];
        this._allFileData = allFileData; // Store for other methods to access
        // Clear and rebuild global ID sets from allFileData
        this.sceneIds.clear();
        this.qualityIds.clear();
        allFileData.forEach(data => {
            data.localSceneIds.forEach(id => this.sceneIds.add(id));
            data.localQualityIds.forEach(id => this.qualityIds.add(id));
        });
        // Second pass: validate each node
        ast.nodes.forEach((node, index) => {
            diagnostics.push(...this.validateNode(node, document));
        });
        // Validate rootScene if present in metadata
        if (ast.metadata.rootScene) {
            this.validateSceneReference(ast.metadata.rootScene, new vscode.Range(0, 0, 0, 0), diagnostics); // Use a dummy range for metadata
        }
        return diagnostics;
    }
    validateNode(node, document) {
        const diagnostics = [];
        switch (node.type) {
            case 'scene':
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
    validateScene(node, document) {
        const diagnostics = [];
        // All scenes declared explicitly with @scene <id> must have a title.
        if (node.declarationType === 'explicit' && !node.properties.has('title')) {
            diagnostics.push(this.createDiagnostic(node.range, `An explicit scene must have a "title" property.`, vscode.DiagnosticSeverity.Error));
        }
        // If an ID is provided, ensure it's not empty
        const id = node.properties.get('id');
        if (id !== undefined && (typeof id !== 'string' || id.trim() === '')) {
            const propertyValueRange = this.findRangeForProperty(document, node.range, 'id');
            diagnostics.push(this.createDiagnostic(propertyValueRange, `Scene "id" cannot be empty.`, vscode.DiagnosticSeverity.Error));
        }
        // Validate property types
        for (const [key, value] of node.properties.entries()) {
            const propertyValueRange = this.findRangeForProperty(document, node.range, key);
            if (!this.SCENE_PROPERTIES.has(key)) {
                diagnostics.push(this.createDiagnostic(propertyValueRange, // Use precise range for this error
                `Unknown scene property: "${key}"`, this.strictMode ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning));
            }
            // Type checking for specific properties
            if (key === 'max-visits' || key === 'min-choices' || key === 'max-choices' ||
                key === 'frequency' || key === 'order' || key === 'priority' || key === 'max-cards') {
                this.validateNumber(value, propertyValueRange, key, diagnostics);
            }
            // Validate boolean properties
            if (key === 'new-page' || key === 'is-special' || key === 'is-hand' || key === 'is-deck' || key === 'is-pinned-card' || key === 'is-card') {
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
        // Validate scene references within the content itself
        // Removed _validateSceneContent call as its logic is moved to validateChoice
        return diagnostics;
    }
    validateQuality(node, document) {
        const diagnostics = [];
        // Check required properties
        if (!node.properties.has('id')) {
            diagnostics.push(this.createDiagnostic(node.range, 'Quality must have an "id" property', vscode.DiagnosticSeverity.Error));
        }
        // Validate property types
        for (const [key, value] of node.properties.entries()) {
            if (!this.QUALITY_PROPERTIES.has(key)) {
                diagnostics.push(this.createDiagnostic(node.range, `Unknown quality property: "${key}"`, this.strictMode ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning));
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
            diagnostics.push(this.createDiagnostic(node.range, // This range is still broad, but it's a cross-property check
            'Quality "min" value cannot be greater than "max" value', vscode.DiagnosticSeverity.Error));
        }
        if (!isNaN(numInitial) && !isNaN(numMin) && numInitial < numMin) {
            diagnostics.push(this.createDiagnostic(node.range, 'Quality "initial" value cannot be less than "min" value', vscode.DiagnosticSeverity.Error));
        }
        if (!isNaN(numInitial) && !isNaN(numMax) && numInitial > numMax) {
            diagnostics.push(this.createDiagnostic(node.range, 'Quality "initial" value cannot be greater than "max" value', vscode.DiagnosticSeverity.Error));
        }
        return diagnostics;
    }
    validateChoice(node, document) {
        const diagnostics = [];
        for (const [key, value] of node.properties.entries()) {
            if (!this.CHOICE_PROPERTIES.has(key)) {
                diagnostics.push(this.createDiagnostic(node.range, `Unknown choice property: "${key}"`, this.strictMode ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning));
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
        // Validate scene references within the choice content itself: "- @scenename: Display option name"
        // The node.content for a choice is typically the text after the leading '-' or '*' and any whitespace.
        // E.g., for "- @scene_a: Here", node.content would be "@scene_a: Here".
        const choiceContent = node.content;
        const regex = /@([a-zA-Z0-9_]+)(?::\s*(.+))?/; // Allow IDs to start with numbers, make display part optional
        const match = choiceContent.match(regex);
        if (match) {
            const sceneId = match[1];
            // The range of the choice node starts *before* the content.
            // node.range.start.character is the column of the '-' or '*'.
            // We need to find the column where the '@' starts within the *line*.
            const fullLineText = document.lineAt(node.range.start.line).text;
            const contentStartCol = fullLineText.indexOf(choiceContent, node.range.start.character);
            if (contentStartCol !== -1) {
                const atSymbolIndex = contentStartCol + choiceContent.indexOf('@');
                const sceneIdStartCol = atSymbolIndex + 1; // +1 to skip '@'
                const sceneIdEndCol = sceneIdStartCol + sceneId.length;
                const sceneIdRange = new vscode.Range(node.range.start.line, sceneIdStartCol, node.range.start.line, sceneIdEndCol);
                this.validateSceneReference(sceneId, sceneIdRange, diagnostics);
            }
        }
        return diagnostics;
    }
    validateGoTo(value, range, diagnostics) {
        const statements = value.split(';');
        for (const statement of statements) {
            const trimmedStatement = statement.trim();
            if (!trimmedStatement)
                continue;
            const ifIndex = trimmedStatement.indexOf(' if ');
            let sceneId;
            let condition = null;
            if (ifIndex !== -1) {
                sceneId = trimmedStatement.substring(0, ifIndex).trim();
                condition = trimmedStatement.substring(ifIndex + 4).trim();
            }
            else {
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
    findRangeForProperty(document, nodeRange, key) {
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
        }
        else {
            const line = nodeRange.start.line + propertyLineIndex;
            const startCol = valueStartIndex + (valueText.length - valueText.trimLeft().length);
            const endCol = startCol + valueText.trim().length;
            return new vscode.Range(line, startCol, line, endCol);
        }
    }
    validateNumber(value, range, propertyName, diagnostics) {
        if (isNaN(Number(value))) {
            diagnostics.push(this.createDiagnostic(range, `Property "${propertyName}" must be a number, got: "${value}"`, vscode.DiagnosticSeverity.Error));
        }
    }
    validateBoolean(value, range, propertyName, diagnostics) {
        if (typeof value !== 'string' || (value.toLowerCase() !== 'true' && value.toLowerCase() !== 'false')) {
            diagnostics.push(this.createDiagnostic(range, `Property "${propertyName}" must be "true" or "false", got: "${value}"`, vscode.DiagnosticSeverity.Error));
        }
    }
    validateJavaScript(code, range) {
        const diagnostics = [];
        const wrappedCode = `var Q, S, V, P;\n${code}`;
        try {
            const ast = esprima.parseScript(wrappedCode, { loc: true });
            if (ast.errors && ast.errors.length > 0) {
                for (const err of ast.errors) {
                    const lineOffset = err.lineNumber ? err.lineNumber - 1 : 0;
                    const col = err.column || 0;
                    const errRange = new vscode.Range(range.start.line + lineOffset, col, range.start.line + lineOffset, col + 1);
                    diagnostics.push(this.createDiagnostic(errRange, `JavaScript Syntax Error: ${err.description}`, vscode.DiagnosticSeverity.Error));
                }
            }
            (0, esprima_walk_1.walk)(ast, (node) => {
                if (node.type === 'ExpressionStatement' && node.expression.type === 'Identifier') {
                    const lineOffset = node.loc ? node.loc.start.line - 1 : 0;
                    const col = node.loc ? node.loc.start.column : 0;
                    const errRange = new vscode.Range(range.start.line + lineOffset, col, range.start.line + lineOffset, col + node.expression.name.length);
                    diagnostics.push(this.createDiagnostic(errRange, `Statement has no effect.`, vscode.DiagnosticSeverity.Warning));
                }
            });
            const qualityPattern = /\bQ\.([a-zA-Z0-9_]+)\b/g;
            let match;
            while ((match = qualityPattern.exec(code)) !== null) {
                const qualityId = match[1];
                if (!this.qualityIds.has(qualityId)) {
                    diagnostics.push(this.createDiagnostic(range, `Reference to undefined quality: "${qualityId}"`, vscode.DiagnosticSeverity.Warning));
                }
            }
            const scenePattern = /\bS\.([a-zA-Z0-9_]+)\b/g;
            while ((match = scenePattern.exec(code)) !== null) {
                const sceneId = match[1];
                if (!this.sceneIds.has(sceneId)) {
                    diagnostics.push(this.createDiagnostic(range, `Reference to undefined scene: "${sceneId}"`, vscode.DiagnosticSeverity.Warning));
                }
            }
        }
        catch (error) {
            if (error instanceof Error && 'lineNumber' in error && 'column' in error) {
                const lineOffset = error.lineNumber - 1;
                const col = error.column;
                const errRange = new vscode.Range(range.start.line + lineOffset, col, range.start.line + lineOffset, col + 1);
                diagnostics.push(this.createDiagnostic(errRange, `JavaScript Syntax Error: ${error.message.replace(/Line \d+: /, '')}`, vscode.DiagnosticSeverity.Error));
            }
            else {
                diagnostics.push(this.createDiagnostic(range, `Invalid JavaScript: ${error instanceof Error ? error.message : String(error)}`, vscode.DiagnosticSeverity.Error));
            }
        }
        return diagnostics;
    }
    validateSceneReference(sceneId, range, diagnostics) {
        if (sceneId.includes('{') || sceneId.includes('$')) {
            // Still ignore dynamic references for now, as the prompt didn't specify how to validate them.
            return;
        }
        // Case 1: Simple sceneId (local or global) - no dots
        if (!sceneId.includes('.')) {
            if (!this.sceneIds.has(sceneId)) {
                diagnostics.push(this.createDiagnostic(range, `Reference to undefined scene: "${sceneId}"`, vscode.DiagnosticSeverity.Error));
            }
            return;
        }
        // Case 2: Dotted sceneId (e.g., "filePrefix.sceneId" or "filePrefix.scene.dry")
        const parts = sceneId.split('.');
        if (parts.length === 2) {
            const filePrefix = parts[0]; // e.g., "scenename" from "scenename.anotherscenename"
            const secondPart = parts[1]; // e.g., "anotherscenename" or "scene"
            // Check for "scenename.scene" which refers to scenename.scene.dry (the file itself)
            if (secondPart === 'scene') {
                const targetFileName = `${filePrefix}.scene.dry`;
                const fileFound = Array.from(this._allFileData.keys()).some(uri => {
                    const uriFileName = uri.fsPath.split('/').pop()?.split('\\').pop(); // Get filename.ext
                    return uriFileName === targetFileName;
                });
                if (!fileFound) {
                    diagnostics.push(this.createDiagnostic(range, `Reference to non-existent file: "${targetFileName}"`, vscode.DiagnosticSeverity.Error));
                }
                return;
            }
            // Check for "scenename.anotherscenename" (nested scene in another file)
            let targetFileUri;
            for (const uri of this._allFileData.keys()) {
                const fileName = uri.fsPath.split('/').pop()?.split('\\').pop(); // Get filename.ext
                if (fileName === `${filePrefix}.scene.dry`) {
                    targetFileUri = uri;
                    break;
                }
            }
            if (targetFileUri) {
                const fileDataEntry = this._allFileData.get(targetFileUri);
                if (fileDataEntry && !fileDataEntry.localSceneIds.has(secondPart)) {
                    diagnostics.push(this.createDiagnostic(range, `Scene "${secondPart}" not found in file "${filePrefix}.scene.dry"`, vscode.DiagnosticSeverity.Error));
                }
            }
            else {
                diagnostics.push(this.createDiagnostic(range, `File "${filePrefix}.scene.dry" not found for reference "${sceneId}"`, vscode.DiagnosticSeverity.Error));
            }
            return;
        }
        // If we reach here, it's an invalid dotted reference format (e.g., too many dots)
        diagnostics.push(this.createDiagnostic(range, `Invalid scene reference format: "${sceneId}". Expected "sceneId", "file.scene", or "file.nestedSceneId".`, vscode.DiagnosticSeverity.Error));
    }
    createDiagnostic(range, message, severity) {
        const diagnostic = new vscode.Diagnostic(range, message, severity);
        diagnostic.source = 'dendry';
        return diagnostic;
    }
}
exports.DendryValidator = DendryValidator;
//# sourceMappingURL=validator.js.map