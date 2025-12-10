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
class DendryValidator {
    constructor(strictMode = false) {
        this.sceneIds = new Set();
        this.qualityIds = new Set();
        // Valid Dendry property types
        this.SCENE_PROPERTIES = new Set([
            'id', 'title', 'subtitle', 'tags', 'order', 'frequency',
            'max-visits', 'min-choices', 'max-choices', 'new-page',
            'signal', 'content', 'on-arrival', 'on-display', 'on-departure',
            'view-if', 'choose-if', 'priority', 'unavailable-subtitle'
        ]);
        this.QUALITY_PROPERTIES = new Set([
            'id', 'name', 'initial', 'min', 'max', 'signal'
        ]);
        this.CHOICE_PROPERTIES = new Set([
            'view-if', 'choose-if', 'on-choose', 'go-to', 'priority',
            'unavailable-subtitle', 'min-choices', 'max-choices'
        ]);
        this.strictMode = strictMode;
    }
    validate(ast, document) {
        const diagnostics = [];
        this.sceneIds.clear();
        this.qualityIds.clear();
        // First pass: collect all scene and quality IDs
        for (const node of ast.nodes) {
            if (node.type === 'scene' || node.type === 'root') {
                const id = node.properties.get('id');
                if (id) {
                    this.sceneIds.add(id);
                }
            }
            else if (node.type === 'quality') {
                const id = node.properties.get('id');
                if (id) {
                    this.qualityIds.add(id);
                }
            }
        }
        // Second pass: validate each node
        for (const node of ast.nodes) {
            diagnostics.push(...this.validateNode(node, document));
        }
        return diagnostics;
    }
    validateNode(node, document) {
        const diagnostics = [];
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
        }
        return diagnostics;
    }
    validateScene(node, document) {
        const diagnostics = [];
        // Check required properties
        if (!node.properties.has('id')) {
            diagnostics.push(this.createDiagnostic(node.range, 'Scene must have an "id" property', vscode.DiagnosticSeverity.Error));
        }
        // Validate property types
        for (const [key, value] of node.properties.entries()) {
            if (!this.SCENE_PROPERTIES.has(key)) {
                diagnostics.push(this.createDiagnostic(node.range, `Unknown scene property: "${key}"`, this.strictMode ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning));
            }
            // Type checking for specific properties
            if (key === 'max-visits' || key === 'min-choices' || key === 'max-choices' ||
                key === 'frequency' || key === 'order' || key === 'priority') {
                if (isNaN(Number(value))) {
                    diagnostics.push(this.createDiagnostic(node.range, `Property "${key}" must be a number, got: "${value}"`, vscode.DiagnosticSeverity.Error));
                }
            }
            // Validate JavaScript in on-* properties
            if (key.startsWith('on-') || key === 'view-if' || key === 'choose-if') {
                diagnostics.push(...this.validateJavaScript(value, node.range));
            }
            // Validate go-to references
            if (key === 'go-to') {
                this.validateSceneReference(value, node.range, diagnostics);
            }
        }
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
                if (isNaN(Number(value))) {
                    diagnostics.push(this.createDiagnostic(node.range, `Property "${key}" must be a number, got: "${value}"`, vscode.DiagnosticSeverity.Error));
                }
            }
        }
        // Validate min/max constraints
        const min = node.properties.get('min');
        const max = node.properties.get('max');
        if (min !== undefined && max !== undefined) {
            if (Number(min) > Number(max)) {
                diagnostics.push(this.createDiagnostic(node.range, 'Quality "min" value cannot be greater than "max" value', vscode.DiagnosticSeverity.Error));
            }
        }
        return diagnostics;
    }
    validateChoice(node, document) {
        const diagnostics = [];
        // Validate property types
        for (const [key, value] of node.properties.entries()) {
            if (!this.CHOICE_PROPERTIES.has(key)) {
                diagnostics.push(this.createDiagnostic(node.range, `Unknown choice property: "${key}"`, this.strictMode ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning));
            }
            // Validate JavaScript
            if (key === 'view-if' || key === 'choose-if' || key === 'on-choose') {
                diagnostics.push(...this.validateJavaScript(value, node.range));
            }
            // Validate scene references
            if (key === 'go-to') {
                this.validateSceneReference(value, node.range, diagnostics);
            }
            // Type checking for numeric properties
            if (key === 'priority' || key === 'min-choices' || key === 'max-choices') {
                if (isNaN(Number(value))) {
                    diagnostics.push(this.createDiagnostic(node.range, `Property "${key}" must be a number, got: "${value}"`, vscode.DiagnosticSeverity.Error));
                }
            }
        }
        return diagnostics;
    }
    validateJavaScript(code, range) {
        const diagnostics = [];
        try {
            // Basic syntax check using Function constructor
            new Function(code);
            // Check for common quality access patterns
            const qualityPattern = /Q\\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
            let match;
            while ((match = qualityPattern.exec(code)) !== null) {
                const qualityId = match[1];
                if (!this.qualityIds.has(qualityId)) {
                    diagnostics.push(this.createDiagnostic(range, `Reference to undefined quality: "${qualityId}"`, vscode.DiagnosticSeverity.Warning));
                }
            }
        }
        catch (error) {
            diagnostics.push(this.createDiagnostic(range, `Invalid JavaScript: ${error instanceof Error ? error.message : String(error)}`, vscode.DiagnosticSeverity.Error));
        }
        return diagnostics;
    }
    validateSceneReference(sceneId, range, diagnostics) {
        // Handle dynamic references
        if (sceneId.includes('{') || sceneId.includes('$')) {
            return; // Skip validation for dynamic references
        }
        if (!this.sceneIds.has(sceneId)) {
            diagnostics.push(this.createDiagnostic(range, `Reference to undefined scene: "${sceneId}"`, vscode.DiagnosticSeverity.Error));
        }
    }
    createDiagnostic(range, message, severity) {
        const diagnostic = new vscode.Diagnostic(range, message, severity);
        diagnostic.source = 'dendry';
        return diagnostic;
    }
}
exports.DendryValidator = DendryValidator;
//# sourceMappingURL=validator.js.map