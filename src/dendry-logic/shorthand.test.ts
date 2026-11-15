import { describe, expect, it } from 'vitest';
import { checkShorthand, LogicKind } from './shorthand';

describe('grammar-aware shorthand', () => {
  it.each([
    ['actions', 'player-health += 1'], ['actions', 'foo=1; bar=2;;;'],
    ['actions', 'if score > 0 then coins += 1 else coins = 0'],
    ['actions', 'coins += 1 if score = 0 else coins = 2'],
    ['actions', 'label = "if and or not; Q.foo = 1"'],
    ['actions', 'label = \'a = b; not Q.foo\''], ['actions', 'flag = TRUE'],
    ['predicate', 'count = 3'], ['predicate', 'ready AND NOT asleep'],
    ['predicate', 'foo-bar >= 3 OR other = "or and"'],
    ['predicate', '@chapter.room > 0'], ['predicate', 'TRUE'],
    ['expression', '(score + .5) * -2'], ['expression', 'customFunction(score, @root)'],
  ])('accepts %s: %s', (kind, source) => {
    expect(checkShorthand(source, kind as LogicKind).errors).toEqual([]);
  });
  it.each([
    ['actions', 'var score = 1'], ['actions', '_score = 1'], ['actions', 'foo++'],
    ['actions', '; foo = 1'], ['actions', 'foo = 1;; bar = 2'],
    ['actions', 'if score > 0 coins = 1'], ['actions', 'foo = [1, 2]'],
    ['predicate', 'score === 1'], ['predicate', 'a && b'], ['predicate', 'a > 0; b > 0'],
    ['predicate', 'Q.score > 0'], ['predicate', 'score !== 1'],
    ['expression', 'score > 3'], ['expression', 'TRUE'], ['expression', '1e3'],
    ['expression', '3-1'], ['expression', '@.root'],
  ])('rejects %s: %s', (kind, source) => {
    expect(checkShorthand(source, kind as LogicKind).errors).toHaveLength(1);
  });
  it('reports original spans without scanning quoted text for prefixes or visits', () => {
    const source = 'label="Q.foo; @missing"; count = @root';
    const checked = checkShorthand(source, 'actions');
    expect(checked.errors).toEqual([]);
    expect(checked.visits).toEqual([{ token: 'scene', text: '@root', offset: source.indexOf('@root'), length: 5 }]);
  });
  it('locates a bad prefix on its actual occurrence after an identical string', () => {
    const source = 'label = "Q.foo"; Q.foo = 1';
    expect(checkShorthand(source, 'actions').errors).toEqual([
      { offset: source.lastIndexOf('Q.foo'), length: 5, message: 'Use "foo" without the "Q." prefix in Dendry logic.' },
    ]);
  });
  it('accepts the compiler token-limit boundary and rejects overflow without crashing', () => {
    expect(checkShorthand('x=1;'.repeat(125), 'actions').errors).toEqual([]);
    expect(checkShorthand('x=1;'.repeat(126), 'actions').errors[0].message).toContain('token limit');
  });
});
