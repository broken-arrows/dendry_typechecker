/*!
 * Adapted from Dendry's content.js, pinned at 2df80695.
 * Copyright (c) 2014-2015 Ian Millington
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { ControlSource } from './scene-control';

export interface ContentDependency {
  kind: 'predicate' | 'expression';
  language: 'logic' | 'magic';
  source: ControlSource;
  qdisplay?: ControlSource;
}
export interface ContentIssue { source: ControlSource; message: string }
export interface RichContent { dependencies: ContentDependency[]; issues: ContentIssue[] }

type Element = ControlSource | ContentRange;
interface ContentRange { type: string; content?: Element[]; source: ControlSource }
interface Boundary { feature: string; type: 'start' | 'end' | 'single'; start: number; end: number }
class ContentError extends Error {
  constructor(readonly source: ControlSource, message: string) { super(message); }
}

// Order and immediate-backslash escaping are upstream semantics, including the
// deliberately permissive handling of unfinished and crossing delimiters.
const features = /\[[?+]?|[?+]?\]|\{\!|\!\}|\*+|\/\/\n|^[ \t]*\n|^\s*---\s*\n|^\s*>>?|^\s*=|`|\[\[|\]\]|\[\[\+|\+\]\]/mg;

/** Extract compiler dependencies without rendering content or executing code. */
export function parseRichContent(source: ControlSource, mode: 'paragraphs' | 'inline'): RichContent {
  const dependencies: ContentDependency[] = [];
  try {
    const boundaries = findBoundaries(source, mode === 'paragraphs');
    // With no unescaped features upstream returns normalized plain text directly.
    if (boundaries.length === 2) return { dependencies, issues: [] };
    const ranges = tidy(buildRanges(source, boundaries));
    // Inline upstream content must retain its single paragraph wrapper.
    if (mode === 'inline' && (ranges.length !== 1 || ranges[0] instanceof ControlSource || ranges[0].type !== 'paragraph')) {
      throw new ContentError(source, 'Invalid inline content structure.');
    }
    extract(ranges, dependencies);
    return { dependencies, issues: [] };
  } catch (error) {
    if (!(error instanceof ContentError)) throw error;
    return { dependencies: [], issues: [{ source: error.source, message: error.message }] };
  }
}

function findBoundaries(source: ControlSource, paragraphs: boolean): Boundary[] {
  const result: Boundary[] = [];
  let paragraph = 'paragraph';
  const emphasis = [false, false, false];
  let conditional = 0, insert = false, magic = false, hidden = false;
  const add = (feature: string, type: Boundary['type'], start: number, end: number) => result.push({ feature, type, start, end });
  add(paragraph, 'start', 0, 0);
  for (const match of source.text.matchAll(features)) {
    const start = match.index!, end = start + match[0].length;
    if (start > 0 && source.text[start - 1] === '\\') continue;
    const feature = match[0].trim();
    const fail = (message: string): never => { throw new ContentError(source.slice(start, end), message); };
    if (magic) {
      if (feature === '!}') { add('magic', 'end', start, end); magic = false; }
      continue;
    }
    const finishHidden = (offset: number) => {
      if (!hidden) fail('Cannot end a hidden content block before it starts.');
      add('hidden', 'end', start + offset, end); hidden = false;
    };
    switch (feature) {
      case '*': case '**': case '`': {
        if (feature === '*' && conditional) break;
        const level = feature === '`' ? 2 : feature.length - 1;
        add(`emphasis-${level + 1}`, emphasis[level] ? 'end' : 'start', start, end);
        emphasis[level] = !emphasis[level];
        break;
      }
      case '//': add('line-break', 'single', start, end); break;
      case '[+':
        if (insert) fail('Cannot begin an insert inside another insert.');
        add('insert', 'start', start, end); insert = true; break;
      case '[':
        if (hidden) fail('Cannot begin a hidden content block inside another hidden block.');
        if (insert) fail('Cannot nest a hidden content block inside an insert.');
        add('hidden', 'start', start, end); hidden = true; break;
      case '+]':
        if (insert) { add('insert', 'end', start, end); insert = false; }
        else finishHidden(1);
        break;
      case ']': finishHidden(0); break;
      case '[?': add('conditional', 'start', start, end); conditional++; break;
      case '?]':
        if (conditional) { add('conditional', 'end', start, end); conditional--; }
        else finishHidden(1);
        break;
      case '{!': add('magic', 'start', start, end); magic = true; break;
      default: {
        if (!paragraphs || !['', '---', '>', '>>', '='].includes(feature)) break;
        const next = feature === '>' ? 'quotation' : feature === '>>' ? 'attribution' : feature === '=' ? 'heading' : 'paragraph';
        if (['>', '>>', '='].includes(feature) && paragraph === next) add('skip', 'single', start, end);
        else {
          add(paragraph, 'end', start, end);
          if (feature === '---') add('hrule', 'single', start, end);
          paragraph = next; add(paragraph, 'start', start, end);
        }
      }
    }
  }
  add(paragraph, 'end', source.text.length, source.text.length);
  return result;
}

// Transform text while retaining the original position of each retained or
// substituted character. Upstream folds whitespace even inside content magic.
function replace(source: ControlSource, pattern: RegExp, replacement: (match: RegExpMatchArray) => string): ControlSource {
  const pieces = [source.slice(0, 0)];
  let last = 0;
  for (const match of source.text.matchAll(pattern)) {
    const start = match.index!;
    pieces.push(source.slice(last, start));
    const value = replacement(match);
    for (let i = 0; i < value.length; i++) {
      const position = source.position(start + Math.min(i, match[0].length - 1));
      pieces.push(ControlSource.literal(value[i], position.line, position.character));
    }
    last = start + match[0].length;
  }
  pieces.push(source.slice(last));
  return ControlSource.join(pieces);
}

function buildRanges(source: ControlSource, boundaries: Boundary[]): Element[] {
  const stack: ContentRange[] = [{ type: 'root', content: [], source }];
  let toAdd: ContentRange[] = [], lastPosition = 0;
  const add = (element: Element) => stack[stack.length - 1].content!.push(element);
  const reopen = () => { stack.push(...toAdd); toAdd = []; };
  for (const feature of boundaries) {
    if (lastPosition < feature.start) {
      reopen();
      let text = replace(source.slice(lastPosition, feature.start), /\s/g, () => ' ');
      text = replace(text, /^ ( +)| +/g, match => ' ' + (match[1] || ''));
      add(text);
    }
    if (feature.type === 'start') {
      stack.push({ type: feature.feature, content: [], source: source.slice(feature.start, feature.end) });
      reopen();
    } else if (feature.type === 'single') {
      if (feature.feature !== 'skip') add({ type: feature.feature, source: source.slice(feature.start, feature.end) });
    } else {
      while (stack.length > 1) {
        const last = stack.pop()!;
        add(last);
        if (last.type === feature.feature) break;
        toAdd.unshift({ type: last.type, content: [], source: last.source });
      }
    }
    lastPosition = feature.end;
  }
  if (stack.length !== 1) throw new ContentError(source, 'Invalid content nesting across block delimiters.');
  return stack[0].content!;
}

function trimElement(element: Element, leading: boolean): Element {
  if (element instanceof ControlSource) {
    return leading ? element.slice(element.text.length - element.text.trimStart().length)
      : element.slice(0, element.text.trimEnd().length);
  }
  if (!element.content?.length) throw new ContentError(element.source, 'Invalid content whitespace structure.');
  const index = leading ? 0 : element.content.length - 1;
  element.content[index] = trimElement(element.content[index], leading);
  return element;
}

function tidy(elements: Element[]): Element[] {
  const result: Element[] = [];
  for (const element of elements) {
    if (!(element instanceof ControlSource) && element.content !== undefined) {
      element.content = tidy(element.content);
      if (!element.content.length) continue;
      if (['paragraph', 'quotation', 'attribution', 'heading'].includes(element.type)) {
        trimElement(element, false); trimElement(element, true);
      }
    } else {
      const previous = result[result.length - 1];
      if (previous instanceof ControlSource) {
        if (element instanceof ControlSource) {
          const position = previous.position(previous.text.length);
          result[result.length - 1] = replace(previous.concat(ControlSource.literal(' ', position.line, position.character)).concat(element), /\s+/g, () => ' ');
          continue;
        }
        if (element.type === 'line-break') result[result.length - 1] = previous.slice(0, previous.text.trimEnd().length);
      }
    }
    result.push(element);
  }
  return result;
}

function magicSource(range: ContentRange): ControlSource {
  let result = range.source.slice(0, 0);
  for (const [index, element] of (range.content || []).entries()) {
    if (!(element instanceof ControlSource)) throw new ContentError(range.source, 'Invalid magic content structure.');
    if (index) {
      const position = element.position(0);
      result = result.concat(ControlSource.literal('; ', position.line, position.character));
    }
    result = result.concat(element);
  }
  return result;
}

function extract(elements: Element[], output: ContentDependency[]): void {
  for (const range of elements) {
    if (range instanceof ControlSource || !range.content) continue;
    const fail = (message: string): never => { throw new ContentError(range.source, message); };
    if (range.type === 'conditional') {
      const first = range.content[0];
      if (!(first instanceof ControlSource)) fail('Inline conditional requires if condition : text.');
      const text = first as ControlSource;
      const match = /^\s*if\s*([^:]+)\s*:\s*(.*)$/.exec(text.text);
      if (match) {
        const start = text.text.match(/^\s*if\s*/)![0].length;
        output.push({ kind: 'predicate', language: 'logic', source: text.slice(start, text.text.indexOf(':')) });
        range.content[0] = text.slice(text.text.length - match[2].length);
      } else {
        const magic = range.content[1], after = range.content[2];
        if (!magic || magic instanceof ControlSource || magic.type !== 'magic' || !(after instanceof ControlSource) || !after.text.trim().startsWith(':')) {
          fail('Inline conditional requires if condition : text, or if {! JavaScript !} : text.');
        }
        output.push({ kind: 'predicate', language: 'magic', source: magicSource(magic as ContentRange) });
        // Upstream checks the trimmed text for ':' but slices the untrimmed text.
        range.content.splice(0, 3, (after as ControlSource).slice(1).trim());
      }
    } else if (range.type === 'insert') {
      const content = range.content.map(element => element instanceof ControlSource ? element.trim() : element)
        .filter(element => !(element instanceof ControlSource) || element.text.length > 0);
      let dependency: ContentDependency;
      const first = content[0];
      if (content.length === 1 && first instanceof ControlSource) {
        const colon = first.text.indexOf(':');
        // Upstream requires at least one character before a formatter colon.
        if (colon > 0) dependency = { kind: 'expression', language: 'logic', source: first.slice(0, colon), qdisplay: first.slice(colon + 1).trim() };
        else dependency = { kind: 'expression', language: 'logic', source: first };
      } else if ((content.length === 1 || content.length === 2) && first && !(first instanceof ControlSource) && first.type === 'magic') {
        const after = content[1];
        if (after && (!(after instanceof ControlSource) || !after.text.startsWith(':'))) fail('Insert content must be an expression or one JavaScript block, followed by an optional : formatter.');
        dependency = { kind: 'expression', language: 'magic', source: magicSource(first), qdisplay: after ? (after as ControlSource).slice(1).trim() : undefined };
      } else {
        fail('Insert content must be an expression or one JavaScript block, followed by an optional : formatter.');
      }
      output.push(dependency!);
      continue; // Insert children are consumed, never traversed a second time.
    }
    extract(range.content, output);
  }
}
