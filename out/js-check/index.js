"use strict";
// Public API for embedded-JavaScript validation. Returns Finding[] with
// positions relative to the source string passed in. Callers translate
// those positions into document positions for VS Code diagnostics.
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkScript = checkScript;
const globals_1 = require("./globals");
const parse_1 = require("./parse");
const scope_1 = require("./scope");
const suggest_1 = require("./suggest");
const ALL_GLOBALS = new Set([
    ...globals_1.JS_KEYWORDS,
    ...globals_1.RUNTIME_GLOBALS,
    ...globals_1.DENDRY_GLOBALS,
]);
function checkScript(source, opts = {}) {
    const findings = [];
    const known = new Set(ALL_GLOBALS);
    if (opts.extraGlobals) {
        for (const g of opts.extraGlobals)
            known.add(g);
    }
    const { ast, error } = (0, parse_1.parseScript)(source);
    if (error) {
        findings.push({
            startLine: error.line,
            startColumn: error.column,
            endLine: error.line,
            endColumn: error.column + 1,
            message: `JavaScript Error: ${error.message}`,
            severity: 'error',
            kind: 'parse-error',
        });
        findings.push(...findTyposOnLine(source, error.line, known));
        return findings;
    }
    if (!ast)
        return findings;
    for (const decl of (0, scope_1.collectDeclarations)(ast))
        known.add(decl);
    for (const ac of (0, scope_1.findAssignmentsInConditions)(ast)) {
        findings.push({
            startLine: ac.line,
            startColumn: ac.column,
            endLine: ac.endLine,
            endColumn: ac.endColumn,
            message: 'Possible mistake: assignment (=) in condition, did you mean comparison (==)?',
            severity: 'warning',
            kind: 'assignment-in-condition',
        });
    }
    if (opts.checkUndefined !== false) {
        const severity = opts.undefinedSeverity ?? 'hint';
        for (const ref of (0, scope_1.findUndefinedReferences)(ast, known)) {
            const suggestion = (0, suggest_1.findClosestMatch)(ref.name, known);
            const message = suggestion
                ? `Possible undefined identifier or variable: "${ref.name}". Did you mean "${suggestion.candidate}"?`
                : `Possible undefined identifier or variable: "${ref.name}"`;
            findings.push({
                startLine: ref.line,
                startColumn: ref.column,
                endLine: ref.endLine,
                endColumn: ref.endColumn,
                message,
                severity,
                kind: 'undefined-identifier',
            });
        }
    }
    return findings;
}
// When parsing fails we can't trust the AST, but we can still scan the
// failing line for words that look like typos of JS keywords.
function findTyposOnLine(source, line, known) {
    const lines = source.split('\n');
    if (line < 0 || line >= lines.length)
        return [];
    const text = lines[line];
    const findings = [];
    const wordRe = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
    const keywords = globals_1.JS_KEYWORDS;
    let match;
    while ((match = wordRe.exec(text)) !== null) {
        const word = match[0];
        if (known.has(word))
            continue;
        const suggestion = (0, suggest_1.findClosestMatch)(word, keywords);
        if (!suggestion)
            continue;
        findings.push({
            startLine: line,
            startColumn: match.index,
            endLine: line,
            endColumn: match.index + word.length,
            message: `Unknown identifier "${word}". Did you mean "${suggestion.candidate}"?`,
            severity: 'warning',
            kind: 'typo',
        });
    }
    return findings;
}
//# sourceMappingURL=index.js.map