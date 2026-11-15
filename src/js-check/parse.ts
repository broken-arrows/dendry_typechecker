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

// Match new Function('state', 'Q', source), including parameter collisions,
// new.target and directives. Merely allowing top-level return is insufficient.
export function parseScript(source: string, functionBody = false): ParseResult {
  const prefix = '(function(state, Q) {\n';
  const input = functionBody ? prefix + source + '\n})' : source;
  try {
    const ast = acorn.parse(input, {
      ecmaVersion: 2022,
      sourceType: 'script',
      locations: true,
    });
    if (functionBody) {
      const fn = (ast as any).body[0]?.expression;
      // User source cannot close the synthetic function and escape its body.
      if ((ast as any).body.length !== 1 || fn?.type !== 'FunctionExpression' || fn.end !== input.length - 1) {
        const offset = Math.max(0, (fn?.end ?? prefix.length) - prefix.length - 1);
        const before = source.slice(0, offset).split('\n');
        return { ast: null, error: { message: 'Unexpected closing brace', line: before.length - 1, column: before[before.length - 1].length } };
      }
      // Keep only authored nodes; normalize their locations back to source.
      const body = fn.body;
      // Shorthand property keys/values can share location objects.
      const locations = new Set<object>();
      const normalize = (node: any) => {
        if (!node || typeof node.type !== 'string') return;
        if (node.loc) for (const position of [node.loc.start, node.loc.end]) {
          if (!locations.has(position)) {
            locations.add(position);
            position.line--;
          }
        }
        for (const key of Object.keys(node)) {
          if (key === 'loc') continue;
          const child = node[key];
          if (Array.isArray(child)) child.forEach(normalize);
          else if (child && typeof child.type === 'string') normalize(child);
        }
      };
      normalize(body);
      return { ast: body, error: null };
    }
    return { ast: ast as unknown as acorn.Node, error: null };
  } catch (err: any) {
    const lines = source.split('\n');
    const reportedLine = (err?.loc?.line ?? 1) - 1 - (functionBody ? 1 : 0);
    const line = Math.max(0, Math.min(reportedLine, lines.length - 1));
    const column = reportedLine > line ? lines[line].length : Math.min(err?.loc?.column ?? 0, lines[line].length);
    return {
      ast: null,
      error: {
        message: String(err?.message ?? err).replace(/\s*\(\d+:\d+\)$/, ''),
        line,
        column,
      },
    };
  }
}
