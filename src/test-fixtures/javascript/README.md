# Pinned JavaScript grammar

`JavaScript.tmLanguage.json` is the full, unmodified JavaScript TextMate grammar
shipped with VS Code (build `69047191fc`). Its `version` field pins
[microsoft/TypeScript-TmLanguage at 48f608692aa6d6ad7bd65b478187906c798234a8](https://github.com/microsoft/TypeScript-TmLanguage/commit/48f608692aa6d6ad7bd65b478187906c798234a8).
The Microsoft MIT license is retained in `syntaxes/LICENSE.javascript.txt`,
which also ships with the derived runtime grammar.

The full grammar reproduces nested guest rules that a keyword-only fixture misses.
It is also the source for `syntaxes/dendry-javascript.tmLanguage.json`. Regenerate
that artifact with `node scripts/generate-embedded-javascript.cjs`; highlighting
tests verify that the checked-in artifact matches the generator.

The generator makes every JavaScript rule respect Dendry's closing delimiter.
Zero-width end guards unwind nested states; Oniguruma's
[absent stopper](https://github.com/kkos/oniguruma/blob/master/doc/RE) prevents a
single guest match from consuming the delimiter. Two repositories preserve the
different escape rules for executable properties and rich content. Ordinary
JavaScript files keep using VS Code's own grammar.

A capture-free lookahead locates candidate matches before the absent stopper so
Oniguruma can still optimize searches on long content lines. The consuming regex
retains the original captures and the boundary restriction. Highlighting tests
use the editor's 500 ms per-line budget and exercise the reported nested subtitle
in `../highlighting/nested-subtitle.scene.dry` across all text-field contexts.
