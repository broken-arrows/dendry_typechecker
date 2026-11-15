// Public API for embedded-JavaScript validation. Returns Finding[] with
// positions relative to the source string passed in. Callers translate
// those positions into document positions for VS Code diagnostics.

import { RUNTIME_GLOBALS, DENDRY_GLOBALS } from './globals';
import { parseScript } from './parse';
import {
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
  kind: 'parse-error' | 'undefined-identifier' | 'assignment-in-condition';
}

export interface JsCheckOptions {
  // Embedded engine JavaScript is a function body and may return values.
  functionBody?: boolean;
  // Extra globals provided by the game/page (configured libraries).
  extraGlobals?: Iterable<string>;
  // Whether to flag bare identifiers that don't resolve to a global or
  // a declaration. Defaults to true.
  checkUndefined?: boolean;
  // Severity to use for undefined-identifier findings. Defaults to 'hint'.
  undefinedSeverity?: FindingSeverity;
}

const ALL_GLOBALS = new Set<string>([
  ...RUNTIME_GLOBALS,
  ...DENDRY_GLOBALS,
]);

export function checkScript(source: string, opts: JsCheckOptions = {}): Finding[] {
  const findings: Finding[] = [];
  const known = new Set<string>(ALL_GLOBALS);
  if (opts.extraGlobals) {
    for (const g of opts.extraGlobals) known.add(g);
  }
  if (opts.functionBody) known.add('arguments');

  const { ast, error } = parseScript(source, opts.functionBody);

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
    // Without an AST, scanning words mistakes property names and string contents for keyword typos. Report the actual syntax error only.
    return findings;
  }

  if (!ast) return findings;

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
      const suggestion = findClosestMatch(ref.name, ref.visibleNames);
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
