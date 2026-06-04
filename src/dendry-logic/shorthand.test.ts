import { describe, it, expect } from 'vitest';
import { convertCondition, convertAction } from './shorthand';

describe('convertCondition (predicate context)', () => {
  it('rewrites a single `=` as `==`', () => {
    expect(convertCondition('count = 3').jsSource).toBe('count == 3');
  });

  it('leaves multi-char comparators untouched', () => {
    expect(convertCondition('a == b').jsSource).toBe('a == b');
    expect(convertCondition('a != b').jsSource).toBe('a != b');
    expect(convertCondition('a >= b').jsSource).toBe('a >= b');
  });

  it('converts and/or/not to JS logical operators', () => {
    expect(convertCondition('a and b or not c').jsSource).toBe('a && b || ! c');
  });

  it('reports a Q./S./V./P. prefix as a warning', () => {
    const result = convertCondition('Q.gold = 5');
    expect(result.prefixWarnings).toHaveLength(1);
    expect(result.prefixWarnings[0].prefix).toBe('Q');
    expect(result.prefixWarnings[0].identifier).toBe('gold');
  });
});

describe('convertAction (statement context)', () => {
  it('preserves a bare `=` as assignment (no comparator rewrite)', () => {
    expect(convertAction('gold = 5').jsSource).toBe('gold = 5');
  });

  it('keeps compound assignment operators', () => {
    expect(convertAction('gold += 5').jsSource).toBe('gold += 5');
  });

  it('expands postfix-if into an if statement, converting the condition', () => {
    expect(convertAction('gold += 1 if gold = 0').jsSource).toBe('if (gold == 0) { gold += 1 }');
  });

  it('flags an empty `if` block as an error', () => {
    const result = convertAction('foo if');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/cannot be empty/);
  });
});
