import { ControlSource } from './scene-control';

export const BUILTIN_QDISPLAYS = new Set(['cardinal', 'ordinal', 'number', 'fudge']);
export function qdisplayIdFromPath(path: string): string | undefined {
  const filename = path.split(/[/\\]/).pop() || '';
  return filename.endsWith('.qdisplay.dry') ? filename.slice(0, -'.qdisplay.dry'.length) : undefined;
}
export interface QDisplayIssue { source: ControlSource; message: string }
export interface QDisplayRange { min?: number; max?: number; source: ControlSource; output?: ControlSource }

// Pinned qdcontent.js syntax. Decimal endpoints require complete tokens. Source
// order is retained; the engine chooses the first inclusive matching range.
const rangePattern = /^\((-?[0-9]+(?:\.[0-9]+)?|-?\.[0-9]+)?\s*(,|-|to|\.\.|\+)\s*(-?[0-9]+(?:\.[0-9]+)?|-?\.[0-9]+)?\)\s*(.*)$/m;

export function parseQDisplay(text: string, path: string): { id?: string; ranges: QDisplayRange[]; issues: QDisplayIssue[] } {
  const lines = text.split(/\r?\n/);
  const id = qdisplayIdFromPath(path);
  const issues: QDisplayIssue[] = [];
  const ranges: QDisplayRange[] = [];
  const sourceAt = (line: number) => ControlSource.literal(lines[line], line);
  const fail = (source: ControlSource, message: string) => issues.push({ source, message });
  if (!id || !/^[A-Za-z][\-A-Za-z0-9_]*$/.test(id)) fail(sourceAt(0).slice(0, 0), 'Invalid filename-derived QDisplay name.');
  else if (BUILTIN_QDISPLAYS.has(id)) fail(sourceAt(0).slice(0, 0), `QDisplay name '${id}' is reserved for a built-in formatter.`);

  // Mirror the dry parser's property/body separator, column-zero comments and
  // collapsed internal blank paragraphs. Leading/trailing blank lines disappear.
  const body: ControlSource[] = [];
  let inBody = false;
  let pendingBlank: number | undefined;
  for (let line = 0; line < lines.length; line++) {
    const value = lines[line];
    if (value.startsWith('#')) continue;
    if (!value.trim()) {
      if (!inBody) inBody = true;
      else if (body.length && pendingBlank === undefined) pendingBlank = line;
      continue;
    }
    if (value.startsWith('@')) { fail(sourceAt(line), 'Sections are not supported in QDisplay files.'); return { id, ranges, issues }; }
    if (!inBody) {
      const property = value.match(/^([A-Za-z][A-Za-z_ -]*[A-Za-z])\s*:/);
      if (property) {
        const name = property[1].trim();
        const reserved = ['id', 'type', 'sections', 'content', 'options'].includes(name.toLowerCase().replace(/[_ -]/g, ''));
        fail(sourceAt(line), reserved ? `QDisplay property '${name}' is reserved or already defined.` : `Unknown QDisplay property '${name}'.`);
      } else fail(sourceAt(line), 'QDisplay ranges require a blank line before content.');
      return { id, ranges, issues };
    }
    if (pendingBlank !== undefined) { body.push(sourceAt(pendingBlank).slice(0, 0)); pendingBlank = undefined; }
    body.push(sourceAt(line));
  }
  if (!body.length) fail(sourceAt(0).slice(0, 0), 'QDisplay requires at least one range declaration.');
  for (let index = 0; index < body.length;) {
    let source = body[index++];
    while (index < body.length && /^\s+\S+/.test(body[index].text)) {
      const last = source.position(source.text.length);
      source = source.concat(ControlSource.literal('\n', last.line, last.character)).concat(body[index++]);
    }
    const match = rangePattern.exec(source.text);
    if (!match) { fail(source, 'Invalid QDisplay range declaration. Expected (start..end) text or another supported range separator.'); continue; }
    let min = match[1] === undefined ? undefined : parseFloat(match[1]);
    let max = match[3] === undefined ? undefined : parseFloat(match[3]);
    if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
    const output = match[4].trim() ? source.slice(match.index + match[0].length - match[4].length, match.index + match[0].length) : undefined;
    // Upstream consumes continuation lines, but its regex only captures one
    // output line (possibly the first continuation if the first output is empty).
    ranges.push({ min, max, source, output });
  }
  return { id, ranges, issues };
}
