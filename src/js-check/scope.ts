// AST walking: collect declarations, find references that aren't declared
// or in the known-globals set.

export interface IdentifierRef {
  name: string;
  // 0-based line within the source string
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

// Collects every name introduced by a declaration in the AST. Treats the
// AST as a single flat scope — Dendry property values are short, and
// per-scope analysis would add complexity for marginal benefit.
export function collectDeclarations(ast: any): Set<string> {
  const declared = new Set<string>();

  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;

    switch (node.type) {
      case 'VariableDeclarator':
        addPatternNames(node.id, declared);
        break;
      case 'FunctionDeclaration':
        if (node.id?.name) declared.add(node.id.name);
        addParamNames(node.params, declared);
        break;
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        addParamNames(node.params, declared);
        break;
      case 'ForInStatement':
      case 'ForOfStatement':
        if (node.left?.type === 'VariableDeclaration') {
          for (const decl of node.left.declarations) {
            addPatternNames(decl.id, declared);
          }
        } else if (node.left?.type === 'Identifier' && node.left.name) {
          declared.add(node.left.name);
        }
        break;
      case 'CatchClause':
        if (node.param) addPatternNames(node.param, declared);
        break;
    }

    for (const key in node) {
      if (key === 'loc' || key === 'range') continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  };

  visit(ast);
  return declared;
}

function addParamNames(params: any[] | undefined, out: Set<string>): void {
  if (!params) return;
  for (const param of params) addPatternNames(param, out);
}

// Walks any binding pattern (Identifier, ObjectPattern, ArrayPattern,
// AssignmentPattern, RestElement) and adds every name it binds.
function addPatternNames(pattern: any, out: Set<string>): void {
  if (!pattern || typeof pattern !== 'object') return;

  switch (pattern.type) {
    case 'Identifier':
      if (pattern.name) out.add(pattern.name);
      break;
    case 'AssignmentPattern':
      addPatternNames(pattern.left, out);
      break;
    case 'ObjectPattern':
      if (pattern.properties) {
        for (const prop of pattern.properties) {
          if (prop.type === 'RestElement') addPatternNames(prop.argument, out);
          else if (prop.value) addPatternNames(prop.value, out);
        }
      }
      break;
    case 'ArrayPattern':
      if (pattern.elements) {
        for (const elem of pattern.elements) addPatternNames(elem, out);
      }
      break;
    case 'RestElement':
      addPatternNames(pattern.argument, out);
      break;
  }
}

// Finds identifier references in the AST that resolve to neither a
// declaration nor a known global. Excludes property names of member
// expressions and non-computed object property keys, since those are not
// references.
export function findUndefinedReferences(
  ast: any,
  knownNames: ReadonlySet<string>
): IdentifierRef[] {
  const out: IdentifierRef[] = [];
  const seen = new Set<string>();

  const visit = (node: any, parent: any) => {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'Identifier' && node.name && !knownNames.has(node.name)) {
      const isMemberProp =
        parent?.type === 'MemberExpression' &&
        parent.property === node &&
        !parent.computed;
      const isObjectKey =
        parent?.type === 'Property' &&
        parent.key === node &&
        !parent.computed;
      const isLabelTarget =
        parent?.type === 'LabeledStatement' && parent.label === node;
      const isBreakContinueLabel =
        (parent?.type === 'BreakStatement' || parent?.type === 'ContinueStatement') &&
        parent.label === node;

      if (!isMemberProp && !isObjectKey && !isLabelTarget && !isBreakContinueLabel && node.loc) {
        const key = `${node.name}@${node.loc.start.line}:${node.loc.start.column}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({
            name: node.name,
            line: node.loc.start.line - 1,
            column: node.loc.start.column,
            endLine: node.loc.end.line - 1,
            endColumn: node.loc.end.column,
          });
        }
      }
    }

    for (const key in node) {
      if (key === 'loc' || key === 'range') continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(c => visit(c, node));
      else if (child && typeof child === 'object') visit(child, node);
    }
  };

  visit(ast, null);
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
