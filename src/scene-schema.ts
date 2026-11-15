// Authored scene-section fields from the pinned upstream scene.js schema.
// Structural id/content/options/sections are supplied by the parser, not headers.
export type ScenePropertyKind = 'text' | 'opaque' | 'boolean' | 'integer' | 'float' |
  'visits' | 'predicate' | 'expression' | 'action' | 'destination' | 'quality-destination' |
  'tags' | 'sprites' | 'quality-name' | 'call-reference' | 'jump-reference' | 'check-reference';

export const SCENE_SCHEMA: Readonly<Record<string, ScenePropertyKind>> = {
  title: 'text', subtitle: 'text', 'unavailable-subtitle': 'text',
  'view-if': 'predicate', 'choose-if': 'predicate',
  order: 'integer', priority: 'integer', frequency: 'float', 'frequency-var': 'expression',
  signal: 'opaque', style: 'opaque', tags: 'tags',
  'max-visits': 'visits', 'count-visits-max': 'visits', 'max-visits-var': 'expression',
  'on-arrival': 'action', 'on-departure': 'action', 'on-display': 'action',
  'game-over': 'boolean', 'new-page': 'boolean', 'set-root': 'boolean',
  'is-top': 'boolean', 'is-special': 'boolean', 'is-deck': 'boolean',
  'is-pinned-card': 'boolean', 'is-card': 'boolean', 'is-hand': 'boolean',
  'min-choices': 'integer', 'max-choices': 'integer', 'max-cards': 'integer',
  'go-to': 'destination', 'go-sub': 'destination', 'go-sub-start': 'destination',
  'go-sub-end': 'destination', 'go-to-ref': 'quality-destination',
  'set-jump': 'jump-reference', call: 'call-reference',
  'check-success-go-to': 'check-reference', 'check-failure-go-to': 'check-reference',
  'set-bg': 'opaque', 'set-music': 'opaque', 'set-sprites': 'sprites',
  // Upstream references an unexported validator, so this is effectively opaque.
  'set-sprite-styles': 'opaque',
  'set-top-left-style': 'opaque', 'set-top-right-style': 'opaque',
  'set-bottom-left-style': 'opaque', 'set-bottom-right-style': 'opaque',
  achievement: 'opaque', audio: 'opaque', 'card-image': 'opaque', 'face-image': 'opaque',
  // Quality-value coercion accepts numbers, booleans and arbitrary strings.
  'broad-difficulty': 'opaque', 'narrow-difficulty': 'opaque',
  'difficulty-scaler': 'opaque', 'difficulty-increment': 'opaque',
  'check-quality': 'quality-name',
};
