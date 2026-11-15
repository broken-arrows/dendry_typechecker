/*!
 * Grammar/emission adapted from aucchen/dendrynexus lib/parsers/logic.js at
 * 2df80695cbe29743b4d9a1a43f5d9b36eaaac0b7.
 * The MIT License (MIT)
 * Copyright (c) 2014-2015 Ian Millington
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
export interface Rule { name: string; symbols: string[]; build: (items: any[]) => any }
const rule = (text: string, build: Rule['build']): Rule => {
  const [name, body] = text.split(' ::= ');
  return { name, symbols: body.split(' '), build };
};
const select = (index: number) => (items: any[]) => items[index];
// Preserve upstream's array concatenation, including token objects selected by
// boolean rules. Recognized grammar may still emit invalid JS and fail compile.
const sequence = (...parts: any[]) => parts.flatMap(part => Array.isArray(part) ? part : []);
const infix = (s: any[]) => sequence(['('], s[0], [' ', s[1].text, ' '], s[2], [')']);
const returned = (s: any[]) => sequence(['return '], s[0].token ? [s[0].text] : s[0], [';']);
const safe = (s: any[]) => sequence(['('], s[0], [' || 0)']);
const call = (s: any[]) => s.length === 4
  ? sequence(['this.', s[0].text, '('], s[2], [')']) : ['this.', s[0].text, '()'];
// Dot-prefixed symbols are nonterminals. Order matches upstream's first-tree
// state deduplication; changing production order can change emitted syntax.
export const GRAMMAR: readonly Rule[] = [
  rule('actions ::= .actions semi-colon .command', s => sequence(s[0], ['\n'], s[2])),
  rule('actions ::= .command', select(0)),
  rule('command ::= .assignment', select(0)),
  rule('assignment ::= .quality modification-operator .arithmetic', s => sequence(s[0], [' = ('], s[0], [' || 0) ', s[1].text[0], ' '], s[2], [';'])),
  rule('assignment ::= .quality equals .arithmetic', s => sequence(s[0], [' = '], s[2], [';'])),
  rule('assignment ::= .quality equals quoted-string', s => sequence(s[0], [' = ', s[2].text, ';'])),
  rule('assignment ::= .quality equals boolean', s => sequence(s[0], [' = ', s[2].text.toLowerCase(), ';'])),
  rule('assignment ::= .quality equals .bool-exp', s => sequence(s[0], [' = '], s[2], [';'])),
  rule('command ::= .command if .bool-exp', s => sequence([' if ('], s[2], [' ) { '], s[0], [' } '])),
  rule('command ::= .command if .bool-exp else .command', s => sequence([' if ('], s[2], [' ) { \n'], s[0], [';\n } else { '], s[4], [' } '])),
  rule('command ::= if .bool-exp then .command', s => sequence([' if ('], s[1], [' ) { '], s[3], [' } '])),
  rule('command ::= if .bool-exp then .command else .command', s => sequence([' if ('], s[1], [' ) { '], s[3], [';\n } else { '], s[5], [' } '])),
  rule('predicate ::= .bool-exp', returned),
  rule('expression ::= .arithmetic', returned),
  rule('bool-exp ::= .bool-exp conjunction .bool-exp-2', s => sequence(['('], s[0], [' && '], s[2], [')'])),
  rule('bool-exp ::= .bool-exp-2', select(0)),
  rule('bool-exp ::= boolean', select(0)),
  rule('bool-exp ::= quality', select(0)),
  rule('bool-exp-2 ::= .bool-exp-2 disjunction .bool-exp-3', s => sequence(['('], s[0], [' || '], s[2], [')'])),
  rule('bool-exp-2 ::= boolean', select(0)),
  rule('bool-exp-2 ::= .bool-exp-3', select(0)),
  rule('bool-exp-3 ::= negation .bool-exp-4', s => sequence(['(!'], s[1], [')'])),
  rule('bool-exp-3 ::= .bool-exp-4', select(0)),
  rule('bool-exp-4 ::= open-paren .bool-exp close-paren', s => sequence(['('], s[1], [')'])),
  rule('bool-exp-4 ::= .comparison', select(0)),
  rule('bool-exp-4 ::= boolean', select(0)),
  rule('comparison ::= .arithmetic comparator .arithmetic', infix),
  rule('comparison ::= .arithmetic equals .arithmetic', s => sequence(['('], s[0], ['==='], s[2], [')'])),
  rule('comparison ::= .quality comparator quoted-string', s => sequence(['('], s[0], [' ', s[1].text, ' ', s[2].text, ')'])),
  rule('comparison ::= .quality equals quoted-string', s => sequence(['('], s[0], [' == ', s[2].text, ')'])),
  rule('comparison ::= .quality equals boolean', s => sequence(['('], s[0], [' == ', s[2].text.toLowerCase(), ')'])),
  rule('comparison ::= boolean', s => [s[0].text.toLowerCase()]),
  rule('comparison ::= .arithmetic', s => sequence(['(('], s[0], [') !== 0)'])),
  rule('arithmetic ::= .arithmetic additive-operator .arith-term', infix),
  rule('arithmetic ::= .arith-term', select(0)),
  rule('arith-term ::= .arith-term mult-operator .arith-factor', infix),
  rule('arith-term ::= .arith-factor', select(0)),
  rule('arith-factor ::= .value-safe', select(0)),
  rule('arith-factor ::= number', s => [parseFloat(s[0].text)]),
  rule('arith-factor ::= open-paren .arithmetic close-paren', select(1)),
  rule('arith-factor ::= .function-call', select(0)),
  rule('value-safe ::= .quality', safe),
  rule('value-safe ::= .visits', safe),
  rule('quality ::= name', s => ["Q['", s[0].text, "']"]),
  rule('visits ::= scene', s => ["state.visits['", s[0].text.slice(1), "']"]),
  rule('function-call ::= name open-paren close-paren', call),
  rule('function-call ::= name open-paren .arguments close-paren', call),
  rule('arguments ::= .argument comma .arguments', s => sequence(s[0], [', '], s[2])),
  rule('arguments ::= .argument', select(0)),
  rule('argument ::= .arithmetic', select(0)),
  rule('argument ::= .bool-exp', select(0)),
];
