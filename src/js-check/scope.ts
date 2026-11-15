// Build lexical scopes before resolving references, so declaration order does
// not hide closures/hoisting and names never leak out of their owning scope.

export interface IdentifierRef {
  name: string;
  // 0-based line within the source string
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

function bindPattern(pattern: any, out: Set<string>, bindings: WeakSet<object>): void {
  if (!pattern || typeof pattern !== 'object') return;

  switch (pattern.type) {
    case 'Identifier':
      if (pattern.name) out.add(pattern.name);
      bindings.add(pattern);
      break;
    case 'AssignmentPattern':
      bindPattern(pattern.left, out, bindings);
      break;
    case 'ObjectPattern':
      if (pattern.properties) {
        for (const prop of pattern.properties) {
          if (prop.type === 'RestElement') bindPattern(prop.argument, out, bindings);
          else if (prop.value) bindPattern(prop.value, out, bindings);
        }
      }
      break;
    case 'ArrayPattern':
      if (pattern.elements) {
        for (const elem of pattern.elements) bindPattern(elem, out, bindings);
      }
      break;
    case 'RestElement':
      bindPattern(pattern.argument, out, bindings);
      break;
  }
}

interface Scope {
  parent?: Scope;
  names: Set<string>;
  varBoundary: boolean;
  strict: boolean;
}

function childNodes(node: any): any[] {
  const children: any[] = [];
  for (const key of Object.keys(node)) {
    if (key === 'loc') continue;
    const value = node[key];
    if (Array.isArray(value)) children.push(...value.filter(child => child && typeof child.type === 'string'));
    else if (value && typeof value.type === 'string') children.push(value);
  }
  return children;
}

// Returns unresolved references together with the visible names at that point
// for suggestions. Bindings in unrelated scopes must not become suggestions.
export function findUndefinedReferences(
  ast: any,
  knownNames: ReadonlySet<string>
): (IdentifierRef & { visibleNames: ReadonlySet<string> })[] {
  const scopes = new WeakMap<object, Scope>();
  const bindings = new WeakSet<object>();
  const hasStrictDirective = (body: any) => Array.isArray(body?.body) &&
    body.body.some((statement: any) => statement.directive === 'use strict');
  const root: Scope = { names: new Set(knownNames), varBoundary: true, strict: hasStrictDirective(ast) };
  const createScope = (parent: Scope, varBoundary = false): Scope => ({ parent, names: new Set(), varBoundary, strict: parent.strict });
  const bind = (pattern: any, scope: Scope) => bindPattern(pattern, scope.names, bindings);
  const varScope = (scope: Scope): Scope => scope.varBoundary ? scope : varScope(scope.parent!);
  const blockFunctions: { name: string; scope: Scope }[] = [];

  const collect = (node: any, scope: Scope): void => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      if (node.type === 'FunctionDeclaration') {
        bind(node.id, scope);
        if (!scope.strict && !scope.varBoundary && !node.async && !node.generator) {
          blockFunctions.push({ name: node.id.name, scope });
        }
      }
      const params = createScope(scope, true);
      params.strict ||= hasStrictDirective(node.body);
      if (node.type !== 'ArrowFunctionExpression') params.names.add('arguments');
      bind(node.id, params);
      for (const param of node.params) bind(param, params);
      scopes.set(node, params);
      // Defaults can see parameters, but not declarations in the function body.
      for (const param of node.params) collect(param, params);
      const body = createScope(params, true);
      scopes.set(node.body, body);
      if (node.body.type === 'BlockStatement') for (const statement of node.body.body) collect(statement, body);
      else collect(node.body, body);
      return;
    }
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      if (node.type === 'ClassDeclaration') bind(node.id, scope);
      scope = createScope(scope);
      scope.strict = true;
      bind(node.id, scope);
    } else if (node.type === 'CatchClause') {
      scope = createScope(scope);
      bind(node.param, scope);
    } else if (node.type === 'StaticBlock') {
      scope = createScope(scope, true);
    } else if (node.type === 'BlockStatement' || node.type === 'ForStatement' ||
      node.type === 'ForInStatement' || node.type === 'ForOfStatement' || node.type === 'SwitchStatement') {
      scope = createScope(scope);
    }
    scopes.set(node, scope);
    if (node.type === 'VariableDeclaration') {
      for (const declaration of node.declarations) bind(declaration.id, node.kind === 'var' ? varScope(scope) : scope);
    }
    for (const child of childNodes(node)) collect(child, scope);
  };
  collect(ast, root);
  // Annex B gives sloppy block functions a var binding too, unless an
  // intervening lexical declaration prevents that binding from being created.
  for (const { name, scope } of blockFunctions) {
    const owner = varScope(scope);
    let blocked = false;
    for (let current = scope.parent; current && current !== owner; current = current.parent) {
      if (current.names.has(name)) { blocked = true; break; }
    }
    if (!blocked) owner.names.add(name);
  }

  const out: (IdentifierRef & { visibleNames: ReadonlySet<string> })[] = [];
  const seen = new Set<string>();
  const visit = (node: any, parent: any, inherited: Scope): void => {
    const scope = scopes.get(node) || inherited;
    if (node.type === 'Identifier' && node.name && !bindings.has(node)) {
      const isMemberProp =
        parent?.type === 'MemberExpression' &&
        parent.property === node &&
        !parent.computed;
      const isObjectKey =
        (parent?.type === 'Property' || parent?.type === 'MethodDefinition' || parent?.type === 'PropertyDefinition') &&
        parent.key === node &&
        !parent.computed && !(parent.type === 'Property' && parent.shorthand);
      const isLabelTarget =
        parent?.type === 'LabeledStatement' && parent.label === node;
      const isBreakContinueLabel =
        (parent?.type === 'BreakStatement' || parent?.type === 'ContinueStatement') &&
        parent.label === node;

      if (!isMemberProp && !isObjectKey && !isLabelTarget && !isBreakContinueLabel && parent?.type !== 'MetaProperty' && node.loc) {
        for (let current: Scope | undefined = scope; current; current = current.parent) {
          if (current.names.has(node.name)) return;
        }
        const visibleNames = new Set<string>();
        for (let current: Scope | undefined = scope; current; current = current.parent) {
          for (const name of current.names) visibleNames.add(name);
        }
        const key = `${node.name}@${node.loc.start.line}:${node.loc.start.column}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({
            name: node.name,
            line: node.loc.start.line - 1,
            column: node.loc.start.column,
            endLine: node.loc.end.line - 1,
            endColumn: node.loc.end.column,
            visibleNames,
          });
        }
      }
    }

    for (const child of childNodes(node)) visit(child, node, scope);
  };

  visit(ast, null, root);
  return out;
}

// Finds `if (assignment)` patterns — common typo where `=` was meant as `==`.
export interface AssignInCondition {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export function findAssignmentsInConditions(ast: any): AssignInCondition[] {
  const out: AssignInCondition[] = [];

  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;

    if (
      node.type === 'IfStatement' &&
      node.test?.type === 'AssignmentExpression' &&
      node.test.loc
    ) {
      const loc = node.test.loc;
      out.push({
        line: loc.start.line - 1,
        column: loc.start.column,
        endLine: loc.end.line - 1,
        endColumn: loc.end.column,
      });
    }

    for (const key in node) {
      if (key === 'loc' || key === 'range') continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  };

  visit(ast);
  return out;
}
