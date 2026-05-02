import * as acorn from 'acorn';

export interface ParseError {
  message: string;
  // 0-based line within the source string
  line: number;
  column: number;
}

export interface ParseResult {
  ast: acorn.Node | null;
  error: ParseError | null;
}

// Parses source as a script. Returns the AST on success, or a normalized
// error with 0-based line/column positions on failure.
export function parseScript(source: string): ParseResult {
  try {
    const ast = acorn.parse(source, {
      ecmaVersion: 2022,
      sourceType: 'script',
      locations: true,
    });
    return { ast: ast as unknown as acorn.Node, error: null };
  } catch (err: any) {
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
