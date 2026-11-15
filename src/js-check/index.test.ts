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

  it.each([
    ['function f(x) {} x;', 'x'],
    ['function f(){ let secret = 1; } secret;', 'secret'],
    ['{ let hidden = 1; } hidden;', 'hidden'],
    ['try {} catch (err) {} err;', 'err'],
    ['for (let item of []) {} item;', 'item'],
    ['for (target of []) {}', 'target'],
    ['const f = function inside() { return inside; }; inside;', 'inside'],
    ['const C = class Inside {}; Inside;', 'Inside'],
    ['function f(value = hidden) { var hidden = 1; }', 'hidden'],
    ['class C { static { var hidden = 1; } } hidden;', 'hidden'],
  ])('does not leak bindings across scopes: %s', (source, name) => {
    const findings = checkScript(source, { functionBody: true });
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('undefined-identifier');
    expect(findings[0].message).toContain(`"${name}"`);
    const expectedColumn = source.startsWith('function f(value =') ? source.indexOf(name) : source.lastIndexOf(name);
    expect(findings[0].startColumn).toBe(expectedColumn);
  });

  it.each([
    'function f(x) { return x; } f(1);',
    'if (true) { var x = 1; } x;',
    'const f = () => later; let later = 1; f();',
    'const {a: renamed = Q.foo, ...rest} = Q; const [first, ...tail] = []; renamed; rest; first; tail;',
    'const { [Q.key]: value } = Q; value;',
    'class Foo { method(x) { return x; } static field = 1; } new Foo();',
    'class Foo { static { var hidden = 1; hidden; } }',
    'const f = function inside() { return inside; }; f();',
    'const C = class Inside { method() { return Inside; } }; new C();',
    'function f() { return arguments; } const g = () => arguments;',
    'const classes = new Map(); Promise.resolve(new Set());',
    'if (true) { function helper() {} } helper();',
  ])('accepts real JavaScript bindings and built-ins: %s', source => {
    expect(checkScript(source, { functionBody: true })).toEqual([]);
  });

  it('checks computed keys and shorthand object values', () => {
    const findings = checkScript('const o = { [missingKey]: Q.foo, missingValue };');
    expect(findings.map(f => f.message)).toEqual([
      expect.stringContaining('"missingKey"'), expect.stringContaining('"missingValue"'),
    ]);
  });

  it('does not confuse contextual keywords with globals', () => {
    expect(checkScript('of; async; await; private;', { functionBody: true })).toHaveLength(4);
    expect(checkScript('const async = 1; async;', { functionBody: true })).toEqual([]);
  });

  it('maps a shorthand object reference only once in a function body', () => {
    const findings = checkScript('const o = { missing };', { functionBody: true });
    expect(findings).toHaveLength(1);
    expect(findings[0].startLine).toBe(0);
    expect(findings[0].startColumn).toBe(12);
    expect(findings[0].endColumn).toBe(19);
  });

  it.each([
    '"use strict"; { function hidden() {} } hidden;',
    'function f() { "use strict"; { function hidden() {} } hidden; }',
    '{ let hidden; { function hidden() {} } } hidden;',
  ])('keeps strict or lexically shadowed block functions local: %s', source => {
    const findings = checkScript(source, { functionBody: true });
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('undefined-identifier');
    expect(findings[0].startColumn).toBe(source.lastIndexOf('hidden'));
  });

  it('accepts new.target in a function body and rejects it in a script', () => {
    expect(checkScript('return new.target;', { functionBody: true })).toEqual([]);
    expect(checkScript('new.target;')[0].kind).toBe('parse-error');
  });

  it.each(['let Q;', 'const state = 1;', '"use strict"; with (Q) {}'])('enforces function-body syntax: %s', source => {
    expect(checkScript(source, { functionBody: true })[0].kind).toBe('parse-error');
  });

  it('reports only the syntax error rather than guessing from strings or property names', () => {
    const findings = checkScript('Q.bar = "and or not" + ;', { functionBody: true });
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('parse-error');
  });
});
