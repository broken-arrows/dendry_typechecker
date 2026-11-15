// Pinned logic.js/gp.js tokenization: longest match, then earliest rule wins.
export interface Token { token: string; text: string; offset: number; length: number }
export interface LogicError { offset: number; length: number; message: string }
const rules: [RegExp, string | undefined][] = [
  [/^(and|AND)/, 'conjunction'], [/^(or|OR)/, 'disjunction'], [/^(not|NOT)/, 'negation'],
  [/^(true|TRUE)/, 'boolean'], [/^(false|FALSE)/, 'boolean'],
  [/^if/, 'if'], [/^then/, 'then'], [/^else/, 'else'],
  [/^=/, 'equals'], [/^(<=|>=|<|>|!=|==)/, 'comparator'],
  [/^(\+=|-=|\*=|\/=)/, 'modification-operator'],
  [/^(\+|-)/, 'additive-operator'], [/^(\/|\*|%)/, 'mult-operator'],
  [/^(-)?([0-9]+(\.([0-9]+)?)?|\.[0-9]+)/, 'number'],
  [/^[a-zA-Z][\-a-zA-Z0-9_]*/, 'name'], [/^\@[\w-]+(?:\.[\w-]+)*/, 'scene'],
  [/^\(/, 'open-paren'], [/^\)/, 'close-paren'], [/^,/, 'comma'], [/^;/, 'semi-colon'], [/^\./, 'dot'],
  [/^"[^"]*"/, 'quoted-string'], [/^'[^']*'/, 'quoted-string'],
  [/^\[/, 'open-bracket'], [/^\]/, 'close-bracket'], [/^\s+/, undefined],
];
export function tokenize(source: string): { tokens: Token[]; error?: LogicError } {
  const tokens: Token[] = [];
  let offset = 0;
  let iterations = 0;
  while (offset < source.length) {
    const remaining = source.slice(offset);
    let text = '';
    let kind: string | undefined;
    for (const [regex, token] of rules) {
      const candidate = regex.exec(remaining)?.[0];
      if (candidate && candidate.length > text.length) { text = candidate; kind = token; }
    }
    if (!text) return { tokens, error: { offset, length: 1, message: `Unrecognized character '${source[offset]}' in Dendry logic.` } };
    if (++iterations >= 500) return { tokens, error: { offset, length: text.length, message: 'Dendry logic exceeds the compiler token limit.' } };
    if (kind) tokens.push({ token: kind, text, offset, length: text.length });
    offset += text.length;
  }
  return { tokens };
}
