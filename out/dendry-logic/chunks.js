"use strict";
// Splits an action-property value into alternating logic and magic
// chunks, mirroring upstream `validators.js:324 validateActions`. A
// chunk's `offset` is its position within the original source, useful
// for translating downstream findings back into document ranges.
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitActionChunks = splitActionChunks;
const MAGIC_RE = /\{\!([\s\S]*?)\!\}/g;
function splitActionChunks(source) {
    const chunks = [];
    let lastEnd = 0;
    let match;
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
function pushIfNonEmpty(chunks, kind, raw, offset) {
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed.length === 0)
        return;
    chunks.push({ kind, source: trimmed, offset: offset + leading });
}
//# sourceMappingURL=chunks.js.map