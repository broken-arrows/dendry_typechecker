import type * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateCore, deactivateCore } from '../activate-core';
import { parseText } from '../parser';
import { DendryProjectValidator } from '../project-validator';
import { engineCorpus, engineFiles, engineOracle } from './engine-corpus';
import { DiagnosticSeverity, editor, loadProject, workspace } from './vscode-host';

const ten = 'dendrynexus-ten';
beforeEach(() => editor.reset());
afterEach(() => vi.restoreAllMocks());
function flatten(results: Map<vscode.Uri, vscode.Diagnostic[]>) {
  return [...results].flatMap(([uri, diagnostics]) => diagnostics.map(item => ({
    file: uri.path.replace('/compatibility/', ''), ...item,
  })));
}
async function validate(contents: string, engine = ten, name = 'root.scene.dry') {
  editor.configure({ 'validation.dendrynexusTen': engine === ten });
  const uris = loadProject([{ name, contents }]);
  return flatten(await new DendryProjectValidator().validateProject(uris));
}

describe.each(['dendrynexus', ten] as const)('%s feature compiler compatibility', engine => {
  for (const testCase of engineCorpus.cases) it(testCase.id, async () => {
    const reference = engineOracle.features[testCase.id][engine];
    const expected = testCase.errors[engine];
    expect(reference.ok, reference.error).toBe(!expected);
    editor.configure({ 'validation.dendrynexusTen': engine === ten });
    const results = await new DendryProjectValidator().validateProject(loadProject(engineFiles(testCase)));
    const diagnostics = flatten(results);
    expect(diagnostics.filter(item => /Error (?:opening|reading|parsing|validating) file/.test(item.message))).toEqual([]);
    const errors = diagnostics.filter(item => item.severity === DiagnosticSeverity.Error);
    if (!expected) expect(errors).toEqual([]);
    else expect(errors.some(item => item.file === expected.file && new RegExp(expected.pattern, 'i').test(item.message)),
      `Compiler: ${reference.error}\nExtension: ${JSON.stringify(diagnostics)}`).toBe(true);
  });
});

describe('TEN agreed case-insensitive role contract', () => {
  // The inspected compiler snapshot accepts these lowercase values. Mixed case
  // is the explicitly agreed addition, not an outcome recorded from that engine.
  for (const fixture of engineCorpus.cases.filter(item => item.id.startsWith('root-role-') && !item.id.includes('explicit'))) {
    const role = fixture.files[0].contents.match(/^role: (.+)$/m)![1];
    it.each(['', 'title: Root\n\nBody.\n\n@part\n'])(`accepts ${role.toUpperCase()} in root/section %j`, async prefix => {
      const diagnostics = await validate(prefix + `title: T\nROLE: ${role.toUpperCase()}\n\nBody.`);
      expect(diagnostics).toEqual([]);
    });
  }
  it('accepts mixed case without rewriting authored properties or their ranges', async () => {
    const contents = 'title: T\nrole: CaRd-GoV\n\nBody.';
    const parsed = parseText(contents, 'root.scene.dry');
    expect(parsed.errors).toEqual([]);
    expect(parsed.ast.nodes[0].properties.get('role')).toBe('CaRd-GoV');
    expect(parsed.ast.nodes[0].propertyRanges!.get('role')!.start.line).toBe(1);
    expect(await validate(contents)).toEqual([]);
  });
});

describe('TEN legacy field warnings', () => {
  const replacements = [
    ['is-hand', 'desk'], ['is-card', 'card'],
    ['is-deck', 'deck'], ['is-pinned-card', 'pinned-action'],
  ];
  for (const prefix of ['', 'title: Root\n\nBody.\n\n@part\n']) {
    it.each(replacements)(`warns once for %s in ${prefix ? 'sections' : 'root scenes'}`, async (property, role) => {
      const declaration = `${property}: true`;
      const contents = `${prefix}title: T\n${declaration}\n\nBody.`;
      const diagnostics = await validate(contents);
      expect(diagnostics).toHaveLength(1);
      const line = prefix.split('\n').length;
      expect(diagnostics[0]).toMatchObject({
        message: `Deprecated: use "role: ${role}".`, severity: DiagnosticSeverity.Warning,
        range: { start: { line, character: 0 }, end: { line, character: declaration.length } },
      });
    });
  }
  it('keeps all four fields valid without warnings in standard mode', async () => {
    const contents = replacements.map(([property]) => `${property}: true`).join('\n');
    expect(await validate(contents, 'dendrynexus')).toEqual([]);
  });
  it('warns on normalized names and explicit false overrides', async () => {
    expect(await validate('title: T\nrole: desk\nIs_Hand: false')).toMatchObject([{
      message: 'Deprecated: use "role: desk".', severity: DiagnosticSeverity.Warning,
      range: { start: { line: 2, character: 0 }, end: { line: 2, character: 14 } },
    }]);
  });
  it('still rejects invalid boolean values on deprecated fields', async () => {
    const diagnostics = await validate('is-hand: bogus');
    expect(diagnostics.filter(item => item.severity === DiagnosticSeverity.Warning)).toHaveLength(1);
    expect(diagnostics.filter(item => item.severity === DiagnosticSeverity.Error)).toHaveLength(1);
  });
  it('does not warn on role-only scenes, prose or JavaScript strings', async () => {
    expect(await validate('title: T\nrole: desk\non-arrival: {! var text = "is-card: true"; !}\n\nis-hand: true')).toEqual([]);
  });
  it('keeps legacy fields invalid on choices rather than reporting deprecation', async () => {
    const diagnostics = await validate('title: T\n\nBody.\n\n- @root\n- is-hand: true');
    expect(diagnostics).toMatchObject([{
      message: 'Unknown choice property: "is-hand"', severity: DiagnosticSeverity.Error,
    }]);
  });
  it('adds and clears warnings on cached files when toggling TEN', async () => {
    const uris = loadProject([{ name: 'root.scene.dry', contents: 'is-hand: true' }]);
    const validator = new DendryProjectValidator();
    expect(flatten(await validator.validateProject(uris))).toEqual([]);
    editor.configure({ 'validation.dendrynexusTen': true });
    expect(flatten(await validator.validateProject(uris, []))).toMatchObject([{
      message: 'Deprecated: use "role: desk".', severity: DiagnosticSeverity.Warning,
    }]);
    editor.configure({ 'validation.dendrynexusTen': false });
    expect(flatten(await validator.validateProject(uris, []))).toEqual([]);
  });
});

describe('engine selection and authoring diagnostics', () => {
  it('contributes an opt-in resource setting with the existing engine as default', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
    expect(manifest.contributes.configuration.properties['dendry.validation.dendrynexusTen']).toMatchObject({
      scope: 'resource', type: 'boolean', default: false,
    });
    expect(manifest.contributes.configuration.properties).not.toHaveProperty('dendry.validation.engine');
  });
  it.each([undefined, false, null, 'true', 'dendrynexus-ten', 1, {}])('uses standard validation unless the flag is true: %j', async value => {
    editor.configure({ 'validation.dendrynexusTen': value });
    const uris = loadProject([{ name: 'root.scene.dry', contents: 'role: card' }]);
    const diagnostics = flatten(await new DendryProjectValidator().validateProject(uris));
    expect(diagnostics.map(item => item.message)).toEqual(['Unknown scene property: "role"']);
  });
  it('points role/version/language failures at their authored values', async () => {
    const role = await validate('title: T\nrole: bogus');
    expect(role).toHaveLength(1);
    expect(role[0].range).toMatchObject({ start: { line: 1, character: 6 }, end: { line: 1, character: 11 } });
    const info = await validate('title: T\nauthor: A\nversion: bad\nlanguages: en/ca', ten, 'info.dry');
    const errors = info.filter(item => item.severity === DiagnosticSeverity.Error);
    expect(errors).toHaveLength(2);
    expect(errors.map(item => item.range.start)).toEqual([{ line: 2, character: 9 }, { line: 3, character: 11 }]);
  });
  it('keeps unknown fields and malformed role values invalid', async () => {
    const diagnostics = await validate('role: CARD-GOVERNMENT\nunknown: value');
    expect(diagnostics.map(item => item.message)).toEqual([expect.stringContaining('Role must'), 'Unknown scene property: "unknown"']);
  });
  it('does not validate opaque choice images as content or JavaScript', async () => {
    expect(await validate('title: T\nchoice-image: {! missingGlobal(); !}\n\nBody.\n\n- @root\n- choice-image: [+ unknown : missing +]')).toEqual([]);
  });
  it('keeps nested rich-content dependencies and positions under both profiles', async () => {
    const contents = 'title: T\n\n[? if {! return true; !} : Before [+ 2 : absent +] [? if TRUE: [+ 3 +] ?] ?]';
    const standard = await validate(contents, 'dendrynexus');
    const selected = await validate(contents);
    expect(selected).toEqual(standard);
    expect(selected).toHaveLength(1);
    expect(selected[0].message).toContain('absent.qdisplay.dry');
    expect(selected[0].range.start).toEqual({ line: 2, character: contents.split('\n')[2].indexOf('absent') });
  });
  it('rechecks cached ASTs using the current resource profile in both directions', async () => {
    const uris = loadProject([{ name: 'root.scene.dry', contents: 'role: CARD\nchoice-image: face.png' }]);
    const validator = new DendryProjectValidator();
    expect(flatten(await validator.validateProject(uris))).toHaveLength(2);
    editor.configure({ 'validation.dendrynexusTen': true });
    expect(flatten(await validator.validateProject(uris, []))).toEqual([]);
    editor.configure({ 'validation.dendrynexusTen': false });
    expect(flatten(await validator.validateProject(uris, []))).toHaveLength(2);
  });
});

describe('engine setting changes through editor activation', () => {
  let subscriptions: vscode.Disposable[];
  beforeEach(() => { vi.useFakeTimers(); subscriptions = []; });
  afterEach(() => {
    deactivateCore();
    for (const subscription of subscriptions) subscription.dispose();
    vi.useRealTimers();
  });
  const activate = () => activateCore({ subscriptions } as vscode.ExtensionContext);
  const published = () => [...editor.collections[0].entries.values()].flatMap(({ uri, diagnostics }) =>
    diagnostics.map(item => ({ file: uri.path.replace('/compatibility/', ''), ...item })));

  it('refreshes unchanged closed files and cached QDisplay output when switching engines', async () => {
    loadProject([
      { name: 'root.scene.dry', contents: 'title: T\nrole: CARD\nchoice-image: face.png' },
      { name: 'info.dry', contents: 'title: T\nauthor: A\nversion: 1.2\nlanguages: en ca' },
      { name: 'rank.qdisplay.dry', contents: '\n(..) [+ {! return customLibrary(); !} +]' },
    ]);
    workspace.textDocuments = [];
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()).toHaveLength(5);
    editor.configure({ 'validation.dendrynexusTen': true, 'validation.jsLibraries': ['customLibrary'] });
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toEqual([]);
    editor.configure({ 'validation.dendrynexusTen': false, 'validation.jsLibraries': [] });
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toHaveLength(5);
    expect(editor.errors).toEqual([]);
  });
  it('isolates profiles across roots and updates only the configured root', async () => {
    const uris = loadProject(['a', 'b'].map(name => ({ name: `${name}/root.scene.dry`, contents: 'role: CARD' })));
    workspace.workspaceFolders = ['a', 'b'].map((name, index) => ({ name, index, uri: uris[index].with({ path: `/compatibility/${name}` }) }));
    editor.configure({ 'validation.dendrynexusTen': true }, '/compatibility/a');
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published().map(item => item.file)).toEqual(['b/root.scene.dry']);
    editor.configure({ 'validation.dendrynexusTen': true }, '/compatibility/b');
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toEqual([]);
    editor.configure({ 'validation.dendrynexusTen': false }, '/compatibility/a');
    await vi.advanceTimersByTimeAsync(500);
    expect(published().map(item => item.file)).toEqual(['a/root.scene.dry']);
  });
  it('uses resource settings for standalone documents', async () => {
    loadProject([{ name: 'loose.scene.dry', contents: 'role: CARD' }]);
    workspace.workspaceFolders = undefined;
    editor.configure({ 'validation.dendrynexusTen': true });
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()).toEqual([]);
    editor.configure({ 'validation.dendrynexusTen': false });
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toHaveLength(1);
  });
  it('suppresses a pass made obsolete by an engine change while reading a closed file', async () => {
    loadProject([{ name: 'root.scene.dry', contents: 'role: CARD' }]);
    workspace.textDocuments = [];
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()).toHaveLength(1);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const read = workspace.fs.readFile;
    const spy = vi.spyOn(workspace.fs, 'readFile').mockImplementationOnce(async uri => { await gate; return read(uri); });
    editor.configure({ 'validation.dendrynexusTen': true });
    await vi.advanceTimersByTimeAsync(500);
    expect(spy).toHaveBeenCalled();
    editor.configure({ 'validation.dendrynexusTen': false });
    const updates = editor.collections[0].updates.length;
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(editor.collections[0].updates).toHaveLength(updates);
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toHaveLength(1);
    expect(published()[0].message).toContain('Unknown scene property');
  });
});
