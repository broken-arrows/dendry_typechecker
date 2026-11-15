// Identifiers that should be considered "defined" when checking for
// undefined references in embedded JavaScript.

// ECMAScript and browser globals for the extension's HTML game target.
export const RUNTIME_GLOBALS: readonly string[] = [
  'console', 'Math', 'Date', 'JSON',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'undefined', 'null', 'true', 'false',
  'Object', 'Function', 'Array', 'String', 'Number', 'Boolean',
  'eval', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'Error', 'TypeError', 'ReferenceError', 'SyntaxError',
  'Infinity', 'NaN', 'window', 'document', 'alert', 'Image', 'localStorage',
  'globalThis', 'Promise', 'Set', 'Map', 'WeakSet', 'WeakMap', 'WeakRef', 'FinalizationRegistry', 'Symbol', 'BigInt',
  'RegExp', 'Reflect', 'Proxy', 'Atomics', 'SharedArrayBuffer', 'ArrayBuffer', 'DataView', 'Uint8Array', 'Int8Array',
  'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array',
  'Uint8ClampedArray', 'BigInt64Array', 'BigUint64Array', 'Intl',
  'RangeError', 'URIError', 'EvalError', 'AggregateError',
  'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent',
  'fetch', 'URL', 'URLSearchParams', 'navigator', 'performance',
  'requestAnimationFrame', 'cancelAnimationFrame', 'sessionStorage',
];

// Only these parameters are injected by engine.makeFunctionFromSource.
// Game/page libraries belong in validation.jsLibraries, not this inventory.
export const DENDRY_GLOBALS: readonly string[] = [
  'state', 'Q',
];
