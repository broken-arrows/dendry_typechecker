import * as vscode from 'vscode';
import { BUILTIN_QDISPLAYS, parseQDisplay } from './qdisplay';
import { DendryAST, DendryNode, normalizePropertyName } from './parser';
import { checkScript, FindingSeverity } from './js-check';
import { SCENE_SCHEMA } from './scene-schema';
import { ControlSource, controlPropertySource, destinationClauses } from './scene-control';
import { checkShorthand, LogicKind } from './dendry-logic/shorthand';
import { splitActionChunks } from './dendry-logic/chunks';
import { ABSOLUTE_SCENE_ID, BUILTIN_SCENE_IDS, RELATIVE_SCENE_ID, sceneIdFromPath, sceneReferenceCandidates } from './scene-ids';

type FileData = {
  uri: vscode.Uri;
  ast: DendryAST;
  localSceneIds: Set<string>;
};

export class DendryValidator {
  private contextSceneId = '';
  private strictMode: boolean;
  private extraLibraries: string[];
  private sceneIds: Set<string> = new Set();
  private sceneNodes = new Map<string, DendryNode>();
  private taggedScenes = new Map<string, DendryNode[]>();
  private qdisplayFiles: Set<string> = new Set();

  private readonly QUALITY_PROPERTIES = new Set(['id', 'type', 'name', 'initial', 'min', 'max', 'signal', 'is-valid', 'default-display']);

  private readonly CHOICE_PROPERTIES = new Set([
    'id',
    'title',
    'subtitle',
    'view-if',
    'choose-if',
    'order',
    'frequency',
    'frequency-var',
    'priority',
    'unavailable-subtitle'
  ]);

  constructor() {
    const config = vscode.workspace.getConfiguration('dendry');
    this.strictMode = config.get<boolean>('validation.strict', false);
    this.extraLibraries = config.get<string[]>('validation.jsLibraries', ['d3']);
  }

  validate(
    ast: DendryAST,
    document: vscode.TextDocument,
    allFileData: Map<string, FileData>,
    qdisplayFiles: string[]
  ): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    this.qdisplayFiles = new Set(qdisplayFiles);

    // rebuild global IDs
    this.sceneIds.clear();
    this.sceneNodes.clear();
    this.taggedScenes.clear();
    allFileData.forEach(d => {
      d.localSceneIds.forEach(id => this.sceneIds.add(id.trim()));
      for (const node of d.ast.nodes) {
        if (node.type !== 'scene') continue;
        this.sceneNodes.set(node.properties.get('id'), node);
        for (const tag of String(node.properties.get('tags') || '').split(/[\s;,]+/).filter(Boolean)) {
          const name = tag.replace(/^#/, '');
          const scenes = this.taggedScenes.get(name) || [];
          scenes.push(node);
          this.taggedScenes.set(name, scenes);
        }
      }
    });

    const rootId = sceneIdFromPath(document.uri.path) || '';
    this.contextSceneId = rootId;
    for (const id of BUILTIN_SCENE_IDS) this.sceneIds.add(id);

    for (const node of ast.nodes) {
      this.contextSceneId = node.type === 'scene' ? node.properties.get('id') || rootId : node.parentSceneId || rootId;
      diagnostics.push(...this.validateNode(node, document));
      if (node.interpolations && node.interpolations.length > 0) {
        this.validateInterpolations(node.interpolations, diagnostics);
      }
    }

    return diagnostics;
  }

  public validateQDisplayFile(document: vscode.TextDocument): vscode.Diagnostic[] {
    return parseQDisplay(document.getText(), document.uri.path).issues.map(issue => {
      const start = issue.source.position(0);
      const end = issue.source.position(issue.source.text.length);
      return this.createDiagnostic(new vscode.Range(start.line, start.character, end.line, end.character),
        issue.message, vscode.DiagnosticSeverity.Error);
    });
  }

  private validateInterpolations(interpolations: DendryNode['interpolations'], diagnostics: vscode.Diagnostic[]): void {
    const validIdentifierRegex = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

    for (const interpolation of interpolations) {
      // Validate variable name format
      if (!validIdentifierRegex.test(interpolation.variable)) {
        diagnostics.push(
          this.createDiagnostic(
            interpolation.range,
            `Invalid quality name '${interpolation.variable}'. Start with a letter; use letters, digits, _ or -.`,
            vscode.DiagnosticSeverity.Error
          )
        );
      }

      // Validate qdisplay reference
      if (interpolation.qdisplay) {
        // First validate the qdisplay name format
        if (!validIdentifierRegex.test(interpolation.qdisplay)) {
          diagnostics.push(
            this.createDiagnostic(
              interpolation.range,
              `Invalid QDisplay name '${interpolation.qdisplay}'. Start with a letter; use letters, digits, _ or -.`,
              vscode.DiagnosticSeverity.Error
            )
          );
        } else if (!BUILTIN_QDISPLAYS.has(interpolation.qdisplay) && !this.qdisplayFiles.has(interpolation.qdisplay)) {
          // Use the fullText to find the exact position of the qdisplay identifier
          const fullText = interpolation.fullText || '';
          const qdisplayIndex = fullText.lastIndexOf(interpolation.qdisplay);

          if (qdisplayIndex !== -1) {
            const qdisplayStart = interpolation.range.start.character + qdisplayIndex;
            const qdisplayEnd = qdisplayStart + interpolation.qdisplay.length;
            const qdisplayRange = new vscode.Range(
              interpolation.range.start.line,
              qdisplayStart,
              interpolation.range.end.line,
              qdisplayEnd
            );
            diagnostics.push(
              this.createDiagnostic(
                qdisplayRange,
                `QDisplay file "${interpolation.qdisplay}.qdisplay.dry" not found.`,
                vscode.DiagnosticSeverity.Error
              )
            );
          } else {
            // Fallback if we can't find it
            diagnostics.push(
              this.createDiagnostic(
                interpolation.range,
                `QDisplay file "${interpolation.qdisplay}.qdisplay.dry" not found.`,
                vscode.DiagnosticSeverity.Error
              )
            );
          }
        }
      }
    }
  }


  private validateNode(node: DendryNode, document: vscode.TextDocument): vscode.Diagnostic[] {
    switch (node.type) {
      case 'scene':
        return this.validateScene(node, document);
      case 'quality':
        return this.validateQuality(node, document);
      case 'info':
        return this.validateInfo(node, document);
      case 'choice':
        return this.validateChoice(node, document);
      default:
        return [];
    }
  }

  private validateScene(node: DendryNode, document: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const visitLimits = new Map<string, number>();

    for (const [key, value] of node.properties) {
      if (key === 'id') continue;
      const sourceRange = node.propertyRanges?.get(key) || node.range;
      const range = this.findRangeForProperty(document, sourceRange, key);
      const raw = document.getText(sourceRange);
      const rawValue = raw.slice(raw.indexOf(':') + 1).trim();
      // Scalar validators must see delimiters: `{! 2 !}` is not an integer.
      const scalar = containsMagicMarker(rawValue) ? rawValue : String(value);
      const kind = Object.prototype.hasOwnProperty.call(SCENE_SCHEMA, key) ? SCENE_SCHEMA[key] : undefined;
      switch (kind) {
        case undefined:
          diagnostics.push(this.createDiagnostic(range, `Unknown scene property: "${key}"`, vscode.DiagnosticSeverity.Error));
          break;
        case 'boolean':
          this.validateBoolean(scalar, range, key, diagnostics);
          break;
        case 'integer': case 'float': case 'visits': {
          const number = kind === 'float' ? parseFloat(scalar) : parseInt(scalar);
          if (kind === 'visits') visitLimits.set(key, number);
          if (Number.isNaN(number)) diagnostics.push(this.createDiagnostic(
            range, `Property "${key}" must be ${kind === 'float' ? 'a number' : 'a whole number'}.`, vscode.DiagnosticSeverity.Error,
          ));
          else if (kind === 'visits' && number < 1) diagnostics.push(this.createDiagnostic(
            range, `Property "${key}" must be at least 1.`, vscode.DiagnosticSeverity.Error,
          ));
          break;
        }
        case 'predicate': case 'expression': {
          if (!rawValue) diagnostics.push(this.createDiagnostic(
            range, `Property "${key}" requires a nonempty ${kind}.`, vscode.DiagnosticSeverity.Error,
          ));
          else diagnostics.push(...this.validatePredicateValue(controlPropertySource(raw, sourceRange.start.line), range, kind, kind === 'predicate'));
          break;
        }
        case 'action':
          diagnostics.push(...this.validateActionValue(controlPropertySource(raw, sourceRange.start.line)));
          break;
        case 'destination': case 'quality-destination': {
          const source = controlPropertySource(raw, sourceRange.start.line);
          this.validateDestinations(source, key, kind === 'quality-destination', range, diagnostics);
          break;
        }
        case 'quality-name':
          if (!/^[A-Za-z][\-A-Za-z0-9_]*$/.test(scalar)) diagnostics.push(this.createDiagnostic(
            range, 'check-quality requires one quality name, not a predicate.', vscode.DiagnosticSeverity.Error,
          ));
          break;
        case 'call-reference': case 'jump-reference': case 'check-reference': {
          const source = controlPropertySource(raw, sourceRange.start.line);
          const target = source.text.replace(/^@/, '');
          const syntax = kind === 'check-reference' ? RELATIVE_SCENE_ID : ABSOLUTE_SCENE_ID;
          if (!syntax.test(target)) diagnostics.push(this.createDiagnostic(
            this.controlRange(source, range),
            `Property "${key}" requires one ${kind === 'check-reference' ? 'relative' : 'absolute'} scene ID.`,
            vscode.DiagnosticSeverity.Error,
          ));
          else if (kind === 'call-reference') {
            // The engine indexes game.scenes[call] directly, including its
            // compiler-created blank built-in scenes, with no contextual lookup.
            if (!this.sceneIds.has(target)) diagnostics.push(this.createDiagnostic(
              this.controlRange(source, range),
              `Call target '${target}' is not defined.`,
              vscode.DiagnosticSeverity.Warning,
            ));
          } else {
            const linked = kind === 'jump-reference' ||
              (node.properties.has('check-success-go-to') && node.properties.has('check-failure-go-to'));
            this.validateSceneReference(target, this.controlRange(source, range), diagnostics,
              linked ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
          }
          break;
        }
        case 'tags':
          for (const tag of scalar.split(/[\s;,]+/).filter(Boolean)) {
            if (!/^#?([0-9a-zA-z_-]+)$/.test(tag)) diagnostics.push(this.createDiagnostic(
              range, `Invalid scene tag '${tag}'.`, vscode.DiagnosticSeverity.Error,
            ));
          }
          break;
        case 'sprites':
          // Upstream only requires a colon in each comma-separated entry;
          // empty locations/paths and extra colons are accepted.
          if (scalar.toLowerCase() !== 'none' && scalar.split(',').some(entry => !entry.includes(':'))) {
            diagnostics.push(this.createDiagnostic(range, 'set-sprites requires none or comma-separated location: path pairs.', vscode.DiagnosticSeverity.Error));
          }
          break;
        case 'text':
          for (let line = sourceRange.start.line; line <= sourceRange.end.line; line++) {
            this.validateInlineConditionalsInLine(document.lineAt(line).text, line, diagnostics);
          }
          break;
        case 'opaque': break;
      }
    }
    const maxVisits = visitLimits.get('max-visits');
    const countMax = visitLimits.get('count-visits-max');
    // Upstream checks this before max-visits-var overrides count tracking.
    if (countMax !== undefined && maxVisits !== undefined && countMax < maxVisits) diagnostics.push(this.createDiagnostic(
      this.findRangeForProperty(document, node.propertyRanges?.get('count-visits-max') || node.range, 'count-visits-max'),
      'count-visits-max cannot be lower than max-visits.', vscode.DiagnosticSeverity.Error,
    ));
    if (node.content.trim()) this.validateSceneContent(node, document, diagnostics);
    return diagnostics;
  }

  private controlRange(source: ControlSource, fallback: vscode.Range): vscode.Range {
    if (!source.text.length) return fallback;
    const start = source.position(0);
    const last = source.position(source.text.length - 1);
    return new vscode.Range(start.line, start.character, last.line, last.character + 1);
  }

  private validateDestinations(source: ControlSource, key: string, quality: boolean,
    fallback: vscode.Range, diagnostics: vscode.Diagnostic[]): void {
    const parsed = destinationClauses(source);
    if (parsed.unclosedMagic) {
      diagnostics.push(this.createDiagnostic(fallback, 'Unclosed Dendry logic block. Add !}.', vscode.DiagnosticSeverity.Error));
      return;
    }
    for (const clause of parsed.clauses) {
      const targetRange = this.controlRange(clause.target, fallback);
      const target = clause.target.text.replace(/^@/, '');
      if (quality) {
        if (!/^[A-Za-z][\-A-Za-z0-9_]*$/.test(clause.target.text)) diagnostics.push(this.createDiagnostic(
          targetRange, 'go-to-ref requires quality-name clauses with optional predicates.', vscode.DiagnosticSeverity.Error,
        ));
      } else if (!RELATIVE_SCENE_ID.test(target)) diagnostics.push(this.createDiagnostic(
        targetRange, `Property "${key}" requires scene-ID clauses with optional predicates; actions are not destinations.`,
        vscode.DiagnosticSeverity.Error,
      ));
      else this.validateSceneReference(target, targetRange, diagnostics,
        key === 'go-to' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);

      if (clause.predicate) this.validateDestinationPredicate(clause.predicate, fallback, diagnostics, key === 'go-to');
    }
  }

  private validateDestinationPredicate(source: ControlSource, fallback: vscode.Range, diagnostics: vscode.Diagnostic[], linked: boolean): void {
    if (!source.text) diagnostics.push(this.createDiagnostic(fallback, 'Destination requires a nonempty predicate after if.', vscode.DiagnosticSeverity.Error));
    else diagnostics.push(...this.validatePredicateValue(source, fallback, 'predicate', linked));
  }

  private validateSceneContent(node: DendryNode, document: vscode.TextDocument, diagnostics: vscode.Diagnostic[]): void {
      // Get all content from the scene (between properties and next scene/end)
      const startLine = node.contentRange?.start.line ?? node.range.start.line;
      const endLine = node.contentRange ? node.contentRange.end.line + 1 : node.range.end.line;

    for (let i = startLine; i < endLine; i++) {
        const lineText = document.lineAt(i).text;
        if (lineText.trim().startsWith('#')) {
            continue; // Skip comments
        }
        this.validateInlineConditionalsInLine(lineText, i, diagnostics, node.type === 'scene');
    }
  }

  private validateInlineConditionalsInLine(lineText: string, lineNum: number, diagnostics: vscode.Diagnostic[], linked = false) {
      // Match ONLY: [? condition : text ?]
      // Brackets are REQUIRED
      const regex = /(\[\?\s*)([^:]+?)\s*:\s*([^?]*)\?\]/gi;
      let match;

      while ((match = regex.exec(lineText)) !== null) {
          const conditionPrefix = match[1]; // '[?'
          const condition = match[2].trim();

          if (!condition) {
              const fullMatchStart = match.index;
              const fullMatchEnd = regex.lastIndex;
              const errRange = new vscode.Range(lineNum, fullMatchStart, lineNum, fullMatchEnd);
              diagnostics.push(this.createDiagnostic(errRange, 'Inline conditional is missing a condition before :', vscode.DiagnosticSeverity.Error));
              continue;
          }

          const conditionStartCol = match.index + conditionPrefix.length;
          const conditionEndCol = conditionStartCol + condition.length;
          const conditionRange = new vscode.Range(lineNum, conditionStartCol, lineNum, conditionEndCol);
          const source = ControlSource.literal(match[2], lineNum, conditionStartCol).trim();
          const keyword = source.text.match(/^if\s+/);
          if (!keyword) diagnostics.push(this.createDiagnostic(conditionRange, 'Inline condition must start with if.', vscode.DiagnosticSeverity.Error));
          else diagnostics.push(...this.validatePredicateValue(source.slice(keyword[0].length).trim(), conditionRange, 'predicate', linked));
      }
  }



  private validateQuality(node: DendryNode, document: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    if (!/^[A-Za-z][\-A-Za-z0-9_]*$/.test(String(node.properties.get('id') || ''))) {
      diagnostics.push(this.createDiagnostic(node.range, 'Invalid filename-derived quality name.', vscode.DiagnosticSeverity.Error));
    }
    if (!node.properties.has('name')) {
      diagnostics.push(this.createDiagnostic(node.range, 'Required quality property "name" missing.', vscode.DiagnosticSeverity.Error));
    }
    for (const [key, value] of node.properties.entries()) {
      const range = this.findRangeForProperty(document, node.propertyRanges?.get(key) || node.range, key);
      if (!this.QUALITY_PROPERTIES.has(key)) {
        diagnostics.push(this.createDiagnostic(range, `Unknown quality property: "${key}"`, vscode.DiagnosticSeverity.Error));
      }
      if ((key === 'min' || key === 'max') && Number.isNaN(parseFloat(String(value)))) {
        diagnostics.push(this.createDiagnostic(range, `Quality property '${key}' must be a number.`, vscode.DiagnosticSeverity.Error));
      }
      if (key === 'default-display' && !/^[A-Za-z][\-A-Za-z0-9_]*$/.test(String(value).trim())) {
        diagnostics.push(this.createDiagnostic(range, 'Quality default-display must be a quality-name-shaped formatter ID.', vscode.DiagnosticSeverity.Error));
      }
      if (key === 'is-valid') {
        const header = node.propertyRanges?.get(key) || range;
        const source = controlPropertySource(document.getText(header), header.start.line);
        diagnostics.push(...this.validatePredicateValue(source, range, 'predicate', false));
      }
    }
    // initial accepts numbers, booleans and strings. Upstream does not reject
    // out-of-range initial values or contradictory bounds; clamping is runtime behavior.
    if (node.content.trim()) this.validateSceneContent(node, document, diagnostics);
    return diagnostics;
  }

  private validateInfo(node: DendryNode, document: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const fields = new Set(['id', 'type', 'title', 'author', 'ifid', 'first-scene', 'root-scene',
      'animate', 'scene-signal', 'quality-signal', 'display-sidebar', 'display-stats', 'display-options', 'sidebar-stats']);
    for (const required of ['title', 'author']) {
      if (!node.properties.has(required)) diagnostics.push(this.createDiagnostic(
        node.range, `Required info property "${required}" missing.`, vscode.DiagnosticSeverity.Error,
      ));
    }
    for (const [key, value] of node.properties) {
      const range = this.findRangeForProperty(document, node.propertyRanges?.get(key) || node.range, key);
      if (!fields.has(key)) diagnostics.push(this.createDiagnostic(range, `Unknown info property: "${key}"`, vscode.DiagnosticSeverity.Error));
      if (key === 'type' && String(value).trim() !== 'info') {
        diagnostics.push(this.createDiagnostic(range, 'Info file type must equal "info".', vscode.DiagnosticSeverity.Error));
      }
      if (['animate', 'display-sidebar', 'display-stats', 'display-options'].includes(key)) {
        const boolean = String(value).trim().toLowerCase();
        if (!/^(yes|true|t|y|ok|no|false|f|n)$/.test(boolean) && Number.isNaN(parseInt(boolean))) {
          diagnostics.push(this.createDiagnostic(range, `Info property '${key}' must be a valid yes/no value.`, vscode.DiagnosticSeverity.Error));
        }
      }
      if (key === 'sidebar-stats') {
        // This is upstream's tag-list syntax (including its A-z character range),
        // not a declaration-only quality lookup: dynamic Q entries remain legal.
        for (const tag of String(value).split(/[\s;,]+/).filter(Boolean)) {
          if (!/^#?([0-9a-zA-z_-]+)$/.test(tag)) diagnostics.push(this.createDiagnostic(
            range, `Invalid sidebar-stats tag '${tag}'.`, vscode.DiagnosticSeverity.Error,
          ));
        }
      }
      if (key === 'first-scene' || key === 'root-scene') {
        const target = String(value).trim().replace(/^@/, '');
        if (!ABSOLUTE_SCENE_ID.test(target)) diagnostics.push(this.createDiagnostic(
          range, `Info property '${key}' must contain one absolute scene ID.`, vscode.DiagnosticSeverity.Error,
        ));
        else if (!this.sceneIds.has(target)) diagnostics.push(this.createDiagnostic(
          range, `Info ${key} refers to undefined scene '${target}'. The engine cannot use this startup/root target.`,
          vscode.DiagnosticSeverity.Warning,
        ));
      }
    }
    if (!node.properties.has('first-scene') && !node.properties.has('root-scene') && !this.sceneIds.has('root')) {
      diagnostics.push(this.createDiagnostic(node.range, "The default startup scene 'root' does not exist.", vscode.DiagnosticSeverity.Warning));
    }
    return diagnostics;
  }

  private validateChoice(node: DendryNode, document: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];

    for (const [key, value] of node.properties.entries()) {
      const r = this.findRangeForProperty(document, node.propertyRanges?.get(key) || node.range, key);

      if (!this.CHOICE_PROPERTIES.has(key)) {
        diagnostics.push(
          this.createDiagnostic(
            r,
            `Unknown choice property: "${key}"`,
            vscode.DiagnosticSeverity.Error
          )
        );
      }

      if (key === 'view-if' || key === 'choose-if' || key === 'frequency-var') {
        const header = node.propertyRanges?.get(key) || node.range;
        diagnostics.push(...this.validatePredicateValue(controlPropertySource(document.getText(header), header.start.line), r,
          key === 'frequency-var' ? 'expression' : 'predicate', key !== 'frequency-var'));
      }

      if (key === 'priority' || key === 'order' || key === 'frequency') {
        const numeric = key === 'frequency' ? parseFloat(String(value)) : parseInt(String(value));
        if (Number.isNaN(numeric)) diagnostics.push(this.createDiagnostic(
          r, `Choice property '${key}' must be ${key === 'frequency' ? 'a number' : 'a whole number'}.`,
          vscode.DiagnosticSeverity.Error,
        ));
      }
      if (key === 'title' || key === 'subtitle' || key === 'unavailable-subtitle') {
        const source = node.propertyRanges?.get(key);
        if (source) for (let line = source.start.line; line <= source.end.line; line++) {
          this.validateInlineConditionalsInLine(document.lineAt(line).text, line, diagnostics);
        }
      }
    }

    const reference = String(node.properties.get('id') || '');
    const line = node.range.start.line;
    const declaration = document.lineAt(line).text;
    const column = declaration.indexOf(reference[0]);
    const range = column < 0 ? node.range : new vscode.Range(line, column + 1, line, column + reference.length);
    if (reference.startsWith('#')) {
      const tag = reference.slice(1);
      const scenes = this.taggedScenes.get(tag);
      if (!scenes?.length) diagnostics.push(this.createDiagnostic(
        range, `No scenes have tag '#${tag}'.`, vscode.DiagnosticSeverity.Error,
      ));
      else for (const scene of scenes) {
        if (!this.hasTitle(scene)) diagnostics.push(this.createDiagnostic(
          range, `Scene '${scene.properties.get('id')}' needs a title for tag '#${tag}'.`, vscode.DiagnosticSeverity.Error,
        ));
      }
    } else if (reference.startsWith('@')) {
      const target = this.validateSceneReference(reference.slice(1), range, diagnostics);
      if (target && target !== 'prevScene' && !this.hasTitle(node) && !this.hasTitle(this.sceneNodes.get(target))) {
        diagnostics.push(this.createDiagnostic(
          range, `Choice to '${target}' needs a title here or on the target scene.`, vscode.DiagnosticSeverity.Error,
        ));
      }
    }
    return diagnostics;
  }

  private hasTitle(node: DendryNode | undefined): boolean {
    // Static whitespace compiles to an empty string; rich/dynamic content counts
    // even if it renders nothing. Text-field logic delimiters survive parsing.
    return Boolean(String(node?.properties.get('title') ?? '').trim());
  }

  private findRangeForProperty(document: vscode.TextDocument, nodeRange: vscode.Range, key: string): vscode.Range {
    const nodeText = document.getText(nodeRange);
    const lines = nodeText.split('\n');
    let propertyLineIndex = -1;
    let propertyLineText = '';

    for (let i = 0; i < lines.length; i++) {
      const candidate = lines[i].trim().replace(/^-\s*/, '').match(/^([^:]+):/);
      if (candidate && normalizePropertyName(candidate[1].trim()) === key) {
        propertyLineIndex = i;
        propertyLineText = lines[i];
        break;
      }
    }

    if (propertyLineIndex === -1) return nodeRange;

    const valueStartIndex = propertyLineText.indexOf(':') + 1;
    const valueText = propertyLineText.substring(valueStartIndex);

    // JS block case
    if (valueText.trim().startsWith('{!')) {
      const propertyAbsLine = nodeRange.start.line + propertyLineIndex;
      const openRel = valueText.indexOf('{!');

      // JS starts either after "{!" on same line, or at next line column 0
      const afterOpen = valueText.substring(openRel + 2);
      let startLine: number;
      let startCol: number;

      if (afterOpen.trim().length > 0) {
        startLine = propertyAbsLine;
        startCol = nodeRange.start.character + valueStartIndex + openRel + 2;
      } else {
        // Anchor on the `{!` line itself: the parser leaves a leading `\n`
        // in the unwrapped value so source line 0 is empty, which makes
        // anchor.start.line + sourceLine map correctly to document lines.
        startLine = propertyAbsLine;
        startCol = 0;
      }

      // Find closing "!}"
      for (let i = propertyLineIndex; i < lines.length; i++) {
        const closingIndex = lines[i].indexOf('!}');
        if (closingIndex !== -1) {
          const endLine = nodeRange.start.line + i;
          const endCol = (i === propertyLineIndex ? nodeRange.start.character : 0) + closingIndex;
          return new vscode.Range(startLine, startCol, endLine, endCol);
        }
      }

      // fallback: highlight at least "{!"
      const openAbsCol = nodeRange.start.character + valueStartIndex + openRel;
      return new vscode.Range(propertyAbsLine, openAbsCol, propertyAbsLine, openAbsCol + 2);
    }

    // Normal scalar value on same line
    const line = nodeRange.start.line + propertyLineIndex;
    const leftTrim = valueText.length - valueText.trimStart().length;

    // Get the actual line from the document for accurate column positioning
    const actualLine = document.lineAt(line).text;
    const colonIndex = actualLine.indexOf(':');
    if (colonIndex !== -1) {
        // Calculate from the actual document line
        const afterColon = actualLine.substring(colonIndex + 1);
        const valueStart = afterColon.length - afterColon.trimStart().length;
        const startCol = colonIndex + 1 + valueStart;
        const endCol = startCol + afterColon.trim().length;
        return new vscode.Range(line, startCol, line, endCol);
    } else {
        // Fallback to previous calculation
        const startCol = nodeRange.start.character + valueStartIndex + leftTrim;
        const endCol = startCol + valueText.trim().length;
        return new vscode.Range(line, startCol, line, endCol);
    }
  }

  private validateBoolean(value: any, range: vscode.Range, propertyName: string, diagnostics: vscode.Diagnostic[]) {
    const name = String(value).trim().toLowerCase();
    if (!/^(yes|true|t|y|ok|no|false|f|n)$/.test(name) && Number.isNaN(parseInt(name))) {
      diagnostics.push(this.createDiagnostic(
        range, `Property "${propertyName}" must be a valid yes/no value, got: "${value}"`, vscode.DiagnosticSeverity.Error,
      ));
    }
  }

  // ---------- JavaScript / Dendry-shorthand validation ----------
  //
  // Top-level entry points (matched to property kind):
  //  - validatePredicateValue: `view-if`, `choose-if`, expression fields.
  //    Mixing logic + magic is rejected per upstream `makeCompile`.
  //  - validateActionValue:    `on-arrival`, `on-departure`, `on-display`.
  //    Mixed values are chunk-split per upstream
  //    `validateActions`; alternating chunks dispatch to magic (JS
  //    block) or logic (Dendry shorthand) validation.
  // All executable properties carry their source map through dispatch.
  // Extracted inline conditions also use the grammar; full content extraction
  // remains a separate parser task.

  private validatePredicateValue(source: ControlSource, fallback: vscode.Range, kind: 'predicate' | 'expression', linked: boolean): vscode.Diagnostic[] {
    const range = this.controlRange(source, fallback);
    if (containsMagicMarker(source.text)) {
      // makeCompile uses the FIRST closing marker, unlike action chunking.
      if (source.text.indexOf('{!') > 0 || source.text.indexOf('!}') < source.text.length - 2) {
        return [this.createDiagnostic(range, 'Wrap the entire condition in {! !}.', vscode.DiagnosticSeverity.Error)];
      }
      return this.validateAsJsBlock(source.slice(2, source.text.length - 2));
    }
    return this.validateAsShorthand(source, kind, linked);
  }

  private validateActionValue(source: ControlSource): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const chunks = splitActionChunks(source.text);
    for (const chunk of chunks) {
      const mapped = source.slice(chunk.offset, chunk.offset + chunk.source.length);
      if (chunk.kind === 'magic') {
        diagnostics.push(...this.validateAsJsBlock(mapped));
      } else {
        diagnostics.push(...this.validateAsShorthand(mapped, 'actions', true));
      }
    }
    return diagnostics;
  }

  private validateAsJsBlock(source: ControlSource): vscode.Diagnostic[] {
    const findings = checkScript(source.text, {
      functionBody: true,
      extraGlobals: this.extraLibraries,
      checkUndefined: true,
      undefinedSeverity: this.strictMode ? 'warning' : 'hint',
    });
    return findings.map(f => {
      const start = source.positionAt(f.startLine, f.startColumn);
      const end = source.positionAt(f.endLine, f.endColumn);
      return this.createDiagnostic(new vscode.Range(start.line, start.character, end.line, end.character),
        f.message, this.severityFor(f.severity));
    });
  }

  private validateAsShorthand(source: ControlSource, kind: LogicKind, linked: boolean): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const checked = checkShorthand(source.text, kind);
    const tokenRange = (offset: number, length: number) => {
      const start = source.position(offset);
      const end = source.position(offset + length);
      return new vscode.Range(start.line, start.character, end.line, end.character);
    };
    for (const error of checked.errors) {
      diagnostics.push(this.createDiagnostic(tokenRange(error.offset, error.length), error.message, vscode.DiagnosticSeverity.Error));
    }
    if (checked.errors.length) return diagnostics;
    // Upstream linking scans source with a regex, even inside quoted strings.
    // Unlinked schema fields get authoring warnings for actual visit tokens.
    const visits = linked
      ? [...source.text.matchAll(/@((?:\.+|[\w-])[\w-]*(?:\.[\w-]+)*)/g)].map(match =>
        ({ text: match[0], offset: match.index!, length: match[0].length }))
      : checked.visits;
    for (const visit of visits) {
      const range = tokenRange(visit.offset, visit.length);
      const severity = linked ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
      const target = this.validateSceneReference(visit.text.slice(1), range, diagnostics, severity);
      if (!target) continue;
      const properties = this.sceneNodes.get(target)?.properties;
      if (!properties || !['count-visits-max', 'max-visits', 'max-visits-var'].some(key => properties.has(key))) {
        diagnostics.push(this.createDiagnostic(range, `Scene '${target}' needs count-visits-max for this visit count.`, severity));
      }
    }
    return diagnostics;
  }

  private severityFor(s: FindingSeverity): vscode.DiagnosticSeverity {
    switch (s) {
      case 'error': return vscode.DiagnosticSeverity.Error;
      case 'warning': return vscode.DiagnosticSeverity.Warning;
      case 'hint': return vscode.DiagnosticSeverity.Hint;
    }
  }


  private validateSceneReference(sceneId: string, range: vscode.Range, diagnostics: vscode.Diagnostic[], severity = vscode.DiagnosticSeverity.Error): string | undefined {
    const reference = sceneId.trim().replace(/^@/, '');
    try {
      const candidates = sceneReferenceCandidates(this.contextSceneId, reference);
      const target = candidates.find(candidate => this.sceneIds.has(candidate));
      if (target) return target;
      diagnostics.push(this.createDiagnostic(
        range, `Reference to undefined scene '${reference}' in '${this.contextSceneId}'.`,
        severity,
      ));
    } catch (error) {
      diagnostics.push(this.createDiagnostic(range, (error as Error).message, severity));
    }
  }

  private createDiagnostic(range: vscode.Range, message: string, severity: vscode.DiagnosticSeverity): vscode.Diagnostic {
    const d = new vscode.Diagnostic(range, message, severity);
    d.source = 'dendry';
    return d;
  }
}

// Language markers are retained independently of line count.
function containsMagicMarker(value: string): boolean {
  return value.includes('{!') || value.includes('!}');
}
