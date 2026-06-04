import { describe, it, expect } from 'vitest';
import { checkScript } from './index';

describe('checkScript', () => {
  it('returns no findings for valid, fully-declared code', () => {
    const findings = checkScript('var x = 1; x + 1;', { checkUndefined: true });
    expect(findings).toEqual([]);
  });

  it('reports a parse error for invalid syntax', () => {
    const findings = checkScript('foo(');
    expect(findings.some(f => f.kind === 'parse-error')).toBe(true);
  });

  it('flags an undefined identifier', () => {
    const findings = checkScript('zzzUndefinedThing + 1', { checkUndefined: true });
    const undef = findings.find(f => f.kind === 'undefined-identifier');
    expect(undef).toBeDefined();
    expect(undef!.message).toMatch(/zzzUndefinedThing/);
    expect(undef!.severity).toBe('hint');
  });

  it('does not flag identifiers passed via extraGlobals', () => {
    const findings = checkScript('Q + myLib', { checkUndefined: true, extraGlobals: ['myLib'] });
    expect(findings.filter(f => f.kind === 'undefined-identifier')).toEqual([]);
  });

  it('warns about assignment used in a condition', () => {
    const findings = checkScript('if (x = 1) {}', { checkUndefined: false });
    expect(findings.some(f => f.kind === 'assignment-in-condition')).toBe(true);
  });

  it('skips undefined checks when checkUndefined is false', () => {
    const findings = checkScript('zzzUndefinedThing + 1', { checkUndefined: false });
    expect(findings.filter(f => f.kind === 'undefined-identifier')).toEqual([]);
  });
});
