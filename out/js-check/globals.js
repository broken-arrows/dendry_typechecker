"use strict";
// Identifiers that should be considered "defined" when checking for
// undefined references in embedded JavaScript.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DENDRY_GLOBALS = exports.RUNTIME_GLOBALS = exports.JS_KEYWORDS = void 0;
// Standard JS keywords and built-ins that may appear bare in code.
exports.JS_KEYWORDS = [
    'true', 'false', 'null', 'undefined',
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
    'break', 'continue', 'return', 'throw', 'try', 'catch', 'finally',
    'function', 'var', 'let', 'const', 'new', 'this', 'typeof', 'instanceof',
    'Math', 'console', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
    'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'JSON', 'Error',
    'in', 'of', 'async', 'await',
    'class', 'extends', 'static', 'import', 'export', 'yield', 'delete', 'void',
    'super', 'with', 'debugger', 'enum', 'implements',
    'interface', 'package', 'private', 'protected', 'public',
];
// Browser/runtime globals plus DendryNexus-specific globals.
exports.RUNTIME_GLOBALS = [
    'console', 'Math', 'Date', 'JSON',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite',
    'undefined', 'null', 'true', 'false',
    'Object', 'Array', 'String', 'Number', 'Boolean',
    'eval', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'Error', 'TypeError', 'ReferenceError', 'SyntaxError',
    'Infinity', 'NaN', 'window', 'document', 'alert',
];
// DendryNexus engine identifiers — the prefix accessors and shared state objects.
exports.DENDRY_GLOBALS = [
    'Q', 'S', 'P', 'V',
    'dendryUI', 'Image', 'data', 'localStorage', 'parliament',
];
//# sourceMappingURL=globals.js.map