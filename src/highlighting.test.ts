import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { INITIAL, IGrammar, IRawGrammar, Registry } from 'vscode-textmate';
import { createOnigScanner, createOnigString, loadWASM } from 'vscode-oniguruma';
import { SCENE_SCHEMA } from './scene-schema';

let grammar: IGrammar;
const root = resolve(__dirname, '..');
const raw = JSON.parse(readFileSync(resolve(root, 'syntaxes/dendry.tmLanguage.json'), 'utf8')) as IRawGrammar;

beforeAll(async () => {
  const wasm = readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await loadWASM(new Uint8Array(wasm).buffer);
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async scope => {
      if (scope === 'source.dendry') return raw;
      // Small guest grammars test language dispatch and delimiter ownership.
      // VS Code supplies its own complete JavaScript/HTML grammars at runtime.
      if (scope === 'source.js') return {
        scopeName: scope, patterns: [{ name: 'storage.type.js', match: '\\b(?:const|let|return)\\b' }],
      } as IRawGrammar;
      if (scope === 'text.html.basic') return {
        scopeName: scope, patterns: [{ name: 'entity.name.tag.html', match: '</?[a-z]+' }],
      } as IRawGrammar;
      return null;
    },
  });
  grammar = (await registry.loadGrammar('source.dendry'))!;
});

function tokenize(source: string) {
  let stack = INITIAL;
  return source.split('\n').map(line => {
    const result = grammar.tokenizeLine(line, stack);
    stack = result.ruleStack;
    expect(result.stoppedEarly).toBe(false);
    return { line, tokens: result.tokens };
  });
}

function scopes(source: string, line: number, text: string) {
  const row = tokenize(source)[line];
  const start = row.line.indexOf(text);
  expect(start, `Missing fixture text ${text}`).toBeGreaterThanOrEqual(0);
  return row.tokens.filter(token => token.startIndex < start + text.length && token.endIndex > start)
    .map(token => token.scopes);
}

function hasScope(source: string, line: number, text: string, scope: string) {
  for (const tokenScopes of scopes(source, line, text)) expect(tokenScopes).toContain(scope);
}

function lacksScope(source: string, line: number, text: string, scope: string) {
  for (const tokenScopes of scopes(source, line, text)) expect(tokenScopes).not.toContain(scope);
}

describe('TextMate highlighting', () => {
  it.each(Object.keys(SCENE_SCHEMA))('recognizes scene header %s', key => {
    hasScope(`${key}: value\n\nBody`, 0, key, 'variable.parameter.dendry');
    hasScope(`\n@section.deep-name\n${key}: value`, 2, key, 'variable.parameter.dendry');
    const kind = SCENE_SCHEMA[key];
    const category = ['predicate', 'expression', 'action'].includes(kind) ? 'logic'
      : kind === 'text' || kind === 'destination' || kind === 'quality-destination' || kind === 'quality-name' ? kind
      : ['call-reference', 'jump-reference', 'check-reference'].includes(kind) ? 'reference' : 'scalar';
    hasScope(`${key}: value`, 0, 'value', `meta.property.${category}.dendry`);
  });

  it.each(['author', 'ifid', 'type', 'first-scene', 'root-scene', 'animate', 'scene-signal',
    'quality-signal', 'display-sidebar', 'display-stats', 'display-options', 'sidebar-stats',
    'name', 'initial', 'min', 'max', 'is-valid', 'default-display'])('recognizes quality/info header %s', key => {
    hasScope(`${key}: value`, 0, key, 'variable.parameter.dendry');
  });

  it.each(['frequencyVar', 'FrequencyVar', 'FREQUENCY_VAR', 'Frequency Var', 'frequency__var', 'Frequency - VAR'])
    ('recognizes normalized header %s as an expression', key => {
      hasScope(`${key}: skill-name + 2`, 0, key, 'variable.parameter.dendry');
      hasScope(`${key}: skill-name + 2`, 0, 'skill-name', 'variable.other.dendry');
    });

  it('keeps properties out of body prose and indented continuation text', () => {
    const source = 'title: Opening\n  view-if: prose\n\ntitle: Body prose\nview-if: Still prose';
    lacksScope(source, 1, 'view-if', 'variable.parameter.dendry');
    lacksScope(source, 3, 'title', 'variable.parameter.dendry');
    lacksScope(source, 4, 'view-if', 'variable.parameter.dendry');
  });

  it('does not advertise unsupported declarations or fields', () => {
    for (const source of ['@scene name', '@quality name', '@root name']) {
      lacksScope(source, 0, 'name', 'entity.name.function.dendry');
      lacksScope(source, 0, source.slice(1).split(' ')[0], 'keyword.control.dendry');
    }
    lacksScope('on-choose: {! return true; !}', 0, 'on-choose', 'variable.parameter.dendry');
    lacksScope('id: example\ncontent: prose\nsections: none\noptions: none', 0, 'id', 'variable.parameter.dendry');
    for (const key of ['maxvisitsvar', 'freQUENCYVAR', 'Set-topLeftStyle']) {
      lacksScope(`${key}: 2`, 0, key, 'variable.parameter.dendry');
    }
  });

  it('recognizes complete dotted section IDs', () => {
    hasScope('\n@ chapter-one.deep._2\ntitle: Hi', 1, 'chapter-one.deep._2', 'entity.name.function.dendry');
  });

  it.each(['.', '..', '..target.deep-name', '.absolute.deep', 'normal.deep.name', '---'])
    ('recognizes choice reference %s', reference => {
      const source = `\n- @${reference}: Choose [+ skill-name +]`;
      hasScope(source, 1, reference, 'entity.name.function.dendry');
      hasScope(source, 1, 'skill-name', 'variable.other.dendry');
    });

  it('recognizes tagged choices with rich titles', () => {
    const source = '\n- #tag-name: [+ skill-name : rank-display +]';
    hasScope(source, 1, 'tag-name', 'entity.name.tag.dendry');
    hasScope(source, 1, 'rank-display', 'entity.name.type.qdisplay.dendry');
  });

  it('attaches option fields and continuations, without coloring unsupported option fields', () => {
    const source = '\n- @target\n- View If: skill-name > 1\n  AND TRUE\n- title: A [+ value +]\n- on-choose: nope\n- go-to: nope';
    hasScope(source, 2, 'View If', 'variable.parameter.dendry');
    hasScope(source, 3, 'AND', 'keyword.operator.logical.dendry');
    hasScope(source, 4, 'value', 'variable.other.dendry');
    lacksScope(source, 5, 'on-choose', 'variable.parameter.dendry');
    lacksScope(source, 6, 'go-to', 'variable.parameter.dendry');
  });

  it('keeps dash prose, star prose and horizontal rules out of choices', () => {
    for (const source of ['\nProse\n- @target', '\n* @target', '\n---']) {
      const lines = source.split('\n');
      lacksScope(source, lines.length - 1, lines[lines.length - 1], 'meta.choice.dendry');
    }
  });

  it.each(['title', 'subtitle', 'unavailable-subtitle', 'view-if', 'choose-if', 'order', 'priority', 'frequency', 'frequency-var'])
    ('recognizes option field %s', key => {
      hasScope(`\n- @target\n- ${key}: value`, 2, key, 'variable.parameter.dendry');
    });

  it('ends an options block at a blank line or a new section', () => {
    const source = '\n- @target\n- title: Caption\n\n- title: ordinary prose\n\n@next\nview-if: TRUE';
    lacksScope(source, 4, 'title', 'variable.parameter.dendry');
    hasScope(source, 6, 'next', 'entity.name.function.dendry');
    hasScope(source, 7, 'view-if', 'variable.parameter.dendry');
  });

  it.each(['and', 'AND', 'or', 'OR', 'not', 'NOT'])('recognizes logic operator %s', operator => {
    hasScope(`view-if: flag ${operator} other`, 0, operator, 'keyword.operator.logical.dendry');
  });

  it.each(['true', 'TRUE', 'false', 'FALSE'])('recognizes logic boolean %s', value => {
    hasScope(`view-if: ${value}`, 0, value, 'constant.language.dendry');
  });

  it('recognizes visit tokens, function calls, conditional actions and whole hyphenated names', () => {
    const source = 'on-arrival: if @chapter.deep-name >= 2 then score-name += roll-dice(2, -0.5); else score-name = 0';
    hasScope(source, 0, '@chapter.deep-name', 'variable.other.scene-visits.dendry');
    hasScope(source, 0, 'score-name', 'variable.other.dendry');
    hasScope(source, 0, 'roll-dice', 'entity.name.function.dendry');
    hasScope(source, 0, '+=', 'keyword.operator.assignment.dendry');
    hasScope(source, 0, 'then', 'keyword.control.dendry');
  });

  it('does not label JavaScript aliases or reserved-word prefixes as shorthand keywords', () => {
    const source = 'view-if: true-value AND android AND not-ready AND Q.foo';
    for (const text of ['true-value', 'android', 'not-ready']) hasScope(source, 0, text, 'variable.other.dendry');
    lacksScope(source, 0, 'Q.', 'variable.language.dendry');
  });

  it('keeps quoted shorthand text opaque, without inventing JavaScript backslash escaping', () => {
    const source = 'on-arrival: message = "TRUE; @fake-name: {!"; other = \'text\\\'; score-name = 1';
    hasScope(source, 0, 'TRUE; @fake-name: {!', 'string.quoted.double.dendry');
    lacksScope(source, 0, '@fake-name', 'variable.other.scene-visits.dendry');
    hasScope(source, 0, 'score-name', 'variable.other.dendry');
  });

  it.each(['go-to', 'go-sub', 'go-sub-start', 'go-sub-end'])('recognizes %s destinations and predicates', key => {
    const source = `${key}: @..target.deep if skill-name > 1; .absolute if {! return Q.ok; !}; .`;
    hasScope(source, 0, '..target.deep', 'entity.name.function.dendry');
    hasScope(source, 0, 'skill-name', 'variable.other.dendry');
    hasScope(source, 0, 'return', 'meta.embedded.block.javascript.dendry');
    hasScope(source, 0, '.absolute', 'entity.name.function.dendry');
  });

  it('distinguishes quality destinations, singleton references and scalar names from logic', () => {
    hasScope('go-to-ref: route-name if TRUE', 0, 'route-name', 'variable.other.dendry');
    hasScope('go-to-ref: route-name if TRUE', 0, 'TRUE', 'constant.language.dendry');
    hasScope('call: chapter.deep', 0, 'chapter.deep', 'entity.name.function.dendry');
    hasScope('check-quality: skill-name', 0, 'skill-name', 'variable.other.dendry');
    lacksScope('game-over: {! return true; !}', 0, 'return', 'meta.embedded.block.javascript.dendry');
    lacksScope('broad-difficulty: {! return 2; !}', 0, 'return', 'meta.embedded.block.javascript.dendry');
  });

  it('tracks destination predicates through continuation lines, including an if at end of line', () => {
    const source = 'go-to: if if\n  flag-name AND TRUE;\n  ..next if {!\nreturn Q.ready;\n!}; .last\nview-if: TRUE';
    hasScope(source, 0, 'if', 'entity.name.function.dendry');
    hasScope(source, 1, 'flag-name', 'variable.other.dendry');
    hasScope(source, 2, '..next', 'entity.name.function.dendry');
    hasScope(source, 3, 'return', 'storage.type.js');
    hasScope(source, 4, '.last', 'entity.name.function.dendry');
    hasScope(source, 5, 'view-if', 'variable.parameter.dendry');
  });

  it('tracks multiple multiline JS chunks through blank lines, fake declarations and delimiters', () => {
    const source = 'on-arrival: {! const a = 1;\n\n@fake\n!} score-name += 1 {!\nreturn Q.value;\n!}\nview-if: TRUE\n\nAfter';
    hasScope(source, 0, 'const', 'storage.type.js');
    hasScope(source, 2, '@fake', 'meta.embedded.block.javascript.dendry');
    lacksScope(source, 2, 'fake', 'entity.name.function.dendry');
    hasScope(source, 3, 'score-name', 'variable.other.dendry');
    hasScope(source, 4, 'return', 'storage.type.js');
    hasScope(source, 6, 'view-if', 'variable.parameter.dendry');
    lacksScope(source, 8, 'After', 'meta.embedded.block.javascript.dendry');
  });

  it('treats body and title magic as HTML and predicate/insert magic as JavaScript', () => {
    const source = 'title: {! <b>Title</b> !}\n\n{! <div>\n[+ ignored +] [? if ignored: text ?]\n</div> !}\n[+ {! return Q.score; !} : rank-display +]\n[? if {! return Q.ready; !}: {! <em>Ready</em> !} ?]';
    hasScope(source, 0, '<b', 'meta.embedded.block.html.dendry');
    hasScope(source, 2, '<div', 'entity.name.tag.html');
    lacksScope(source, 3, 'ignored', 'variable.other.dendry');
    hasScope(source, 5, 'return', 'storage.type.js');
    hasScope(source, 5, 'rank-display', 'entity.name.type.qdisplay.dendry');
    hasScope(source, 6, 'return', 'storage.type.js');
    hasScope(source, 6, '<em', 'meta.embedded.block.html.dendry');
  });

  it('handles nested/multiline rich content, formatter suffixes and escaping', () => {
    const source = '\n[? if TRUE: outer\n[? if @target > 0: [+ (score-name + 1) : rank-display +] ?]\n?]\n\\[+ ignored +] \\\\[+ also-ignored +]\n\\{! return nope; !}\n\\[? if nope: ignored ?]';
    hasScope(source, 1, 'TRUE', 'constant.language.dendry');
    hasScope(source, 2, '@target', 'variable.other.scene-visits.dendry');
    hasScope(source, 2, 'score-name', 'variable.other.dendry');
    hasScope(source, 2, 'rank-display', 'entity.name.type.qdisplay.dendry');
    lacksScope(source, 4, 'ignored', 'meta.variable-interpolation.dendry');
    lacksScope(source, 4, 'also-ignored', 'meta.variable-interpolation.dendry');
    lacksScope(source, 5, 'return', 'meta.embedded.block.html.dendry');
    lacksScope(source, 6, 'nope', 'meta.inline-conditional.dendry');
  });

  it('retains rich content inside emphasis and hidden text', () => {
    const source = '\n*Italic [+ score-name +]* and **[? if TRUE: bold ?]** [hidden [+ @target +]] `code`';
    hasScope(source, 1, 'score-name', 'markup.italic.dendry');
    hasScope(source, 1, 'score-name', 'variable.other.dendry');
    hasScope(source, 1, 'TRUE', 'markup.bold.dendry');
    hasScope(source, 1, '@target', 'meta.hidden.dendry');
    hasScope(source, 1, 'code', 'markup.raw.dendry');
  });

  it('recovers from an unfinished JS block as its closing delimiter is added', () => {
    const incomplete = 'on-display: {!\nreturn Q.value;\n@still-in-js';
    hasScope(incomplete, 2, '@still-in-js', 'meta.embedded.block.javascript.dendry');
    const complete = 'on-display: {!\nreturn Q.value;\n!}\n@new-scene\ntitle: Next';
    hasScope(complete, 3, 'new-scene', 'entity.name.function.dendry');
    hasScope(complete, 4, 'title', 'variable.parameter.dendry');
  });

  it('does not dispatch escaped content magic or ordinary HTML-looking text to an embedded language', () => {
    const source = '\n[+ \\{! return nope; !} +]\n[? if \\{! return nope; !}: text ?]\n<div>plain text</div>';
    lacksScope(source, 1, 'return', 'meta.embedded.block.javascript.dendry');
    lacksScope(source, 2, 'return', 'meta.embedded.block.javascript.dendry');
    lacksScope(source, 3, 'plain text', 'meta.embedded.block.html.dendry');
  });

  it.each(['-2.5 to -.5', '1-5', '1..5', '1+5', '1,5', '-5--1', '..5', '1..', ','])
    ('recognizes QDisplay range (%s) and rich output', range => {
      const source = `\n(${range}) [+ score-name : rank-display +]\n  continuation`;
      hasScope(source, 1, range, 'meta.qdisplay.range.dendry');
      hasScope(source, 1, 'score-name', 'variable.other.dendry');
      hasScope(source, 2, 'continuation', 'meta.qdisplay.output.dendry');
    });

  it('requires a valid decimal range instead of coloring arbitrary parenthesized prose', () => {
    for (const range of ['1.2.3..4', '1e2..3', 'just prose']) {
      lacksScope(`\n(${range}) text`, 1, range, 'meta.qdisplay.range.dendry');
    }
  });

  it.each(['-', 'to', '..', '+', ','])('distinguishes QDisplay separator %s from signed endpoints', separator => {
    const source = `\n(-2.5 ${separator} -0.5) Output`;
    hasScope(source, 1, '-2.5', 'constant.numeric.dendry');
    hasScope(source, 1, '-0.5', 'constant.numeric.dendry');
    const row = tokenize(source)[1];
    const offset = row.line.indexOf(` ${separator} `) + 1;
    expect(row.tokens.find(token => token.startIndex <= offset && token.endIndex > offset)?.scopes)
      .toContain('keyword.operator.range.dendry');
  });

  it('colors comments without requiring whitespace after the hash', () => {
    const source = '#comment before header\nview-if: TRUE\n\n#comment\n\n- #tag-name';
    hasScope(source, 0, '#comment', 'comment.line.number-sign.dendry');
    hasScope(source, 1, 'view-if', 'variable.parameter.dendry');
    hasScope(source, 3, '#comment', 'comment.line.number-sign.dendry');
    lacksScope(source, 5, '#tag-name', 'comment.line.number-sign.dendry');
  });

  it('maps the embedded language scopes in the extension manifest', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    expect(manifest.contributes.grammars[0].embeddedLanguages).toMatchObject({
      'meta.embedded.block.javascript.dendry': 'javascript',
      'meta.embedded.block.html.dendry': 'html',
    });
  });
});
