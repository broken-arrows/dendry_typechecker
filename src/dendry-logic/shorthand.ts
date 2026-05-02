// Convert Dendry-shorthand expressions/actions into JavaScript that
// acorn can parse. The goal is structural validity for downstream
// type-checking — not faithful semantic emission. The upstream
// `logic.js` parser is the source of truth at runtime.

export interface ConversionError {
  // 0-based offset within the original source string
  offset: number;
  length: number;
  message: string;
}

export interface PrefixWarning {
  // 0-based offset within the original source string
  offset: number;
  length: number;
  prefix: 'Q' | 'S' | 'V' | 'P';
  identifier: string;
}

export interface ConversionResult {
  jsSource: string;
  errors: ConversionError[];
  prefixWarnings: PrefixWarning[];
}

// Convert a Dendry condition (predicate context: `=` is comparison).
export function convertCondition(source: string): ConversionResult {
  return convert(source, /* isAction */ false);
}

// Convert a Dendry action (statement context: `=` stays as assignment).
export function convertAction(source: string): ConversionResult {
  return convert(source, /* isAction */ true);
}

function convert(source: string, isAction: boolean): ConversionResult {
  const errors: ConversionError[] = [];
  const prefixWarnings: PrefixWarning[] = [];

  const statements = source.split(';').map(s => s.trim()).filter(s => s.length > 0);

  const converted: string[] = [];
  for (const stmt of statements) {
    const result = convertStatement(stmt, isAction, source);
    errors.push(...result.errors);
    prefixWarnings.push(...result.prefixWarnings);
    if (result.jsSource !== null) converted.push(result.jsSource);
  }

  return {
    jsSource: converted.join('; '),
    errors,
    prefixWarnings,
  };
}

interface StatementResult {
  jsSource: string | null;
  errors: ConversionError[];
  prefixWarnings: PrefixWarning[];
}

function convertStatement(stmt: string, isAction: boolean, fullSource: string): StatementResult {
  const errors: ConversionError[] = [];
  const prefixWarnings = collectPrefixWarnings(stmt, fullSource);

  // Postfix-if: "action if condition" or "action if condition else command"
  const postfixIfMatch = stmt.match(/^(.+?)\s+if\s+(.+)$/);

  if (!postfixIfMatch && stmt.endsWith(' if')) {
    errors.push({
      offset: locateInSource(stmt, fullSource),
      length: stmt.length,
      message: 'Unexpected end of conditional statement: "if" block cannot be empty.',
    });
    return { jsSource: null, errors, prefixWarnings };
  }

  if (postfixIfMatch) {
    const action = postfixIfMatch[1].trim();
    let condition = postfixIfMatch[2].trim();

    let elseAction: string | null = null;
    const postElseMatch = condition.match(/^(.+?)\s+else\s+(.+)$/);
    if (!postElseMatch && condition.endsWith(' else')) {
      errors.push({
        offset: locateInSource(stmt, fullSource),
        length: stmt.length,
        message: 'Unexpected end of conditional statement: "else" block cannot be empty.',
      });
      return { jsSource: null, errors, prefixWarnings };
    }
    if (postElseMatch) {
      condition = postElseMatch[1].trim();
      elseAction = postElseMatch[2].trim();
    }

    const convertedCondition = convertLogicalOperators(convertComparators(condition));
    let jsCode = `if (${convertedCondition}) { ${action} }`;
    if (elseAction !== null) {
      const elseConverted = convert(elseAction, isAction).jsSource;
      jsCode += ` else { ${elseConverted} }`;
    }
    return { jsSource: jsCode, errors, prefixWarnings };
  }

  let jsCode = stmt;
  if (!isAction) jsCode = convertComparators(jsCode);
  jsCode = convertLogicalOperators(jsCode);

  return { jsSource: jsCode, errors, prefixWarnings };
}

// Replace `=` with `==`, but leave `==`, `!=`, `<=`, `>=`, `===` alone.
function convertComparators(code: string): string {
  let result = code.replace(/([^=!<>])=([^=])/g, '$1==$2');
  result = result.replace(/^=([^=])/g, '==$1');
  return result;
}

function convertLogicalOperators(code: string): string {
  return code
    .replace(/\band\b/g, '&&')
    .replace(/\bor\b/g, '||')
    .replace(/\bnot\b/g, '!');
}

// Detect Q./S./V./P. prefix usage in a Dendry shorthand statement. The
// upstream compiler doesn't accept these prefixes in shorthand (bare
// `foo` is mapped to `Q['foo']`), so prefixed usage is almost always a
// confused user.
function collectPrefixWarnings(stmt: string, fullSource: string): PrefixWarning[] {
  const warnings: PrefixWarning[] = [];
  const re = /\b([QSVP])\.([A-Za-z_][\w-]*)/g;
  const stmtOffset = locateInSource(stmt, fullSource);
  let match: RegExpExecArray | null;
  while ((match = re.exec(stmt)) !== null) {
    warnings.push({
      offset: stmtOffset + match.index,
      length: match[0].length,
      prefix: match[1] as 'Q' | 'S' | 'V' | 'P',
      identifier: match[2],
    });
  }
  return warnings;
}

// First-occurrence index. Sufficient for typical usage (each statement
// appears at most once); for repeated identical statements the warning
// will collapse onto the first instance, matching prior behavior.
function locateInSource(stmt: string, fullSource: string): number {
  const idx = fullSource.indexOf(stmt);
  return idx === -1 ? 0 : idx;
}
