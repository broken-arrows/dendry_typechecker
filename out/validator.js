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
class DendryValidator {
    constructor(strictMode = false) {
        this.sceneIds = new Set();
        this.qualityIds = new Set();
        this._allFileData = new Map();
        this.SCENE_PROPERTIES = new Set([
            'id',
            'title',
            'subtitle',
            'tags',
            'order',
            'frequency',
            'max-visits',
            'min-choices',
            'max-choices',
            'new-page',
            'signal',
            'content',
            'on-arrival',
            'on-display',
            'on-departure',
            'view-if',
            'choose-if',
            'priority',
            'unavailable-subtitle',
            'set-jump',
            'is-special',
            'go-to',
            'set-bg',
            'is-hand',
            'card-image',
            'face-image',
            'is-deck',
            'max-cards',
            'is-pinned-card',
            'is-card'
        ]);
        this.QUALITY_PROPERTIES = new Set(['id', 'name', 'initial', 'min', 'max', 'signal']);
        this.CHOICE_PROPERTIES = new Set([
            'view-if',
            'choose-if',
            'on-choose',
            'go-to',
            'priority',
            'unavailable-subtitle',
            'min-choices',
            'max-choices'
        ]);
        this.strictMode = strictMode;
    }
    validate(ast, document, allFileData) {
        const diagnostics = [];
        this._allFileData = allFileData;
        // rebuild global IDs
        this.sceneIds.clear();
        this.qualityIds.clear();
        allFileData.forEach(d => {
            d.localSceneIds.forEach(id => this.sceneIds.add(id.trim()));
            d.localQualityIds.forEach(id => this.qualityIds.add(id));
        });
        for (const node of ast.nodes) {
            diagnostics.push(...this.validateNode(node, document));
        }
        if (ast.metadata.rootScene) {
            this.validateSceneReference(ast.metadata.rootScene, new vscode.Range(0, 0, 0, 0), diagnostics);
        }
        return diagnostics;
    }
    validateNode(node, document) {
        switch (node.type) {
            case 'scene':
                return this.validateScene(node, document);
            case 'quality':
                return this.validateQuality(node, document);
            case 'choice':
                return this.validateChoice(node, document);
            default:
                return [];
        }
    }
    validateScene(node, document) {
        const diagnostics = [];
        if (node.declarationType === 'explicit' && !node.properties.has('title')) {
            diagnostics.push(this.createDiagnostic(node.range, `An explicit scene must have a "title" property.`, vscode.DiagnosticSeverity.Error));
        }
        const id = node.properties.get('id');
        if (id !== undefined && (typeof id !== 'string' || id.trim() === '')) {
            const r = this.findRangeForProperty(document, node.range, 'id');
            diagnostics.push(this.createDiagnostic(r, `Scene "id" cannot be empty.`, vscode.DiagnosticSeverity.Error));
        }
        for (const [key, value] of node.properties.entries()) {
            const r = this.findRangeForProperty(document, node.range, key);
            if (!this.SCENE_PROPERTIES.has(key)) {
                diagnostics.push(this.createDiagnostic(r, `Unknown scene property: "${key}"`, this.strictMode ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning));
            }
            if (key === 'max-visits' ||
                key === 'min-choices' ||
                key === 'max-choices' ||
                key === 'frequency' ||
                key === 'order' ||
                key === 'priority' ||
                key === 'max-cards') {
                this.validateNumber(value, r, key, diagnostics);
            }
            if (key === 'new-page' ||
                key === 'is-special' ||
                key === 'is-hand' ||
                key === 'is-deck' ||
                key === 'is-pinned-card' ||
                key === 'is-card') {
                this.validateBoolean(value, r, key, diagnostics);
            }
            if (key.startsWith('on-') || key === 'view-if' || key === 'choose-if') {
                diagnostics.push(...this.validateJavaScript(String(value ?? ''), r));
            }
            if (key === 'go-to') {
                this.validateGoTo(String(value ?? ''), r, diagnostics);
            }
            if (key === 'set-jump') {
                this.validateSceneReference(String(value ?? ''), r, diagnostics);
            }
        }
        return diagnostics;
    }
    validateQuality(node, document) {
        const diagnostics = [];
        if (!node.properties.has('id')) {
            diagnostics.push(this.createDiagnostic(node.range, 'Quality must have an "id" property', vscode.DiagnosticSeverity.Error));
        }
        for (const [key, value] of node.properties.entries()) {
            if (!this.QUALITY_PROPERTIES.has(key)) {
                diagnostics.push(this.createDiagnostic(node.range, `Unknown quality property: "${key}"`, this.strictMode ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning));
            }
            if (key === 'initial' || key === 'min' || key === 'max') {
                const r = this.findRangeForProperty(document, node.range, key);
                this.validateNumber(value, r, key, diagnostics);
            }
        }
        // Cross-property checks
        const min = Number(node.properties.get('min'));
        const max = Number(node.properties.get('max'));
        const initial = Number(node.properties.get('initial'));
        if (!isNaN(min) && !isNaN(max) && min > max) {
            diagnostics.push(this.createDiagnostic(node.range, 'Quality "min" value cannot be greater than "max" value', vscode.DiagnosticSeverity.Error));
        }
        if (!isNaN(initial) && !isNaN(min) && initial < min) {
            diagnostics.push(this.createDiagnostic(node.range, 'Quality "initial" value cannot be less than "min" value', vscode.DiagnosticSeverity.Error));
        }
        if (!isNaN(initial) && !isNaN(max) && initial > max) {
            diagnostics.push(this.createDiagnostic(node.range, 'Quality "initial" value cannot be greater than "max" value', vscode.DiagnosticSeverity.Error));
        }
        return diagnostics;
    }
    validateChoice(node, document) {
        const diagnostics = [];
        for (const [key, value] of node.properties.entries()) {
            const r = this.findRangeForProperty(document, node.range, key);
            if (!this.CHOICE_PROPERTIES.has(key)) {
                diagnostics.push(this.createDiagnostic(node.range, `Unknown choice property: "${key}"`, this.strictMode ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning));
            }
            if (key === 'view-if' || key === 'choose-if' || key === 'on-choose') {
                diagnostics.push(...this.validateJavaScript(String(value ?? ''), r));
            }
            if (key === 'go-to') {
                this.validateGoTo(String(value ?? ''), r, diagnostics);
            }
            if (key === 'priority' || key === 'min-choices' || key === 'max-choices') {
                this.validateNumber(value, r, key, diagnostics);
            }
        }
        let choiceContent = node.content ?? '';
        // If content is empty, try to extract from the document line
        if (!choiceContent || choiceContent.trim() === '') {
            const lineText = document.lineAt(node.range.start.line).text;
            choiceContent = lineText.substring(lineText.indexOf('-') + 1).trim();
        }
        // Check for tag references (- #tag_name)
        const tagMatch = choiceContent.match(/^#([a-zA-Z_][a-zA-Z0-9_-]*)/);
        if (tagMatch) {
            const tagName = tagMatch[1];
            // Find the range of the tag in the document
            const fullLineText = document.lineAt(node.range.start.line).text;
            const hashIndex = fullLineText.indexOf('#');
            if (hashIndex !== -1) {
                const tagStart = hashIndex + 1; // Position after #
                const tagEnd = tagStart + tagName.length;
                const tagRange = new vscode.Range(node.range.start.line, tagStart, node.range.start.line, tagEnd);
                this.validateTag(tagName, tagRange, diagnostics);
            }
            return diagnostics; // Tag choices don't have scene references
        }
        // Check for scene references
        const cleaned = choiceContent.replace(/\[\?.*?\?\]/g, ''); // ignore inline dendry brackets
        const match = cleaned.match(/@([a-zA-Z_][a-zA-Z0-9_-]*|[0-9]+)(?::\s*(.+))?/);
        if (match) {
            const sceneId = match[1].trim();
            // Compute precise range for @sceneId on this line
            const fullLineText = document.lineAt(node.range.start.line).text;
            const atIndex = fullLineText.indexOf('@');
            if (atIndex !== -1) {
                const start = atIndex + 1; // Position after @
                const end = start + sceneId.length;
                const sceneIdRange = new vscode.Range(node.range.start.line, start, node.range.start.line, end);
                this.validateSceneReference(sceneId, sceneIdRange, diagnostics);
            }
            else {
                // Fallback to node range if we can't find the @ symbol
                this.validateSceneReference(sceneId, node.range, diagnostics);
            }
        }
        return diagnostics;
    }
    validateTag(tagName, range, diagnostics) {
        // Check if any scene in the project has this tag
        let tagFound = false;
        for (const [uri, fileData] of this._allFileData) {
            for (const node of fileData.ast.nodes) {
                if (node.type === 'scene') {
                    const tags = node.properties.get('tags');
                    if (tags) {
                        const tagList = String(tags).split(/[,\s]+/).map(t => t.trim()).filter(t => t);
                        if (tagList.includes(tagName)) {
                            tagFound = true;
                            break;
                        }
                    }
                }
            }
            if (tagFound)
                break;
        }
        if (!tagFound) {
            diagnostics.push(this.createDiagnostic(range, `Tag "#${tagName}" is not defined in any scene`, vscode.DiagnosticSeverity.Error));
        }
    }
    validateGoTo(value, range, diagnostics) {
        const statements = value.split(';');
        for (const st of statements) {
            const trimmed = st.trim();
            if (!trimmed)
                continue;
            const ifIndex = trimmed.indexOf(' if ');
            let sceneId = '';
            let condition = null;
            if (ifIndex !== -1) {
                sceneId = trimmed.substring(0, ifIndex).trim();
                condition = trimmed.substring(ifIndex + 4).trim();
            }
            else {
                sceneId = trimmed;
            }
            if (sceneId && sceneId !== 'jumpScene') {
                this.validateSceneReference(sceneId, range, diagnostics);
            }
            if (condition) {
                diagnostics.push(...this.validateJavaScript(condition, range));
            }
        }
    }
    // FIX: for JS blocks, return a range that covers only the JS code (not "{!" / "!}")
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
        if (propertyLineIndex === -1)
            return nodeRange;
        const valueStartIndex = propertyLineText.indexOf(':') + 1;
        const valueText = propertyLineText.substring(valueStartIndex);
        // JS block case
        if (valueText.trim().startsWith('{!')) {
            const propertyAbsLine = nodeRange.start.line + propertyLineIndex;
            const openRel = valueText.indexOf('{!');
            // JS starts either after "{!" on same line, or at next line column 0
            const afterOpen = valueText.substring(openRel + 2);
            let startLine;
            let startCol;
            if (afterOpen.trim().length > 0) {
                startLine = propertyAbsLine;
                startCol = nodeRange.start.character + valueStartIndex + openRel + 2;
            }
            else {
                startLine = propertyAbsLine + 1;
                startCol = 0;
            }
            // Find closing "!}"
            for (let i = propertyLineIndex; i < lines.length; i++) {
                const closingIndex = lines[i].indexOf('!}');
                if (closingIndex !== -1) {
                    const endLine = nodeRange.start.line + i;
                    const endCol = (i === propertyLineIndex ? nodeRange.start.character : 0) + closingIndex;
                    return new vscode.Range(startLine, startCol, endLine, endCol);
                }
            }
            // fallback: highlight at least "{!"
            const openAbsCol = nodeRange.start.character + valueStartIndex + openRel;
            return new vscode.Range(propertyAbsLine, openAbsCol, propertyAbsLine, openAbsCol + 2);
        }
        // Normal scalar value on same line
        const line = nodeRange.start.line + propertyLineIndex;
        const leftTrim = valueText.length - valueText.trimStart().length;
        const startCol = nodeRange.start.character + valueStartIndex + leftTrim;
        const endCol = startCol + valueText.trim().length;
        return new vscode.Range(line, startCol, line, endCol);
    }
    validateNumber(value, range, propertyName, diagnostics) {
        if (isNaN(Number(value))) {
            diagnostics.push(this.createDiagnostic(range, `Property "${propertyName}" must be a number, got: "${value}"`, vscode.DiagnosticSeverity.Error));
        }
    }
    validateBoolean(value, range, propertyName, diagnostics) {
        if (typeof value !== 'string' ||
            (value.toLowerCase() !== 'true' && value.toLowerCase() !== 'false')) {
            diagnostics.push(this.createDiagnostic(range, `Property "${propertyName}" must be "true" or "false", got: "${value}"`, vscode.DiagnosticSeverity.Error));
        }
    }
    validateJavaScript(code, range) {
        const diagnostics = [];
        const wrappedCode = `var Q, S, V, P;\n${code}`;
        try {
            const ast = esprima.parseScript(wrappedCode, { loc: true, tolerant: false });
            // Additional checks for common errors
            this.checkJavaScriptAst(ast, code, range, diagnostics);
            this.checkUndefinedIdentifiers(code, range, diagnostics);
        }
        catch (error) {
            const errLineNumber = typeof error?.lineNumber === 'number' ? error.lineNumber : 1;
            const errColumn = typeof error?.column === 'number' ? error.column : 0;
            const lineOffset = Math.max(0, errLineNumber - 2);
            const colBase = lineOffset === 0 ? range.start.character : 0;
            const errRange = new vscode.Range(range.start.line + lineOffset, colBase + errColumn, range.start.line + lineOffset, colBase + errColumn + 1);
            diagnostics.push(this.createDiagnostic(errRange, `JavaScript Error: ${error.description || error.message}`, vscode.DiagnosticSeverity.Error));
        }
        return diagnostics;
    }
    checkJavaScriptAst(ast, code, range, diagnostics) {
        const walk = (node) => {
            if (!node || typeof node !== 'object')
                return;
            // Check for assignment in if condition (common mistake)
            if (node.type === 'IfStatement' && node.test?.type === 'AssignmentExpression') {
                const loc = node.test.loc;
                if (loc) {
                    const errRange = new vscode.Range(range.start.line + loc.start.line - 2, (loc.start.line === 2 ? range.start.character : 0) + loc.start.column, range.start.line + loc.end.line - 2, (loc.end.line === 2 ? range.start.character : 0) + loc.end.column);
                    diagnostics.push(this.createDiagnostic(errRange, `Possible mistake: assignment (=) in condition, did you mean comparison (==)?`, vscode.DiagnosticSeverity.Warning));
                }
            }
            // Recursively walk the AST
            for (const key in node) {
                if (key === 'loc' || key === 'range')
                    continue;
                const child = node[key];
                if (Array.isArray(child)) {
                    child.forEach(walk);
                }
                else if (child && typeof child === 'object') {
                    walk(child);
                }
            }
        };
        walk(ast);
    }
    checkUndefinedIdentifiers(code, range, diagnostics) {
        try {
            const ast = esprima.parseScript(`var Q, S, V, P;\n${code}`, { loc: true, tolerant: false });
            const definedVars = new Set(['Q', 'S', 'V', 'P', 'console', 'Math', 'Date', 'JSON', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'undefined', 'null', 'true', 'false', 'if', 'else', 'for', 'while', 'return', 'function']);
            const declaredInCode = new Set();
            const collectDeclarations = (node) => {
                if (!node || typeof node !== 'object')
                    return;
                if (node.type === 'VariableDeclarator' && node.id?.name) {
                    declaredInCode.add(node.id.name);
                }
                if (node.type === 'FunctionDeclaration' && node.id?.name) {
                    declaredInCode.add(node.id.name);
                }
                for (const key in node) {
                    if (key === 'loc' || key === 'range')
                        continue;
                    const child = node[key];
                    if (Array.isArray(child)) {
                        child.forEach(collectDeclarations);
                    }
                    else if (child && typeof child === 'object') {
                        collectDeclarations(child);
                    }
                }
            };
            collectDeclarations(ast);
            declaredInCode.forEach(v => definedVars.add(v));
            const checkIdentifiers = (node) => {
                if (!node || typeof node !== 'object')
                    return;
                if (node.type === 'Identifier' && node.name && !definedVars.has(node.name)) {
                    const loc = node.loc;
                    if (loc) {
                        const errRange = new vscode.Range(range.start.line + loc.start.line - 2, (loc.start.line === 2 ? range.start.character : 0) + loc.start.column, range.start.line + loc.end.line - 2, (loc.end.line === 2 ? range.start.character : 0) + loc.end.column);
                        // Check if this is actually a reference (not a property name)
                        const parent = node._parent;
                        const isPropertyName = parent && ((parent.type === 'MemberExpression' && parent.property === node && !parent.computed) ||
                            (parent.type === 'Property' && parent.key === node && !parent.computed));
                        if (!isPropertyName) {
                            diagnostics.push(this.createDiagnostic(errRange, `Undefined identifier: "${node.name}"`, vscode.DiagnosticSeverity.Warning));
                        }
                    }
                }
                // Set parent reference for context
                for (const key in node) {
                    if (key === 'loc' || key === 'range' || key === '_parent')
                        continue;
                    const child = node[key];
                    if (Array.isArray(child)) {
                        child.forEach(c => { if (c && typeof c === 'object')
                            c._parent = node; });
                        child.forEach(checkIdentifiers);
                    }
                    else if (child && typeof child === 'object') {
                        child._parent = node;
                        checkIdentifiers(child);
                    }
                }
            };
            checkIdentifiers(ast);
        }
        catch (error) {
            // Parsing already failed, errors already reported
        }
    }
    validateSceneReference(sceneId, range, diagnostics) {
        if (sceneId.includes('{') || sceneId.includes('$'))
            return; // dynamic references ignored for now
        // Simple local/global id
        if (!sceneId.includes('.')) {
            if (!this.sceneIds.has(sceneId)) {
                diagnostics.push(this.createDiagnostic(range, `Reference to undefined scene: "${sceneId}"`, vscode.DiagnosticSeverity.Error));
            }
            return;
        }
        // Dotted references: file.scene OR file.nestedSceneId
        const parts = sceneId.split('.');
        if (parts.length !== 2) {
            diagnostics.push(this.createDiagnostic(range, `Invalid scene reference format: "${sceneId}". Expected "sceneId", "file.scene", or "file.nestedSceneId".`, vscode.DiagnosticSeverity.Error));
            return;
        }
        const filePrefix = parts[0];
        const second = parts[1];
        if (second === 'scene') {
            const targetFileName = `${filePrefix}.scene.dry`;
            const fileFound = Array.from(this._allFileData.keys()).some(uri => {
                const fileName = uri.fsPath.split('/').pop()?.split('\\').pop();
                return fileName === targetFileName;
            });
            if (!fileFound) {
                diagnostics.push(this.createDiagnostic(range, `Reference to non-existent file: "${targetFileName}"`, vscode.DiagnosticSeverity.Error));
            }
            return;
        }
        // Look for file.sceneId pattern
        let targetFileUri;
        for (const uri of this._allFileData.keys()) {
            const fileName = uri.fsPath.split('/').pop()?.split('\\').pop();
            if (fileName === `${filePrefix}.scene.dry`) {
                targetFileUri = uri;
                break;
            }
        }
        if (!targetFileUri) {
            diagnostics.push(this.createDiagnostic(range, `File "${filePrefix}.scene.dry" not found for reference "${sceneId}"`, vscode.DiagnosticSeverity.Error));
            return;
        }
        const entry = this._allFileData.get(targetFileUri);
        if (entry && !entry.localSceneIds.has(second)) {
            diagnostics.push(this.createDiagnostic(range, `Scene "${second}" not found in file "${filePrefix}.scene.dry"`, vscode.DiagnosticSeverity.Error));
        }
    }
    createDiagnostic(range, message, severity) {
        const d = new vscode.Diagnostic(range, message, severity);
        d.source = 'dendry';
        return d;
    }
}
exports.DendryValidator = DendryValidator;
//# sourceMappingURL=validator.js.map