"use strict";
// Levenshtein-based "did you mean?" suggestions for typo detection.
Object.defineProperty(exports, "__esModule", { value: true });
exports.levenshteinDistance = levenshteinDistance;
exports.findClosestMatch = findClosestMatch;
function levenshteinDistance(a, b) {
    const an = a.length;
    const bn = b.length;
    if (an === 0)
        return bn;
    if (bn === 0)
        return an;
    const matrix = Array(bn + 1);
    for (let i = 0; i <= bn; i++) {
        matrix[i] = Array(an + 1);
        matrix[i][0] = i;
    }
    for (let j = 0; j <= an; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= bn; i++) {
        for (let j = 1; j <= an; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            }
            else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j]) + 1;
            }
        }
    }
    return matrix[bn][an];
}
// Returns the closest candidate within an edit-distance threshold scaled to word length.
function findClosestMatch(word, candidates) {
    let best = null;
    for (const candidate of candidates) {
        const distance = levenshteinDistance(word.toLowerCase(), candidate.toLowerCase());
        if (best === null || distance < best.distance) {
            best = { candidate, distance };
        }
    }
    if (!best)
        return null;
    const threshold = Math.max(2, Math.floor(word.length / 3));
    return best.distance > 0 && best.distance <= threshold ? best : null;
}
//# sourceMappingURL=suggest.js.map