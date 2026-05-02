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
exports.parseScript = parseScript;
const acorn = __importStar(require("acorn"));
// Parses source as a script. Returns the AST on success, or a normalized
// error with 0-based line/column positions on failure.
function parseScript(source) {
    try {
        const ast = acorn.parse(source, {
            ecmaVersion: 2022,
            sourceType: 'script',
            locations: true,
        });
        return { ast: ast, error: null };
    }
    catch (err) {
        const line = (err?.loc?.line ?? 1) - 1;
        const column = err?.loc?.column ?? 0;
        return {
            ast: null,
            error: {
                message: err?.message ?? String(err),
                line,
                column,
            },
        };
    }
}
//# sourceMappingURL=parse.js.map