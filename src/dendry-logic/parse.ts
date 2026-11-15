// Dendry gp.js parent-chain emission adaptation; copyright/permission notice
// is reproduced in grammar.ts and retained in production bundles.
import { GRAMMAR } from './grammar';
import { LogicError, Token } from './tokens';
export type LogicKind = 'actions' | 'predicate' | 'expression';
interface State { rule: number; dot: number; from: number; to: number; parent?: State; completed?: boolean }

// Earley recognition handles left recursion and nested commands directly.
// Per-column rule/dot/from dedup retains the first tree, matching pinned gp.js.
export function parseLogic(tokens: Token[], kind: LogicKind, end: number): { source?: string; error?: LogicError } {
  const charts = Array.from({ length: tokens.length + 1 }, () => ({ states: [] as State[], keys: new Set<string>() }));
  const add = (column: number, state: State) => {
    const chart = charts[column];
    const key = `${state.rule}:${state.dot}:${state.from}`;
    if (!chart.keys.has(key)) { chart.keys.add(key); chart.states.push(state); }
  };
  GRAMMAR.forEach((rule, index) => { if (rule.name === kind) add(0, { rule: index, dot: 0, from: 0, to: 0 }); });
  let farthest = 0;
  for (let column = 0; column <= tokens.length; column++) {
    const chart = charts[column];
    if (!chart.states.length) break;
    farthest = column;
    const predicted = new Set<string>();
    for (let index = 0; index < chart.states.length; index++) {
      const state = chart.states[index];
      const rule = GRAMMAR[state.rule];
      const next = rule.symbols[state.dot];
      if (!next) {
        for (const waiting of charts[state.from].states) {
          if (GRAMMAR[waiting.rule].symbols[waiting.dot] === '.' + rule.name) {
            add(column, { rule: waiting.rule, from: waiting.from, to: column, dot: waiting.dot + 1, parent: state, completed: true });
          }
        }
      } else if (next.startsWith('.')) {
        if (predicted.has(next)) continue;
        predicted.add(next);
        GRAMMAR.forEach((candidate, candidateIndex) => {
          if (candidate.name === next.slice(1)) add(column, { rule: candidateIndex, dot: 0, from: column, to: column, parent: state });
        });
      } else if (tokens[column]?.token === next) {
        add(column + 1, { rule: state.rule, from: state.from, to: column + 1, dot: state.dot + 1, parent: state });
      }
    }
  }
  const completed = charts[tokens.length].states.filter(state =>
    state.from === 0 && GRAMMAR[state.rule].name === kind && state.dot === GRAMMAR[state.rule].symbols.length);
  if (completed.length === 1) {
    // Preserve gp.js's first parent chain as well as its chart states. Nested
    // prefix/postfix conditionals can select a different emission otherwise.
    const stack: { from: number; to: number; value: any }[] = [];
    const emit = (state: State, complete: boolean): void => {
      if (state.parent) emit(state.parent, !!state.completed);
      if (!complete) return;
      const children: typeof stack = [];
      while (stack.length && stack[stack.length - 1].from >= state.from && stack[stack.length - 1].to <= state.to) children.unshift(stack.pop()!);
      let start = state.from;
      const values: any[] = [];
      for (const child of children) {
        values.push(...tokens.slice(start, child.from), child.value);
        start = child.to;
      }
      values.push(...tokens.slice(start, state.to));
      stack.push({ from: state.from, to: state.to, value: GRAMMAR[state.rule].build(values) });
    };
    emit(completed[0], true);
    return { source: stack[0].value.join('') };
  }
  const token = tokens[farthest];
  return { error: {
    offset: token?.offset ?? end, length: token?.length ?? 0,
    message: completed.length > 1 ? 'Ambiguous Dendry logic.' : token
      ? `Dendry logic Error: Unexpected '${token.text}' in ${kind}.`
      : `Dendry logic Error: Incomplete ${kind}.`,
  } };
}
