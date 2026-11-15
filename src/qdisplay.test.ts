import { describe, expect, it } from 'vitest';
import { parseQDisplay } from './qdisplay';

describe('QDisplay normalized ranges and output spans', () => {
  it('swaps reversed bounds and retains source order for overlapping ranges', () => {
    const parsed = parseQDisplay('\n(5..1) First\n(..) Fallback\n(2..3) Later', 'rating.qdisplay.dry');
    expect(parsed.issues).toEqual([]);
    expect(parsed.ranges.map(range => [range.min, range.max])).toEqual([[1, 5], [undefined, undefined], [2, 3]]);
  });
  it('captures the actual first output line and consumes ignored continuations', () => {
    const parsed = parseQDisplay('\n(..) First\n   Ignored', 'rating.qdisplay.dry');
    expect(parsed.issues).toEqual([]);
    expect(parsed.ranges).toHaveLength(1);
    expect(parsed.ranges[0].output?.text).toBe('First');
    expect(parsed.ranges[0].output?.position(0)).toEqual({ line: 1, character: 5 });
  });
  it('captures the first continuation when the initial output line is empty', () => {
    const parsed = parseQDisplay('#comment\r\n\r\n(..)\r\n   Output\r\n   Ignored', 'rating.qdisplay.dry');
    expect(parsed.issues).toEqual([]);
    expect(parsed.ranges[0].output?.text).toBe('Output');
    expect(parsed.ranges[0].output?.position(0)).toEqual({ line: 3, character: 3 });
  });
  it('preserves physical row positions across comments', () => {
    const parsed = parseQDisplay('\n(0..1) First\n#comment\n(2..3) Second', 'rating.qdisplay.dry');
    expect(parsed.issues).toEqual([]);
    expect(parsed.ranges.map(range => range.source.position(0).line)).toEqual([1, 3]);
  });
});
