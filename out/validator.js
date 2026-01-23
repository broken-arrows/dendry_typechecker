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
const jsKeywords = new Set([
    'true', 'false', 'null', 'undefined',
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
    'break', 'continue', 'return', 'throw', 'try', 'catch', 'finally',
    'function', 'var', 'let', 'const', 'new', 'this', 'typeof', 'instanceof',
    'Math', 'console', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
    'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'JSON', 'Error',
    'true', 'false', 'null', 'undefined', 'in', 'of', 'async', 'await'
]);
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
            d.localQualityIds.forEach(id => this.qualityIds.add(id.trim()));
        });
        // Validate metadata (root-level properties)
        diagnostics.push(...this.validateMetadata(ast.metadata, document));
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
        // Check for standalone "@" (no scene ID)
        const sceneLine = document.lineAt(node.range.start.line).text.trim();
        if (sceneLine === '@' || sceneLine.match(/^@\s*$/)) {
            const sceneDeclarationRange = new vscode.Range(node.range.start.line, 0, node.range.start.line, document.lineAt(node.range.start.line).text.length);
            diagnostics.push(this.createDiagnostic(sceneDeclarationRange, `Scene declaration missing identifier, expected: "@scene_id"`, vscode.DiagnosticSeverity.Error));
        }
        // Create a range for just the scene declaration line
        const sceneDeclarationRange = new vscode.Range(node.range.start.line, 0, node.range.start.line, document.lineAt(node.range.start.line).text.length);
        if (node.declarationType === 'explicit' && !node.properties.has('title')) {
            diagnostics.push(this.createDiagnostic(sceneDeclarationRange, `Scene missing "title" property.`, vscode.DiagnosticSeverity.Warning));
        }
        const id = node.properties.get('id');
        if (id !== undefined && (typeof id !== 'string' || id.trim() === '')) {
            diagnostics.push(this.createDiagnostic(sceneDeclarationRange, `Scene "id" cannot be empty.`, vscode.DiagnosticSeverity.Error));
        }
        // Check for duplicate properties
        const propertyLines = new Map();
        const nodeText = document.getText(node.range);
        const nodeLines = nodeText.split('\n');
        let currentLine = node.range.start.line;
        for (let i = 0; i < nodeLines.length; i++) {
            const line = nodeLines[i].trim();
            const match = line.match(/^([\w-]+):/);
            if (match) {
                const propKey = match[1];
                if (propertyLines.has(propKey)) {
                    const duplicateRange = new vscode.Range(currentLine + i, 0, currentLine + i, nodeLines[i].length);
                    diagnostics.push(this.createDiagnostic(duplicateRange, `Duplicate property: "${propKey}" (first defined on line ${propertyLines.get(propKey) + 1})`, vscode.DiagnosticSeverity.Warning));
                }
                else {
                    propertyLines.set(propKey, currentLine + i);
                }
            }
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
            if (key === 'view-if' || key === 'choose-if') {
                diagnostics.push(...this.validateDendryCondition(value ?? '', r));
            }
            else if (key.startsWith('on-')) {
                diagnostics.push(...this.validateDendryAction(value ?? '', r));
            }
            if (key === 'go-to') {
                this.validateGoTo(String(value ?? ''), r, diagnostics);
            }
            if (key === 'set-jump') {
                this.validateGoTo(String(value ?? ''), r, diagnostics);
            }
        }
        this.validateSceneContent(node, document, diagnostics);
        return diagnostics;
    }
    validateSceneContent(node, document, diagnostics) {
        // Get all content from the scene (between properties and next scene/end)
        const startLine = node.range.start.line;
        const endLine = node.range.end.line;
        for (let i = startLine; i < endLine; i++) {
            const lineText = document.lineAt(i).text;
            if (lineText.trim().startsWith('#')) {
                continue; // Skip comments
            }
            this.validateInlineConditionalsInLine(lineText, i, diagnostics);
        }
    }
    validateInlineConditionalsInLine(lineText, lineNum, diagnostics) {
        // Match ONLY: [? condition : text ?]
        // Brackets are REQUIRED
        const regex = /(\[\?\s*)([^:]+?)\s*:\s*([^?]*)\?\]/gi;
        let match;
        while ((match = regex.exec(lineText)) !== null) {
            const conditionPrefix = match[1]; // '[?'
            const condition = match[2].trim();
            // match[3] is text part (ignored for validation purposes)
            if (!condition) {
                const fullMatchStart = match.index;
                const fullMatchEnd = regex.lastIndex;
                const errRange = new vscode.Range(lineNum, fullMatchStart, lineNum, fullMatchEnd);
                diagnostics.push(this.createDiagnostic(errRange, 'Inline conditional is missing a condition before :', vscode.DiagnosticSeverity.Error));
                continue;
            }
            const preParsedCondition = '(' + condition.slice(2) + ')';
            // Precise condition range: after [? if up to (but not including) first :
            const conditionStartCol = match.index + conditionPrefix.length;
            const conditionEndCol = conditionStartCol + condition.length;
            const conditionRange = new vscode.Range(lineNum, conditionStartCol, lineNum, conditionEndCol);
            // Validate ONLY condition as Dendry logic (condition context: = -> ==)
            const conditionDiagnostics = this.validateDendryCondition(preParsedCondition, conditionRange);
            diagnostics.push(...conditionDiagnostics);
        }
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
            if (key === 'view-if' || key === 'choose-if') {
                diagnostics.push(...this.validateDendryCondition(value ?? '', r));
            }
            else if (key.startsWith('on-')) {
                diagnostics.push(...this.validateDendryAction(value ?? '', r));
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
        // Check for scene references
        // First remove inline dendry conditions and comments
        const cleaned = choiceContent.replace(/\[\?.*?\?\]/g, ''); // ignore inline dendry brackets
        // Match scene IDs: can start with letter/digit/underscore, continue with word chars or hyphens
        const match = cleaned.match(/@([\w][\w-]*)(?::\s*(.+))?/);
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
    validateMetadata(metadata, document) {
        const diagnostics = [];
        const text = document.getText();
        const lines = text.split(/\r?\n/);
        // Find where scenes start (stop checking metadata there)
        let firstSceneLine = lines.length;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim().match(/^@\w/)) {
                firstSceneLine = i;
                break;
            }
        }
        // Check for duplicate metadata properties
        const seenProperties = new Map();
        for (let i = 0; i < firstSceneLine; i++) {
            const trimmed = lines[i].trim();
            const match = trimmed.match(/^([\w-]+):/);
            if (match && !trimmed.startsWith('@')) {
                const propKey = match[1];
                if (seenProperties.has(propKey)) {
                    const duplicateRange = new vscode.Range(i, 0, i, lines[i].length);
                    diagnostics.push(this.createDiagnostic(duplicateRange, `Duplicate metadata property: "${propKey}" (first defined on line ${seenProperties.get(propKey) + 1})`, vscode.DiagnosticSeverity.Warning));
                }
                else {
                    seenProperties.set(propKey, i);
                }
            }
        }
        for (const [key, value] of Object.entries(metadata)) {
            // Skip internal properties
            if (key === 'fileName')
                continue;
            // Find the line with this property (only in the metadata section)
            let lineIndex = -1;
            for (let i = 0; i < firstSceneLine; i++) {
                const trimmed = lines[i].trim();
                if (trimmed.startsWith(`${key}:`) && !trimmed.startsWith('@')) {
                    lineIndex = i;
                    break;
                }
            }
            if (lineIndex === -1)
                continue;
            const line = lines[lineIndex];
            const colonIndex = line.indexOf(':');
            const valueText = line.substring(colonIndex + 1).trim();
            // Calculate proper range for JS blocks
            let range;
            if (valueText.startsWith('{!')) {
                // Multi-line JS block - calculate the actual JS code range
                const afterOpen = valueText.substring(2); // Remove {!
                if (afterOpen.trim().length > 0 && !afterOpen.includes('!}')) {
                    // Code starts on same line as {!
                    const startCol = colonIndex + 1 + valueText.indexOf('{!') + 2;
                    range = new vscode.Range(lineIndex, startCol, lineIndex, line.length);
                }
                else if (valueText.includes('!}')) {
                    // Single line: {! code !}
                    const startCol = colonIndex + 1 + valueText.indexOf('{!') + 2;
                    const endCol = colonIndex + 1 + valueText.indexOf('!}');
                    range = new vscode.Range(lineIndex, startCol, lineIndex, endCol);
                }
                else {
                    // Multi-line block with code starting on next line
                    let startLine = lineIndex + 1;
                    let startCol = 0;
                    // Find the closing !}
                    let endLine = startLine;
                    for (let i = startLine; i < firstSceneLine; i++) {
                        if (lines[i].includes('!}')) {
                            endLine = i;
                            const endCol = lines[i].indexOf('!}');
                            range = new vscode.Range(startLine, startCol, endLine, endCol);
                            break;
                        }
                    }
                    // If we didn't find closing, use until end of metadata
                    if (!range) {
                        range = new vscode.Range(startLine, startCol, firstSceneLine - 1, lines[firstSceneLine - 1].length);
                    }
                }
            }
            else {
                // Regular single-line value
                const valueStart = colonIndex + 1;
                range = new vscode.Range(lineIndex, valueStart, lineIndex, line.length);
            }
            // Validate boolean properties
            if (key === 'new-page' || key === 'is-special' || key === 'is-hand' ||
                key === 'is-deck' || key === 'is-pinned-card' || key === 'is-card') {
                this.validateBoolean(value, range, key, diagnostics);
            }
            // Validate number properties
            if (key === 'max-visits' || key === 'min-choices' || key === 'max-choices' ||
                key === 'frequency' || key === 'order' || key === 'priority' || key === 'max-cards') {
                this.validateNumber(value, range, key, diagnostics);
            }
            // Validate JavaScript properties
            if (key === 'view-if' || key === 'choose-if') {
                diagnostics.push(...this.validateDendryCondition(value ?? '', range));
            }
            else if (key.startsWith('on-')) {
                diagnostics.push(...this.validateDendryAction(value ?? '', range));
            }
            // Validate go-to
            if (key === 'go-to') {
                this.validateGoTo(String(value ?? ''), range, diagnostics);
            }
        }
        return diagnostics;
    }
    validateTag(tagName, range, diagnostics) {
        // Check if any scene in the project has this tag
        let tagFound = false;
        for (const [uri, fileData] of this._allFileData) {
            // Check tags in metadata (top-level scene properties)
            if (fileData.ast.metadata.tags) {
                const metadataTags = String(fileData.ast.metadata.tags)
                    .split(/[,\s]+/)
                    .map(t => t.trim())
                    .filter(t => t.length > 0);
                if (metadataTags.includes(tagName)) {
                    tagFound = true;
                    break;
                }
            }
            // Check tags in explicit scene declarations
            for (const node of fileData.ast.nodes) {
                if (node.type === 'scene') {
                    const tags = node.properties.get('tags');
                    if (tags) {
                        const tagList = String(tags)
                            .split(/[,\s]+/)
                            .map(t => t.trim())
                            .filter(t => t.length > 0);
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
            diagnostics.push(this.createDiagnostic(range, `Tag "${tagName}" is not defined in any scene. Add 'tags: ${tagName}' to a scene to define it.`, vscode.DiagnosticSeverity.Error));
        }
    }
    validateGoTo(value, range, diagnostics) {
        const statements = value.split(';');
        for (const st of statements) {
            const trimmed = st.trim();
            if (!trimmed)
                continue;
            const ifIndex = trimmed.indexOf(' if ');
            if (ifIndex !== -1) {
                // Format: "scene_id if condition"
                const sceneId = trimmed.substring(0, ifIndex).trim();
                const condition = trimmed.substring(ifIndex + 4).trim();
                if (sceneId && sceneId !== 'jumpScene' && sceneId !== "backSpecialScene") {
                    this.validateSceneReference(sceneId, range, diagnostics);
                }
                if (condition) {
                    const conditionDiagnostics = this.validateDendryCondition(condition, range);
                    diagnostics.push(...conditionDiagnostics);
                }
            }
            else {
                // Could be:
                // 1. Just a scene ID: "scene_id"
                // 2. An assignment/action: "variable = value"
                // Check if it looks like a scene reference (no operators)
                const hasOperators = /[=+\-*/<>]/.test(trimmed);
                if (!hasOperators && trimmed !== 'jumpScene' && trimmed !== "backSpecialScene") {
                    // Treat as scene reference
                    this.validateSceneReference(trimmed, range, diagnostics);
                }
                else if (hasOperators) {
                    // It's an action/assignment - validate as Dendry logic
                    const actionDiagnostics = this.validateDendryAction(trimmed, range);
                    diagnostics.push(...actionDiagnostics);
                }
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
        // Get the actual line from the document for accurate column positioning
        const actualLine = document.lineAt(line).text;
        const colonIndex = actualLine.indexOf(':');
        if (colonIndex !== -1) {
            // Calculate from the actual document line
            const afterColon = actualLine.substring(colonIndex + 1);
            const valueStart = afterColon.length - afterColon.trimStart().length;
            const startCol = colonIndex + 1 + valueStart;
            const endCol = startCol + afterColon.trim().length;
            return new vscode.Range(line, startCol, line, endCol);
        }
        else {
            // Fallback to previous calculation
            const startCol = nodeRange.start.character + valueStartIndex + leftTrim;
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
        if (typeof value !== 'string' ||
            (value.toLowerCase() !== 'true' && value.toLowerCase() !== 'false')) {
            diagnostics.push(this.createDiagnostic(range, `Property "${propertyName}" must be "true" or "false", got: "${value}"`, vscode.DiagnosticSeverity.Error));
        }
    }
    convertDendryToJavaScript(dendryCode, isActionContext = false) {
        let jsCode = dendryCode.trim();
        // Handle postfix 'if' syntax: "action if condition" -> "if (condition) { action; }"
        const postfixIfMatch = jsCode.match(/^(.+?)\s+if\s+(.+)$/);
        if (postfixIfMatch) {
            const action = postfixIfMatch[1].trim();
            const condition = postfixIfMatch[2].trim();
            jsCode = `if (${condition}) { ${action}; }`;
        }
        // Convert Dendry comparison operators to JavaScript
        // Do this BEFORE logical operators to avoid issues
        // Replace = with == but not if it's already ==, !=, <=, >=, or ===
        if (!isActionContext) {
            jsCode = jsCode.replace(/([^=!<>+\-*/%])=([^=])/g, '$1==$2');
            // Handle edge case at start of string
            jsCode = jsCode.replace(/^=([^=])/g, '==$1');
        }
        // Convert Dendry logical operators to JavaScript (after comparison conversion)
        jsCode = jsCode.replace(/\band\b/g, '&&');
        jsCode = jsCode.replace(/\bor\b/g, '||');
        jsCode = jsCode.replace(/\bnot\b/g, '!');
        // Match identifiers that are not after a dot and not keywords
        // Use a more careful regex that won't break things
        jsCode = jsCode.replace(/(?:^|[^.])([a-zA-Z_]\w*)(?=[^\w:]|$)/g, (fullMatch, identifier, offset) => {
            // If this is a keyword, don't convert
            if (jsKeywords.has(identifier)) {
                return fullMatch;
            }
            // Get the character before the identifier in the full match
            const prefix = fullMatch.substring(0, fullMatch.length - identifier.length);
            // Don't convert if it's already Q., S., V., or P.
            if (prefix.endsWith('Q.') || prefix.endsWith('S.') ||
                prefix.endsWith('V.') || prefix.endsWith('P.')) {
                return fullMatch;
            }
            // Add Q. prefix, keeping any prefix character (like space, operator, etc.)
            return prefix + 'Q.' + identifier;
        });
        return jsCode;
    }
    validateJavaScript(code, range, isActionContext = false) {
        console.log('Validating JavaScript code:', code);
        const diagnostics = [];
        // Check if this is a full JS block or inline Dendry syntax
        const isJsBlock = range.start.line !== range.end.line || code.includes('\n');
        let jsCode = code;
        if (!isJsBlock) {
            // Convert Dendry shorthand to proper JavaScript
            jsCode = this.convertDendryToJavaScript(code, isActionContext);
        }
        const wrappedCode = `var Q, S, V, P, d3;\n${jsCode}`;
        const errorLines = new Set(); // Track lines with parse errors
        let parseResult = null;
        let parseSucceeded = false;
        try {
            console.log('Parsing for syntax errors...');
            parseResult = esprima.parseScript(wrappedCode, { loc: true, tolerant: true });
            parseSucceeded = true;
            // Collect lines that have parse errors
            if (parseResult.errors && parseResult.errors.length > 0) {
                console.log(`Found ${parseResult.errors.length} parse errors`);
                for (const error of parseResult.errors) {
                    const errLineNumber = error.lineNumber || 1;
                    const errColumn = error.column || 0;
                    const codeLineNumber = errLineNumber - 1;
                    // Track this line as having errors
                    if (isJsBlock) {
                        errorLines.add(codeLineNumber - 1); // Adjust for wrapped code
                    }
                    if (!isJsBlock) {
                        diagnostics.push(this.createDiagnostic(range, `Dendry logic Error: ${error.description || error.message}`, vscode.DiagnosticSeverity.Error));
                    }
                    else {
                        const actualLine = range.start.line + codeLineNumber - 1;
                        const colBase = (codeLineNumber === 0) ? range.start.character : 0;
                        const actualCol = colBase + errColumn;
                        const errRange = new vscode.Range(actualLine, actualCol, actualLine, actualCol + 1);
                        diagnostics.push(this.createDiagnostic(errRange, `JavaScript Error: ${error.description || error.message}`, vscode.DiagnosticSeverity.Error));
                    }
                }
            }
        }
        catch (error) {
            console.log('Parse threw exception:', error.message);
            const errLineNumber = typeof error?.lineNumber === 'number' ? error.lineNumber : 1;
            const errColumn = typeof error?.column === 'number' ? error.column : 0;
            const codeLineNumber = errLineNumber - 1;
            if (!isJsBlock) {
                console.warn("Parse error from: ", jsCode, errLineNumber, codeLineNumber);
                diagnostics.push(this.createDiagnostic(range, `Dendry logic Error: ${error.description || error.message}`, vscode.DiagnosticSeverity.Error));
            }
            else {
                errorLines.add(codeLineNumber - 1);
                const actualLine = range.start.line + codeLineNumber - 1;
                const colBase = (codeLineNumber === 0) ? range.start.character : 0;
                const actualCol = colBase + errColumn;
                const errRange = new vscode.Range(actualLine, actualCol, actualLine, actualCol + 1);
                diagnostics.push(this.createDiagnostic(errRange, `JavaScript Error: ${error.description || error.message}`, vscode.DiagnosticSeverity.Error));
            }
        }
        // Run typo checks ONLY on lines that had parse errors
        if (errorLines.size > 0) {
            this.checkTyposOnErrorLines(jsCode, range, diagnostics, errorLines);
        }
        // Run additional checks if parsing succeeded
        if (parseResult && parseSucceeded) {
            this.checkJavaScriptAst(parseResult, jsCode, range, diagnostics);
            if (isJsBlock) {
                console.log('Checking undefined identifiers...');
                this.checkUndefinedIdentifiers(jsCode, range, diagnostics);
            }
        }
        console.info(`Total diagnostics: ${diagnostics.length}`);
        return diagnostics;
    }
    validateDendryCondition(code, range) {
        return this.validateJavaScript(code, range, false); // = -> ==
    }
    validateDendryAction(code, range) {
        return this.validateJavaScript(code, range, true); // = stays assignment
    }
    checkTyposOnErrorLines(code, range, diagnostics, errorLines) {
        const lines = code.split('\n');
        for (let i = 0; i < lines.length; i++) {
            // ONLY check lines that had parse errors
            if (!errorLines.has(i)) {
                continue;
            }
            const line = lines[i];
            const lineNum = range.start.line + i;
            // Find all potential identifiers/keywords in the line
            const words = line.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
            const jsKeywordsAsArray = Array.from(jsKeywords);
            for (const word of words) {
                // Skip if it's actually a valid keyword
                if (jsKeywordsAsArray.includes(word)) {
                    continue;
                }
                // Check if this word is close to any keyword
                const suggestion = this.findClosestKeyword(word, jsKeywordsAsArray);
                if (suggestion && suggestion.distance <= 2 && suggestion.distance > 0) {
                    // Find the position of this word in the line
                    const wordIndex = line.indexOf(word);
                    if (wordIndex !== -1) {
                        const startCol = wordIndex;
                        const endCol = startCol + word.length;
                        const errRange = new vscode.Range(lineNum, startCol, lineNum, endCol);
                        diagnostics.push(this.createDiagnostic(errRange, `Unknown identifier "${word}". Did you mean "${suggestion.keyword}"?`, vscode.DiagnosticSeverity.Warning));
                    }
                }
            }
        }
    }
    findClosestKeyword(word, keywords) {
        let minDistance = Infinity;
        let closestKeyword = '';
        for (const keyword of keywords) {
            const distance = this.levenshteinDistance(word.toLowerCase(), keyword.toLowerCase());
            if (distance < minDistance) {
                minDistance = distance;
                closestKeyword = keyword;
            }
        }
        // Only suggest if the distance is reasonable (not too far)
        if (minDistance <= Math.max(2, Math.floor(word.length / 3))) {
            return { keyword: closestKeyword, distance: minDistance };
        }
        return null;
    }
    levenshteinDistance(a, b) {
        const an = a.length;
        const bn = b.length;
        if (an === 0)
            return bn;
        if (bn === 0)
            return an;
        const matrix = Array(bn + 1);
        for (let i = 0; i <= bn; i++) {
            matrix[i] = Array(an + 1);
            matrix[i][0] = i;
        }
        for (let j = 0; j <= an; j++) {
            matrix[0][j] = j;
        }
        for (let i = 1; i <= bn; i++) {
            for (let j = 1; j <= an; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                }
                else {
                    matrix[i][j] = Math.min(matrix[i - 1][j - 1], // substitution
                    matrix[i][j - 1], // insertion
                    matrix[i - 1][j] // deletion
                    ) + 1;
                }
            }
        }
        return matrix[bn][an];
    }
    checkJavaScriptAst(ast, code, range, diagnostics) {
        const walk = (node) => {
            if (!node || typeof node !== 'object')
                return;
            // Check for assignment in if condition (common mistake)
            if (node.type === 'IfStatement' && node.test?.type === 'AssignmentExpression') {
                const loc = node.test.loc;
                if (loc) {
                    const lineOffset = loc.start.line - 3;
                    const colBase = lineOffset === 0 ? range.start.character : 0;
                    const errRange = new vscode.Range(range.start.line + lineOffset, colBase + loc.start.column, range.start.line + (loc.end.line - 3), (loc.end.line - 3 === 0 ? range.start.character : 0) + loc.end.column);
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
        console.warn('=== DEBUG checkUndefinedIdentifiers ===');
        console.warn('range.start.line:', range.start.line);
        console.warn('First 5 lines of code:', code.split('\n').slice(0, 5));
        console.warn('last 5 lines of code:', code.split('\n').slice(-5));
        try {
            const ast = esprima.parseScript(`var Q, S, V, P, d3;\n${code}`, { loc: true, tolerant: true });
            // Extended list of defined globals
            const definedVars = new Set([
                'Q', 'S', 'V', 'P', 'd3',
                'console', 'Math', 'Date', 'JSON',
                'parseInt', 'parseFloat', 'isNaN', 'isFinite',
                'undefined', 'null', 'true', 'false',
                'Object', 'Array', 'String', 'Number', 'Boolean',
                'eval', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
                'Error', 'TypeError', 'ReferenceError', 'SyntaxError',
                'Infinity', 'NaN', 'window', 'document', 'alert'
            ]);
            const declaredInCode = new Set();
            const reportedIdentifiers = new Set();
            // Collect all declarations including function parameters
            const collectDeclarations = (node) => {
                if (!node || typeof node !== 'object')
                    return;
                // Variable declarations
                if (node.type === 'VariableDeclarator' && node.id?.name) {
                    declaredInCode.add(node.id.name);
                }
                // Function declarations
                if (node.type === 'FunctionDeclaration' && node.id?.name) {
                    declaredInCode.add(node.id.name);
                }
                // Function parameters (both regular functions and arrow functions)
                if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') && node.params) {
                    for (const param of node.params) {
                        if (param.type === 'Identifier' && param.name) {
                            declaredInCode.add(param.name);
                        }
                        // Handle destructuring parameters
                        if (param.type === 'ObjectPattern' && param.properties) {
                            for (const prop of param.properties) {
                                if (prop.value?.type === 'Identifier' && prop.value.name) {
                                    declaredInCode.add(prop.value.name);
                                }
                            }
                        }
                        if (param.type === 'ArrayPattern' && param.elements) {
                            for (const elem of param.elements) {
                                if (elem?.type === 'Identifier' && elem.name) {
                                    declaredInCode.add(elem.name);
                                }
                            }
                        }
                    }
                }
                // For-in and for-of loop variables
                if (node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
                    if (node.left?.type === 'VariableDeclaration') {
                        for (const decl of node.left.declarations) {
                            if (decl.id?.type === 'Identifier' && decl.id.name) {
                                declaredInCode.add(decl.id.name);
                            }
                        }
                    }
                    else if (node.left?.type === 'Identifier' && node.left.name) {
                        declaredInCode.add(node.left.name);
                    }
                }
                // Catch clause parameters
                if (node.type === 'CatchClause' && node.param?.type === 'Identifier' && node.param.name) {
                    declaredInCode.add(node.param.name);
                }
                // Recursively walk the tree
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
            const checkIdentifiers = (node, parent = null) => {
                if (!node || typeof node !== 'object')
                    return;
                // Check for ExpressionStatement with just an identifier (like "asfasf;")
                if (node.type === 'ExpressionStatement' && node.expression?.type === 'Identifier') {
                    const identifier = node.expression;
                    if (identifier.name && !definedVars.has(identifier.name)) {
                        const loc = identifier.loc;
                        if (loc) {
                            const lineOffset = loc.start.line - 3;
                            const colBase = lineOffset === 0 ? range.start.character : 0;
                            const errRange = new vscode.Range(range.start.line + lineOffset, colBase + loc.start.column, range.start.line + lineOffset, (loc.end.line - 3 === 0 ? range.start.character : 0) + loc.end.column);
                            diagnostics.push(this.createDiagnostic(errRange, `Undefined identifier: "${identifier.name}"`, vscode.DiagnosticSeverity.Error));
                            reportedIdentifiers.add(identifier.name);
                        }
                    }
                }
                if (node.type === 'Identifier' && node.name && !definedVars.has(node.name)) {
                    if (reportedIdentifiers.has(node.name)) {
                        // Skip to children
                        for (const key in node) {
                            if (key === 'loc' || key === 'range')
                                continue;
                            const child = node[key];
                            if (Array.isArray(child)) {
                                child.forEach(c => checkIdentifiers(c, node));
                            }
                            else if (child && typeof child === 'object') {
                                checkIdentifiers(child, node);
                            }
                        }
                        return;
                    }
                    const loc = node.loc;
                    if (loc) {
                        const lineOffset = loc.start.line - 3;
                        const colBase = lineOffset === 0 ? range.start.character : 0;
                        const errRange = new vscode.Range(range.start.line + lineOffset, colBase + loc.start.column, range.start.line + lineOffset, colBase + loc.end.column);
                        // Check if this is actually a reference (not a property name)
                        const isPropertyName = parent && ((parent.type === 'MemberExpression' && parent.property === node && !parent.computed) ||
                            (parent.type === 'Property' && parent.key === node && !parent.computed));
                        if (!isPropertyName) {
                            diagnostics.push(this.createDiagnostic(errRange, `Undefined identifier: "${node.name}"`, vscode.DiagnosticSeverity.Warning));
                        }
                    }
                }
                // Recursively check children
                for (const key in node) {
                    if (key === 'loc' || key === 'range')
                        continue;
                    const child = node[key];
                    if (Array.isArray(child)) {
                        child.forEach(c => checkIdentifiers(c, node));
                    }
                    else if (child && typeof child === 'object') {
                        checkIdentifiers(child, node);
                    }
                }
            };
            console.log('Starting identifier check...');
            checkIdentifiers(ast);
            console.log('Identifier check completed, total diagnostics so far:', diagnostics.length);
        }
        catch (error) {
            console.log('Cannot check undefined identifiers due to syntax errors', error);
            // Parsing already failed, errors already reported
            return;
        }
    }
    validateSceneReference(sceneId, range, diagnostics) {
        if (sceneId.includes('{') || sceneId.includes('$'))
            return; // dynamic references ignored for now
        // "jumpScene" is a reserved keyword, valid as a reference but not as a definition
        if (sceneId === 'jumpScene' || sceneId === "backSpecialScene") {
            return; // Valid reference, no error
        }
        // Simple local/global id
        if (!sceneId.includes('.')) {
            if (!this.sceneIds.has(sceneId)) {
                diagnostics.push(this.createDiagnostic(range, `Reference to undefined scene: "${sceneId}"`, vscode.DiagnosticSeverity.Error));
            }
            return;
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