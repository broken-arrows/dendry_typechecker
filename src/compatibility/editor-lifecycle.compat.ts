import type * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateCore, deactivateCore } from '../activate-core';
import { DiagnosticSeverity, editor, loadProject, workspace } from './vscode-host';

function published() {
  return [...editor.collections[0].entries.values()].flatMap(({ uri, diagnostics }) =>
    diagnostics.map(diagnostic => ({ file: uri.path.replace('/compatibility/', ''), ...diagnostic })));
}
const root = { name: 'root.scene.dry', contents: 'title: Root' };

describe('editor file/configuration/document lifecycle', () => {
  let subscriptions: vscode.Disposable[];
  beforeEach(() => {
    vi.useFakeTimers();
    editor.reset();
    subscriptions = [];
  });
  afterEach(() => {
    deactivateCore();
    for (const disposable of subscriptions) disposable.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  function activate() { activateCore({ subscriptions } as vscode.ExtensionContext); }

  it('rechecks references when an unopened dependency is created in the editor', async () => {
    loadProject([{ ...root, contents: 'title: Root\ngo-to: target' }]);
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()).toHaveLength(1);
    const target = editor.writeFile('target.scene.dry', 'title: Target');
    editor.events.create.fire({ files: [target] });
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toEqual([]);
  });

  it('refreshes unopened files on external filesystem changes', async () => {
    const uris = loadProject([root, { name: 'target.scene.dry', contents: 'game-over: invalid' }]);
    workspace.textDocuments = workspace.textDocuments.slice(0, 1);
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()).toHaveLength(1);
    editor.writeFile('target.scene.dry', 'title: Target');
    editor.watch('change', uris[1]);
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toEqual([]);
  });

  it('removes old formatter IDs and diagnostics after a rename', async () => {
    const uris = loadProject([{ ...root, contents: 'title: [+ score : old +]' }, { name: 'old.qdisplay.dry', contents: '\n(..) Good' }]);
    workspace.textDocuments = workspace.textDocuments.slice(0, 1);
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()).toEqual([]);
    editor.deleteFile(uris[1]);
    const renamed = editor.writeFile('new.qdisplay.dry', '\n(..) Good');
    editor.events.rename.fire({ files: [{ oldUri: uris[1], newUri: renamed }] });
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toHaveLength(1);
    expect(published()[0].message).toContain('old.qdisplay.dry');
  });

  it('updates existing JavaScript findings when strict mode changes', async () => {
    loadProject([{ ...root, contents: 'on-arrival: {! missingHelper(); !}' }]);
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()[0].severity).toBe(DiagnosticSeverity.Hint);
    editor.configure({ 'validation.strict': true });
    await vi.advanceTimersByTimeAsync(500);
    expect(published()[0].severity).toBe(DiagnosticSeverity.Warning);
  });

  it('clears disabled diagnostics immediately and restores them on re-enable', async () => {
    loadProject([{ ...root, contents: 'game-over: invalid' }]);
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()).toHaveLength(1);
    editor.configure({ 'validation.enable': false });
    expect(published()).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toEqual([]);
    editor.configure({ 'validation.enable': true });
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toHaveLength(1);
  });

  it('retains diagnostics after closing a saved workspace file', async () => {
    loadProject([{ ...root, contents: 'game-over: invalid' }]);
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    editor.close(workspace.textDocuments[0]);
    expect(published()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toHaveLength(1);
    expect(editor.errors).toEqual([]);
  });

  it('validates supported documents already open without a workspace', async () => {
    workspace.workspaceFolders = [];
    loadProject([{ ...root, contents: 'game-over: invalid' }]);
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()).toHaveLength(1);
    editor.close(workspace.textDocuments[0]);
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toEqual([]);
  });

  it.each([
    ['scene', 'go-to: target', 'target.scene.dry', 'title: Target'],
    ['formatter', 'title: [+ score : rating +]', 'rating.qdisplay.dry', '\n(..) Good'],
  ])('resolves a missing %s after an external file creation', async (_kind, contents, name, targetContents) => {
    loadProject([{ ...root, contents }]);
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()).toHaveLength(1);
    const uri = editor.writeFile(name, targetContents);
    editor.watch('create', uri);
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toEqual([]);
  });

  it('handles an external folder creation containing a new dependency', async () => {
    loadProject([{ ...root, contents: 'title: Root\ngo-to: target' }]);
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()).toHaveLength(1);
    const target = editor.writeFile('imported/target.scene.dry', 'title: Target');
    editor.watch('create', target.with({ path: '/compatibility/imported' }));
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toEqual([]);
  });

  it('handles a parent-only external deletion without retaining descendants', async () => {
    const uris = loadProject([
      { ...root, contents: 'title: Root\ngo-to: target' },
      { name: 'gone/target.scene.dry', contents: 'game-over: invalid' },
    ]);
    workspace.textDocuments = workspace.textDocuments.slice(0, 1);
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()[0].file).toBe('gone/target.scene.dry');
    editor.deleteFile(uris[1]);
    editor.watch('delete', uris[1].with({ path: '/compatibility/gone' }));
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toHaveLength(1);
    expect(published()[0].file).toBe('root.scene.dry');
    expect(published()[0].message).toContain('target');
  });

  it('moves descendant diagnostics when the editor renames a directory', async () => {
    const uris = loadProject([root, { name: 'old/target.scene.dry', contents: 'game-over: invalid' }]);
    workspace.textDocuments = workspace.textDocuments.slice(0, 1);
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    editor.deleteFile(uris[1]);
    const target = editor.writeFile('new/target.scene.dry', 'game-over: invalid');
    editor.events.rename.fire({ files: [{ oldUri: uris[1].with({ path: '/compatibility/old' }), newUri: target.with({ path: '/compatibility/new' }) }] });
    await vi.advanceTimersByTimeAsync(500);
    expect(published().map(item => item.file)).toEqual(['new/target.scene.dry']);
  });

  it('keeps an excluded open/edited dependency out of the scene index', async () => {
    loadProject([
      { ...root, contents: 'title: Root\ngo-to: target' },
      { name: 'node_modules/target.scene.dry', contents: 'game-over: invalid' },
    ]);
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    editor.events.change.fire({ document: workspace.textDocuments[1] });
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toHaveLength(1);
    expect(published()[0].file).toBe('root.scene.dry');
    expect(published()[0].message).toContain('target');
  });

  it('does not parse unsupported files manually assigned the Dendry language', async () => {
    workspace.workspaceFolders = [];
    loadProject([{ name: 'notes.txt', contents: 'game-over: invalid' }]);
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    editor.events.change.fire({ document: workspace.textDocuments[0] });
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toEqual([]);
  });

  it('refreshes library settings in both scene and QDisplay JavaScript', async () => {
    loadProject([
      { ...root, contents: 'title: Root\non-arrival: {! customLibrary(); !}' },
      { name: 'rating.qdisplay.dry', contents: '\n(..) [+ {! return customLibrary(); !} +]' },
    ]);
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()).toHaveLength(2);
    editor.configure({ 'validation.jsLibraries': ['customLibrary'] });
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toEqual([]);
    editor.configure({ 'validation.jsLibraries': [] });
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toHaveLength(2);
  });

  it('rebuilds the symbol index and diagnostics when exclusions change', async () => {
    loadProject([{ ...root, contents: 'title: Root\ngo-to: target' }, { name: 'hidden/target.scene.dry', contents: 'game-over: invalid' }]);
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()[0].file).toBe('hidden/target.scene.dry');
    editor.configure({ 'validation.exclude': ['**/hidden/**'] });
    await vi.advanceTimersByTimeAsync(500);
    expect(published().map(item => item.file)).toEqual(['root.scene.dry']);
    editor.configure({ 'validation.exclude': [] });
    await vi.advanceTimersByTimeAsync(500);
    expect(published().map(item => item.file)).toEqual(['hidden/target.scene.dry']);
  });

  it('keeps workspace folders and their settings independent', async () => {
    const uris = loadProject([
      { name: 'a/root.scene.dry', contents: 'on-arrival: {! customLibrary(); missingHelper(); !}' },
      { name: 'b/root.scene.dry', contents: 'on-arrival: {! customLibrary(); missingHelper(); !}' },
    ]);
    workspace.workspaceFolders = ['a', 'b'].map((name, index) => ({ name, index, uri: uris[index].with({ path: `/compatibility/${name}` }) }));
    editor.configure({ 'validation.strict': true, 'validation.jsLibraries': ['customLibrary'] }, '/compatibility/a');
    editor.configure({ 'validation.strict': false, 'validation.jsLibraries': [] }, '/compatibility/b');
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published().filter(item => item.file === 'a/root.scene.dry')).toHaveLength(1);
    expect(published().filter(item => item.file === 'b/root.scene.dry')).toHaveLength(2);
    expect(published().find(item => item.file === 'a/root.scene.dry')!.severity).toBe(DiagnosticSeverity.Warning);
    expect(published().filter(item => item.file === 'b/root.scene.dry').every(item => item.severity === DiagnosticSeverity.Hint)).toBe(true);
    editor.configure({ 'validation.enable': false }, '/compatibility/a');
    expect(published().map(item => item.file)).toEqual(['b/root.scene.dry', 'b/root.scene.dry']);
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toHaveLength(2);
  });

  it('honors folder-specific discovery exclusions without excluding another root', async () => {
    const uris = loadProject([
      { name: 'a/root.scene.dry', contents: 'game-over: invalid' },
      { name: 'b/root.scene.dry', contents: 'game-over: invalid' },
    ]);
    workspace.workspaceFolders = ['a', 'b'].map((name, index) => ({ name, index, uri: uris[index].with({ path: `/compatibility/${name}` }) }));
    editor.configure({ 'validation.exclude': ['**/*.scene.dry'] }, '/compatibility/a');
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published().map(item => item.file)).toEqual(['b/root.scene.dry']);
  });

  it('continues indexing disabled files so other files can resolve their targets', async () => {
    loadProject([{ ...root, contents: 'title: Root\ngo-to: target' }, { name: 'target.scene.dry', contents: 'game-over: invalid' }]);
    editor.configure({ 'validation.enable': false }, '/compatibility/target.scene.dry');
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()).toEqual([]);
  });

  it('rereads saved text when closing an unsaved workspace buffer', async () => {
    loadProject([{ ...root, contents: 'game-over: invalid' }]);
    editor.writeFile(root.name, root.contents); // Saved text differs from the open buffer.
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()).toHaveLength(1);
    editor.close(workspace.textDocuments[0]);
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toEqual([]);
    expect(editor.errors).toEqual([]);
  });

  it('ignores a closed document still present in a host document-list snapshot', async () => {
    loadProject([{ ...root, contents: 'game-over: invalid' }]);
    editor.writeFile(root.name, root.contents);
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()).toHaveLength(1);
    const original = workspace.textDocuments[0];
    const closed = new Proxy(original, { get: (target, key) => key === 'isClosed' ? true : Reflect.get(target, key) });
    workspace.textDocuments[0] = closed;
    editor.events.close.fire(closed);
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toEqual([]);
  });

  it('never resurrects deleted workspace files that remain open', async () => {
    const uris = loadProject([root, { name: 'target.scene.dry', contents: 'game-over: invalid' }]);
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    editor.deleteFile(uris[1]);
    editor.watch('delete', uris[1]);
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toEqual([]);
  });

  it.each([
    ['root.scene.dry', 'game-over: invalid'],
    ['health.quality.dry', 'initial: 1'],
    ['info.dry', 'title: Game'],
    ['rating.qdisplay.dry', '\n(1.2.3..4) Bad'],
  ])('validates an open standalone %s at activation', async (name, contents) => {
    workspace.workspaceFolders = undefined;
    loadProject([{ name, contents }]);
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published().filter(item => item.severity === DiagnosticSeverity.Error)).toHaveLength(1);
  });

  it('removes standalone closed files and rechecks remaining open peers', async () => {
    workspace.workspaceFolders = [];
    loadProject([{ ...root, contents: 'title: Root\ngo-to: target' }, { name: 'target.scene.dry', contents: 'title: Target' }]);
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()).toEqual([]);
    editor.close(workspace.textDocuments[1]);
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toHaveLength(1);
    expect(published()[0].message).toContain('target');
  });

  it('validates an out-of-workspace open file independently of a workspace with the same IDs', async () => {
    const uris = loadProject([{ name: 'game/root.scene.dry', contents: 'title: Root' }, { name: 'loose/root.scene.dry', contents: 'game-over: invalid' }]);
    workspace.workspaceFolders = [{ name: 'game', index: 0, uri: uris[0].with({ path: '/compatibility/game' }) }];
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()).toHaveLength(1);
    expect(published()[0].file).toBe('loose/root.scene.dry');
    expect(published()[0].message).toContain('game-over');
  });

  it('applies exclusions to open standalone documents', async () => {
    workspace.workspaceFolders = [];
    loadProject([{ name: 'excluded/root.scene.dry', contents: 'game-over: invalid' }]);
    editor.configure({ 'validation.exclude': ['**/excluded/**'] });
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()).toEqual([]);
  });

  it('disposes watchers when deactivated', async () => {
    loadProject([root]);
    activate();
    deactivateCore();
    expect(editor.watchers.every(watcher => watcher.disposed)).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(published()).toEqual([]);
  });

  it('does not read project files when validation is disabled for the whole project', async () => {
    loadProject([{ ...root, contents: 'game-over: invalid' }]);
    workspace.textDocuments = [];
    editor.configure({ 'validation.enable': false });
    const read = vi.spyOn(workspace.fs, 'readFile');
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(read).not.toHaveBeenCalled();
    expect(published()).toEqual([]);
  });

  it('does not republish disabled diagnostics when an in-flight read completes', async () => {
    loadProject([{ ...root, contents: 'game-over: invalid' }]);
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()).toHaveLength(1);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const read = workspace.fs.readFile;
    vi.spyOn(workspace.fs, 'readFile').mockImplementationOnce(async uri => { await gate; return read(uri); });
    const target = editor.writeFile('target.scene.dry', 'title: Target');
    editor.watch('create', target);
    await vi.advanceTimersByTimeAsync(500);
    editor.configure({ 'validation.enable': false });
    expect(published()).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(published()).toEqual([]);
    editor.configure({ 'validation.enable': true });
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toHaveLength(1);
    expect(editor.errors).toEqual([]);
  });

  it('assigns files in nested workspace folders to their innermost project only', async () => {
    const uris = loadProject([root, { name: 'nested/root.scene.dry', contents: 'title: Nested' }]);
    workspace.workspaceFolders = [
      { name: 'parent', index: 0, uri: uris[0].with({ path: '/compatibility' }) },
      { name: 'child', index: 1, uri: uris[1].with({ path: '/compatibility/nested' }) },
    ];
    activate();
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()).toEqual([]);
  });
});
