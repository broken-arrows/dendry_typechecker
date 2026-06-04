import { describe, it, expect } from 'vitest';
import { splitActionChunks } from './chunks';

describe('splitActionChunks', () => {
  it('splits a value into alternating logic and magic chunks', () => {
    const chunks = splitActionChunks('foo += 1; {! js !}; bar -= 2');
    expect(chunks.map(c => c.kind)).toEqual(['logic', 'magic', 'logic']);
    expect(chunks.map(c => c.source)).toEqual(['foo += 1;', 'js', '; bar -= 2']);
  });

  it('handles multiple independent magic blocks', () => {
    const chunks = splitActionChunks('a {! x !} b {! y !} c');
    expect(chunks.map(c => c.kind)).toEqual(['logic', 'magic', 'logic', 'magic', 'logic']);
    expect(chunks.map(c => c.source)).toEqual(['a', 'x', 'b', 'y', 'c']);
  });

  it('drops empty/whitespace-only chunks (incl. between adjacent blocks)', () => {
    const chunks = splitActionChunks('{! x !}{! y !}');
    expect(chunks.map(c => c.kind)).toEqual(['magic', 'magic']);
    expect(chunks.map(c => c.source)).toEqual(['x', 'y']);
  });

  it('treats a value with no magic as a single logic chunk', () => {
    const chunks = splitActionChunks('foo += 1; bar -= 2');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ kind: 'logic', source: 'foo += 1; bar -= 2', offset: 0 });
  });

  it('reports an offset that points at the trimmed magic body', () => {
    const chunks = splitActionChunks('foo += 1; {! js !}');
    const magic = chunks.find(c => c.kind === 'magic')!;
    expect('foo += 1; {! js !}'.slice(magic.offset, magic.offset + magic.source.length)).toBe('js');
  });
});
