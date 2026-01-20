"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DendryLexer = exports.allTokens = exports.Comment = exports.JsCode = exports.JsBlockEnd = exports.JsBlockStart = exports.FreeText = exports.Identifier = exports.WhiteSpace = exports.NewLine = exports.Colon = exports.TripleDash = exports.DividerMarker = exports.ChoiceMarker = exports.SceneMarker = void 0;
const chevrotain_1 = require("chevrotain");
// ----------------- T O K E N S -----------------
// --- Structural Tokens ---
exports.SceneMarker = (0, chevrotain_1.createToken)({ name: 'SceneMarker', pattern: /@/ });
exports.ChoiceMarker = (0, chevrotain_1.createToken)({ name: 'ChoiceMarker', pattern: /-/ });
exports.DividerMarker = (0, chevrotain_1.createToken)({ name: 'DividerMarker', pattern: /=/ });
exports.TripleDash = (0, chevrotain_1.createToken)({ name: 'TripleDash', pattern: /---/ });
exports.Colon = (0, chevrotain_1.createToken)({ name: 'Colon', pattern: /:/ });
exports.NewLine = (0, chevrotain_1.createToken)({ name: 'NewLine', pattern: /\n|\r\n/ });
exports.WhiteSpace = (0, chevrotain_1.createToken)({
    name: 'WhiteSpace',
    pattern: /[ \t]+/, // Corrected: escaped space and tab
    group: chevrotain_1.Lexer.SKIPPED
});
// --- Content Tokens ---
exports.Identifier = (0, chevrotain_1.createToken)({
    name: 'Identifier',
    pattern: /[a-zA-Z_][a-zA-Z0-9_-]*/
});
exports.FreeText = (0, chevrotain_1.createToken)({
    name: 'FreeText',
    pattern: /[^@\-=\n\r:]+/ // Corrected: escaped hyphen and other special characters
});
// --- Special Value Tokens ---
exports.JsBlockStart = (0, chevrotain_1.createToken)({ name: 'JsBlockStart', pattern: /\{!/ }); // Corrected: escaped curly brace
exports.JsBlockEnd = (0, chevrotain_1.createToken)({ name: 'JsBlockEnd', pattern: /!\}/ }); // Corrected: escaped curly brace
exports.JsCode = (0, chevrotain_1.createToken)({
    name: 'JsCode',
    pattern: /.+?(?=!\})/,
    line_breaks: true
});
// --- Comment Token ---
exports.Comment = (0, chevrotain_1.createToken)({
    name: 'Comment',
    pattern: /#.*/,
    group: chevrotain_1.Lexer.SKIPPED
});
// ----------------- L E X E R -----------------
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
    exports.Comment,
    exports.Identifier,
    exports.FreeText // Must be last as it's a catch-all for content
];
exports.DendryLexer = new chevrotain_1.Lexer(exports.allTokens, {
    // Full position tracking is needed for the CST Visitor to get complete
    // location information for each node.
    positionTracking: "full"
});
//# sourceMappingURL=lexer.js.map