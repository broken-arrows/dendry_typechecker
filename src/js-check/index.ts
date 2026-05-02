// Public API for embedded-JavaScript validation. Returns Finding[] with
// positions relative to the source string passed in. Callers translate
// those positions into document positions for VS Code diagnostics.

import { JS_KEYWORDS, RUNTIME_GLOBALS, DENDRY_GLOBALS } from './globals';
import { parseScript } from './parse';
import {
  collectDeclarations,
  findUndefinedReferences,
  findAssignmentsInConditions,
} from './scope';
import { findClosestMatch } from './suggest';

export type FindingSeverity = 'error' | 'warning' | 'hint';

export interface Finding {
  // 0-based line within the source string passed to checkScript
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  message: string;
  severity: FindingSeverity;
  // Tag so the caller can filter / re-severity by category
  kind: 'parse-error' | 'typo' | 'undefined-identifier' | 'assignment-in-condition';
}

export interface JsCheckOptions {
  // Extra identifiers to treat as defined (qualities, scenes, user libs).
  extraGlobals?: Iterable<string>;
  // Whether to flag bare identifiers that don't resolve to a global or
  // a declaration. Defaults to true.
  checkUndefined?: boolean;
  // Severity to use for undefined-identifier findings. Defaults to 'hint'.
  undefinedSeverity?: FindingSeverity;
}

const ALL_GLOBALS = new Set<string>([
  ...JS_KEYWORDS,
  ...RUNTIME_GLOBALS,
  ...DENDRY_GLOBALS,
]);

export function checkScript(source: string, opts: JsCheckOptions = {}): Finding[] {
  const findings: Finding[] = [];
  const known = new Set<string>(ALL_GLOBALS);
  if (opts.extraGlobals) {
    for (const g of opts.extraGlobals) known.add(g);
  }

  const { ast, error } = parseScript(source);

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

  if (!ast) return findings;

  for (const decl of collectDeclarations(ast)) known.add(decl);

  for (const ac of findAssignmentsInConditions(ast)) {
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
    for (const ref of findUndefinedReferences(ast, known)) {
      const suggestion = findClosestMatch(ref.name, known);
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
function findTyposOnLine(source: string, line: number, known: ReadonlySet<string>): Finding[] {
  const lines = source.split('\n');
  if (line < 0 || line >= lines.length) return [];
  const text = lines[line];
  const findings: Finding[] = [];
  const wordRe = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
  const keywords = JS_KEYWORDS;

  let match: RegExpExecArray | null;
  while ((match = wordRe.exec(text)) !== null) {
    const word = match[0];
    if (known.has(word)) continue;
    const suggestion = findClosestMatch(word, keywords);
    if (!suggestion) continue;
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
