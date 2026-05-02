// Splits an action-property value into alternating logic and magic
// chunks, mirroring upstream `validators.js:324 validateActions`. A
// chunk's `offset` is its position within the original source, useful
// for translating downstream findings back into document ranges.

export type ChunkKind = 'logic' | 'magic';

export interface Chunk {
  kind: ChunkKind;
  source: string;
  // 0-based character offset within the source string passed to splitActionChunks
  offset: number;
}

const MAGIC_RE = /\{\!([\s\S]*?)\!\}/g;

export function splitActionChunks(source: string): Chunk[] {
  const chunks: Chunk[] = [];
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  // reset the global regex's state
  MAGIC_RE.lastIndex = 0;

  while ((match = MAGIC_RE.exec(source)) !== null) {
    if (match.index > lastEnd) {
      pushIfNonEmpty(chunks, 'logic', source.substring(lastEnd, match.index), lastEnd);
    }
    pushIfNonEmpty(chunks, 'magic', match[1], match.index + 2);
    lastEnd = match.index + match[0].length;
  }

  if (lastEnd < source.length) {
    pushIfNonEmpty(chunks, 'logic', source.substring(lastEnd), lastEnd);
  }

  return chunks;
}

function pushIfNonEmpty(chunks: Chunk[], kind: ChunkKind, raw: string, offset: number): void {
  const leading = raw.length - raw.trimStart().length;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return;
  chunks.push({ kind, source: trimmed, offset: offset + leading });
}
