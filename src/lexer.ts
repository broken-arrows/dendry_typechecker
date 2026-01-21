import { createToken, Lexer } from 'chevrotain';

// ----------------- T O K E N S -----------------

// 1) Define the tokens for the JS Block FIRST so they can be referenced in the mode switch
export const JsBlockStart = createToken({
  name: 'JsBlockStart',
  pattern: /\{!/,
  push_mode: 'js_mode' // Enter code mode
});

export const JsBlockEnd = createToken({
  name: 'JsBlockEnd',
  pattern: /!\}/,
  pop_mode: true // Exit code mode
});

// Match anything (including newlines) until we see !}
export const JsCode = createToken({
  name: 'JsCode',
  pattern: /[\s\S]+?(?=!\})/,
  line_breaks: true
});

// --- Structural Tokens ---
export const SceneMarker = createToken({ name: 'SceneMarker', pattern: /@/ });
export const ChoiceMarker = createToken({ name: 'ChoiceMarker', pattern: /-/ });
export const DividerMarker = createToken({ name: 'DividerMarker', pattern: /=/ });
export const TripleDash = createToken({ name: 'TripleDash', pattern: /---/ });
export const Colon = createToken({ name: 'Colon', pattern: /:/ });
export const NewLine = createToken({ name: 'NewLine', pattern: /\r\n|\n/});

export const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: /[ \t]+/,
  group: Lexer.SKIPPED
});

// --- Content Tokens ---
export const Identifier = createToken({
  name: 'Identifier',
  pattern: /[a-zA-Z0-9_][a-zA-Z0-9_-]*/
});
export const TagMarker = createToken({
  name: 'TagMarker',
  pattern: /#[a-zA-Z_][a-zA-Z0-9_-]*/
});


// Keep excluding @, -, =, :, newline so those become structural tokens.
export const FreeText = createToken({
  name: 'FreeText',
  pattern: /[^@\-=#\n\r:]+(?:[ \t]+[^@\-=#\n\r:]+)*/ // allow internal spaces, exclude # to avoid conflicting with tags/comments
});

// Comments start with '#'
export const Comment = createToken({
  name: 'Comment',
  pattern: /#(?![a-zA-Z_]).*/, // Negative lookahead: don't match if followed by identifier start
  group: Lexer.SKIPPED
});
// ----------------- L E X E R   D E F I N I T I O N -----------------

const lexerDefinition = {
  modes: {
    structural_mode: [
      WhiteSpace,
      NewLine,
      TripleDash,
      SceneMarker,
      ChoiceMarker,
      DividerMarker,
      Colon,
      JsBlockStart,
      TagMarker,
      Comment,
      Identifier,
      FreeText
    ],
    js_mode: [
      JsBlockEnd,
      JsCode
    ]
  },
  defaultMode: 'structural_mode'
};

export const DendryLexer = new Lexer(lexerDefinition, {
  positionTracking: 'full'
});

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
  TagMarker,
  Comment,
  Identifier,
  FreeText
];