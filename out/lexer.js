"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.allTokens = exports.DendryLexer = exports.Comment = exports.FreeText = exports.TagMarker = exports.Identifier = exports.WhiteSpace = exports.NewLine = exports.Colon = exports.TripleDash = exports.DividerMarker = exports.ChoiceMarker = exports.SceneMarker = exports.JsCode = exports.JsBlockEnd = exports.JsBlockStart = void 0;
const chevrotain_1 = require("chevrotain");
// ----------------- T O K E N S -----------------
// 1) Define the tokens for the JS Block FIRST so they can be referenced in the mode switch
exports.JsBlockStart = (0, chevrotain_1.createToken)({
    name: 'JsBlockStart',
    pattern: /\{!/,
    push_mode: 'js_mode' // Enter code mode
});
exports.JsBlockEnd = (0, chevrotain_1.createToken)({
    name: 'JsBlockEnd',
    pattern: /!\}/,
    pop_mode: true // Exit code mode
});
// Match anything (including newlines) until we see !}
exports.JsCode = (0, chevrotain_1.createToken)({
    name: 'JsCode',
    pattern: /[\s\S]+?(?=!\})/,
    line_breaks: true
});
// --- Structural Tokens ---
exports.SceneMarker = (0, chevrotain_1.createToken)({ name: 'SceneMarker', pattern: /@/ });
exports.ChoiceMarker = (0, chevrotain_1.createToken)({ name: 'ChoiceMarker', pattern: /-/ });
exports.DividerMarker = (0, chevrotain_1.createToken)({ name: 'DividerMarker', pattern: /=/ });
exports.TripleDash = (0, chevrotain_1.createToken)({ name: 'TripleDash', pattern: /---/ });
exports.Colon = (0, chevrotain_1.createToken)({ name: 'Colon', pattern: /:/ });
exports.NewLine = (0, chevrotain_1.createToken)({ name: 'NewLine', pattern: /\r\n|\n/ });
exports.WhiteSpace = (0, chevrotain_1.createToken)({
    name: 'WhiteSpace',
    pattern: /[ \t]+/,
    group: chevrotain_1.Lexer.SKIPPED
});
// --- Content Tokens ---
exports.Identifier = (0, chevrotain_1.createToken)({
    name: 'Identifier',
    pattern: /[a-zA-Z0-9_][a-zA-Z0-9_-]*/
});
exports.TagMarker = (0, chevrotain_1.createToken)({
    name: 'TagMarker',
    pattern: /#[a-zA-Z_][a-zA-Z0-9_-]*/
});
// Keep excluding @, -, =, :, newline so those become structural tokens.
exports.FreeText = (0, chevrotain_1.createToken)({
    name: 'FreeText',
    pattern: /[^@\-=#\n\r:]+(?:[ \t]+[^@\-=#\n\r:]+)*/ // allow internal spaces, exclude # to avoid conflicting with tags/comments
});
// Comments start with '#'
exports.Comment = (0, chevrotain_1.createToken)({
    name: 'Comment',
    pattern: /#(?![a-zA-Z_]).*/, // Negative lookahead: don't match if followed by identifier start
    group: chevrotain_1.Lexer.SKIPPED
});
// ----------------- L E X E R   D E F I N I T I O N -----------------
const lexerDefinition = {
    modes: {
        structural_mode: [
            exports.WhiteSpace,
            exports.NewLine,
            exports.TripleDash,
            exports.SceneMarker,
            exports.ChoiceMarker,
            exports.DividerMarker,
            exports.Colon,
            exports.JsBlockStart,
            exports.TagMarker,
            exports.Comment,
            exports.Identifier,
            exports.FreeText
        ],
        js_mode: [
            exports.JsBlockEnd,
            exports.JsCode
        ]
    },
    defaultMode: 'structural_mode'
};
exports.DendryLexer = new chevrotain_1.Lexer(lexerDefinition, {
    positionTracking: 'full'
});
exports.allTokens = [
    exports.NewLine,
    exports.WhiteSpace,
    exports.TripleDash,
    exports.SceneMarker,
    exports.ChoiceMarker,
    exports.DividerMarker,
    exports.Colon,
    exports.JsBlockStart,
    exports.JsBlockEnd,
    exports.JsCode,
    exports.TagMarker,
    exports.Comment,
    exports.Identifier,
    exports.FreeText
];
//# sourceMappingURL=lexer.js.map