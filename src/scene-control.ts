// Source-preserving property collection and destination clauses. The oddities
// here (including split(..., 2)) intentionally follow pinned dry.js/validators.js.
export interface SourcePosition { line: number; character: number }

export class ControlSource {
  constructor(
    readonly text: string,
    private readonly positions: SourcePosition[],
    private readonly fallback: SourcePosition,
  ) {}

  position(offset: number): SourcePosition {
    if (offset < this.positions.length) return this.positions[Math.max(0, offset)];
    const last = this.positions[this.positions.length - 1];
    if (!last) return this.fallback;
    return this.text.endsWith('\n')
      ? { line: last.line + 1, character: 0 }
      : { line: last.line, character: last.character + 1 };
  }

  positionAt(line: number, column: number): SourcePosition {
    let offset = 0;
    for (let i = 0; i < line; i++) offset = this.text.indexOf('\n', offset) + 1;
    return this.position(offset + column);
  }

  slice(start: number, end = this.text.length): ControlSource {
    return new ControlSource(this.text.slice(start, end), this.positions.slice(start, end), this.position(start));
  }

  trim(): ControlSource {
    const start = this.text.length - this.text.trimStart().length;
    return this.slice(start, start + this.text.trim().length);
  }

  concat(other: ControlSource): ControlSource {
    return new ControlSource(this.text + other.text, [...this.positions, ...other.positions], this.fallback);
  }
}

function endsInMagic(previous: boolean, text: string): boolean {
  const open = text.lastIndexOf('{!');
  const close = text.lastIndexOf('!}');
  return open === close ? previous : open > close;
}

// The parser has already established which lines belong to this property.
// Reconstruct its collected value with delimiters intact and a source map.
export function controlPropertySource(header: string, startLine: number): ControlSource {
  const lines = header.split(/\r?\n/);
  const positions: SourcePosition[] = [];
  let text = '';
  let inMagic = false;
  const append = (value: string, line: number, column: number) => {
    text += value;
    for (let i = 0; i < value.length; i++) positions.push({ line, character: column + i });
  };
  for (let i = 0; i < lines.length; i++) {
    const column = i === 0 ? lines[i].indexOf(':') + 1 : 0;
    const raw = lines[i].slice(column);
    const startedInMagic = inMagic;
    inMagic = endsInMagic(inMagic, raw);
    if (i === 0) append(raw, startLine, column);
    else if (startedInMagic) append(raw.trimEnd(), startLine + i, 0);
    else {
      append(' ', startLine + i, Math.max(0, raw.length - raw.trimStart().length - 1));
      append(raw.trim(), startLine + i, raw.length - raw.trimStart().length);
    }
    if (inMagic) append('\n', startLine + i, lines[i].length);
  }
  return new ControlSource(text, positions, { line: startLine, character: lines[0].length }).trim();
}

export interface DestinationClause { target: ControlSource; predicate?: ControlSource }

export function destinationClauses(value: ControlSource): { clauses: DestinationClause[]; unclosedMagic: boolean } {
  const chunks: ControlSource[] = [];
  let inMagic = false;
  let start = 0;
  let separator: ControlSource | undefined;
  const add = (end: number) => {
    const chunk = value.slice(start, end);
    if (inMagic) chunks[chunks.length - 1] = chunks[chunks.length - 1].concat(separator!).concat(chunk);
    else chunks.push(chunk);
    inMagic = endsInMagic(inMagic, chunk.text);
  };
  for (const match of value.text.matchAll(/\s*;\s*/g)) {
    add(match.index!);
    const semi = match.index! + match[0].indexOf(';');
    separator = value.slice(semi, semi + 1);
    start = match.index! + match[0].length;
  }
  add(value.text.length);
  return {
    unclosedMagic: inMagic,
    clauses: chunks.map(chunk => {
      const separators = [...chunk.text.matchAll(/\s+if\s+/g)];
      if (!separators.length) return { target: chunk.trim() };
      const first = separators[0];
      return {
        target: chunk.slice(0, first.index!).trim(),
        predicate: chunk.slice(first.index! + first[0].length, separators[1]?.index).trim(),
      };
    }),
  };
}
