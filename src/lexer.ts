import { createToken, Lexer } from 'chevrotain';

// ----------------- T O K E N S -----------------

// --- Structural Tokens ---
export const SceneMarker = createToken({ name: 'SceneMarker', pattern: /@/ });
export const ChoiceMarker = createToken({ name: 'ChoiceMarker', pattern: /-/ });
export const DividerMarker = createToken({ name: 'DividerMarker', pattern: /=/ });
export const TripleDash = createToken({ name: 'TripleDash', pattern: /---/ });
export const Colon = createToken({ name: 'Colon', pattern: /:/ });
export const NewLine = createToken({ name: 'NewLine', pattern: /\n|\r\n/ });
export const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: /[ \t]+/, // Corrected: escaped space and tab
  group: Lexer.SKIPPED
});

// --- Content Tokens ---
export const Identifier = createToken({
  name: 'Identifier',
  pattern: /[a-zA-Z_][a-zA-Z0-9_-]*/
});

export const FreeText = createToken({
  name: 'FreeText',
  pattern: /[^@\-=\n\r:]+/ // Corrected: escaped hyphen and other special characters
});

// --- Special Value Tokens ---
export const JsBlockStart = createToken({ name: 'JsBlockStart', pattern: /\{!/ }); // Corrected: escaped curly brace
export const JsBlockEnd = createToken({ name: 'JsBlockEnd', pattern: /!\}/ }); // Corrected: escaped curly brace
export const JsCode = createToken({
    name: 'JsCode',
    pattern: /.+?(?=!\})/,
    line_breaks: true
});

// --- Comment Token ---
export const Comment = createToken({
  name: 'Comment',
  pattern: /#.*/,
  group: Lexer.SKIPPED
});

// ----------------- L E X E R -----------------

export const allTokens = [
  NewLine,
  WhiteSpace,
  TripleDash,
  SceneMarker,
  ChoiceMarker,
  DividerMarker,
  Colon,
  JsBlockStart,
  JsBlockEnd,
  JsCode,
  Comment,
  Identifier,
  FreeText // Must be last as it's a catch-all for content
];

export const DendryLexer = new Lexer(allTokens, {
    // Full position tracking is needed for the CST Visitor to get complete
    // location information for each node.
    positionTracking: "full"
});
