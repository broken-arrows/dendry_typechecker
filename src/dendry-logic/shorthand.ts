import { parseScript } from '../js-check/parse';
import { LogicKind, parseLogic } from './parse';
import { LogicError, Token, tokenize } from './tokens';
export type { LogicKind } from './parse';
export interface LogicResult { errors: LogicError[]; visits: Token[] }

// Separate grammar roots and original spans; dynamic qualities/functions are
// legal without declarations. Generated JS only reproduces compiler failures.
export function checkShorthand(source: string, kind: LogicKind): LogicResult {
  const input = kind === 'actions' ? source.replace(/;+\s*$/, '') : source;
  const lexed = tokenize(input);
  if (lexed.error) return { errors: [lexed.error], visits: [] };
  const parsed = parseLogic(lexed.tokens, kind, input.length);
  if (parsed.error) {
    const index = lexed.tokens.findIndex(token => token.offset === parsed.error!.offset);
    const prefix = lexed.tokens[index - 1];
    const name = lexed.tokens[index + 1];
    if (lexed.tokens[index]?.token === 'dot' && prefix && /^[QSPV]$/.test(prefix.text) && name?.token === 'name') {
      parsed.error.message = `Use "${name.text}" without the "${prefix.text}." prefix in Dendry logic.`;
      parsed.error.offset = prefix.offset;
      parsed.error.length = name.offset + name.length - prefix.offset;
    }
    return { errors: [parsed.error], visits: [] };
  }
  const js = parseScript(parsed.source!, true);
  if (js.error) {
    const string = lexed.tokens.find(token => token.token === 'quoted-string');
    return { errors: [{ offset: string?.offset ?? 0, length: string?.length ?? input.length,
      message: `Dendry logic Error: ${js.error.message}` }], visits: [] };
  }
  return { errors: [], visits: lexed.tokens.filter(token => token.token === 'scene') };
}
