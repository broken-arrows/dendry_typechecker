import type * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateCore, deactivateCore } from '../activate-core';
import { DendryProjectValidator } from '../project-validator';
import { DiagnosticSeverity, editor, loadProject, workspace } from './vscode-host';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function published() {
  return [...editor.collections[0].entries.values()].flatMap(({ uri, diagnostics }) =>
    diagnostics.map(diagnostic => ({ file: uri.path.split('/').pop(), ...diagnostic })));
}
function changed(index: number) { editor.events.change.fire({ document: workspace.textDocuments[index] }); }
const cleanFiles = [
  { name: 'root.scene.dry', contents: 'title: Root' },
  { name: 'other.scene.dry', contents: 'title: Other' },
];

describe('editor validation scheduling through actual activation', () => {
  let subscriptions: vscode.Disposable[];
  beforeEach(() => {
    vi.useFakeTimers();
    editor.reset();
    subscriptions = [];
    loadProject(cleanFiles);
    activateCore({ subscriptions } as vscode.ExtensionContext);
  });
  afterEach(() => {
    deactivateCore();
    for (const subscription of subscriptions) subscription.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reparses both files changed within one debounce window', async () => {
    await vi.advanceTimersByTimeAsync(1500);
    loadProject(cleanFiles.map(file => ({ ...file, contents: 'game-over: invalid' })));
    changed(0);
    await vi.advanceTimersByTimeAsync(250);
    changed(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(published()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(published().map(item => item.file).sort()).toEqual(['other.scene.dry', 'root.scene.dry']);
    expect(editor.errors).toEqual([]);
  });

  it('queues an edit whose debounce expires while file discovery is running', async () => {
    await vi.advanceTimersByTimeAsync(1500);
    const gate = deferred(), entered = deferred();
    const find = workspace.findFiles;
    vi.spyOn(workspace, 'findFiles').mockImplementationOnce(async (...args) => {
      entered.resolve(); await gate.promise; return find(...args);
    });
    loadProject([{ ...cleanFiles[0], contents: 'game-over: invalid' }, cleanFiles[1]]);
    changed(0);
    await vi.advanceTimersByTimeAsync(500);
    await entered.promise;
    loadProject(cleanFiles.map(file => ({ ...file, contents: 'game-over: invalid' })));
    changed(1);
    await vi.advanceTimersByTimeAsync(500);
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(published().map(item => item.file).sort()).toEqual(['other.scene.dry', 'root.scene.dry']);
    expect(editor.errors).toEqual([]);
  });

  it('does not publish an obsolete pass while a newer edit is still debouncing', async () => {
    await vi.advanceTimersByTimeAsync(1500);
    loadProject([{ ...cleanFiles[0], contents: 'game-over: invalid' }, cleanFiles[1]]);
    changed(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toHaveLength(1);
    const gate = deferred();
    const read = workspace.fs.readFile;
    vi.spyOn(workspace.fs, 'readFile').mockImplementationOnce(async uri => { await gate.promise; return read(uri); });
    const slow = { name: 'slow.scene.dry', contents: 'title: Slow' };
    loadProject([...cleanFiles, slow]);
    workspace.textDocuments = workspace.textDocuments.slice(0, 2);
    changed(0);
    await vi.advanceTimersByTimeAsync(500);
    // Root has already been parsed clean; reading the new closed file is gated.
    // A new invalid edit must prevent that clean snapshot from clearing errors.
    loadProject([{ ...cleanFiles[0], contents: 'game-over: invalid' }, cleanFiles[1], slow]);
    changed(0);
    const updates = editor.collections[0].updates.length;
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(editor.collections[0].updates).toHaveLength(updates);
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toHaveLength(1);
  });

  it('cancels a scheduled validation when deactivated', async () => {
    const find = vi.spyOn(workspace, 'findFiles');
    deactivateCore();
    await vi.advanceTimersByTimeAsync(2000);
    expect(find).not.toHaveBeenCalled();
  });

  it('retains dirty files when a full refresh follows an edit in the same window', async () => {
    await vi.advanceTimersByTimeAsync(1500);
    const deleted = workspace.textDocuments[1].uri;
    loadProject([{ ...cleanFiles[0], contents: 'game-over: invalid' }]);
    changed(0);
    editor.events.delete.fire({ files: [deleted] });
    await vi.advanceTimersByTimeAsync(500);
    expect(published().map(item => item.file)).toEqual(['root.scene.dry']);
  });

  it('retries failed discovery with both the failed and newly queued edits', async () => {
    await vi.advanceTimersByTimeAsync(1500);
    const gate = deferred();
    vi.spyOn(workspace, 'findFiles').mockImplementationOnce(async () => { await gate.promise; throw new Error('Read unavailable'); });
    loadProject([{ ...cleanFiles[0], contents: 'game-over: invalid' }, cleanFiles[1]]);
    changed(0);
    await vi.advanceTimersByTimeAsync(500);
    loadProject(cleanFiles.map(file => ({ ...file, contents: 'game-over: invalid' })));
    changed(1);
    await vi.advanceTimersByTimeAsync(500);
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(editor.errors).toHaveLength(1);
    expect(published().map(item => item.file).sort()).toEqual(['other.scene.dry', 'root.scene.dry']);
  });

  it('queues user-open events while an asynchronous pass is running', async () => {
    await vi.advanceTimersByTimeAsync(1500);
    const gate = deferred();
    const read = workspace.fs.readFile;
    vi.spyOn(workspace.fs, 'readFile').mockImplementationOnce(async uri => { await gate.promise; return read(uri); });
    loadProject([{ ...cleanFiles[0], contents: 'game-over: invalid' }, cleanFiles[1]]);
    const root = workspace.textDocuments[0];
    workspace.textDocuments = workspace.textDocuments.slice(1);
    editor.events.save.fire(root);
    await vi.advanceTimersByTimeAsync(500);
    loadProject(cleanFiles.map(file => ({ ...file, contents: 'game-over: invalid' })));
    editor.events.open.fire(workspace.textDocuments[1]);
    await vi.advanceTimersByTimeAsync(500);
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(published().map(item => item.file).sort()).toEqual(['other.scene.dry', 'root.scene.dry']);
  });

  it('does not publish or rerun a pass after deactivation during discovery', async () => {
    const gate = deferred();
    const find = workspace.findFiles;
    vi.spyOn(workspace, 'findFiles').mockImplementationOnce(async (...args) => { await gate.promise; return find(...args); });
    loadProject(cleanFiles.map(file => ({ ...file, contents: 'game-over: invalid' })));
    await vi.advanceTimersByTimeAsync(1500);
    changed(0);
    deactivateCore();
    gate.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(editor.collections[0].updates).toEqual([]);
    expect(editor.errors).toEqual([]);
  });

  it('keeps one diagnostic entry when event URIs have query or authority variants', async () => {
    await vi.advanceTimersByTimeAsync(1500);
    loadProject([{ ...cleanFiles[0], contents: 'game-over: invalid' }, cleanFiles[1]]);
    const virtualUri = (uri: vscode.Uri, authority: string, query: string) => ({
      ...uri, scheme: 'vscode-vfs', authority,
      toString: () => `vscode-vfs://${authority}${uri.path}?${query}`,
    } as vscode.Uri);
    const find = workspace.findFiles;
    vi.spyOn(workspace, 'findFiles').mockImplementation(async (...args) =>
      (await find(...args)).map(uri => virtualUri(uri, 'github', 'discovery')));
    workspace.textDocuments = workspace.textDocuments.map(original => new Proxy(original, {
      get: (target, key) => key === 'uri' ? virtualUri(original.uri, 'GitHub', 'open') : Reflect.get(target, key),
    }));
    changed(0);
    await vi.advanceTimersByTimeAsync(500);
    const original = workspace.textDocuments[0];
    const uri = { ...original.uri, authority: original.uri.authority.toUpperCase(), toString: () => `${original.uri.toString()}?version=2` } as vscode.Uri;
    const document = new Proxy(original, { get: (target, key) => key === 'uri' ? uri : Reflect.get(target, key) });
    workspace.textDocuments[0] = document;
    editor.events.change.fire({ document });
    await vi.advanceTimersByTimeAsync(500);
    expect(published()).toHaveLength(1);
    expect(editor.collections[0].entries).toHaveLength(1);
    expect([...editor.collections[0].entries.values()][0].uri.scheme).toBe('vscode-vfs');
    expect(editor.errors).toEqual([]);
  });
});

describe('project coordinator concurrent requests', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns settled results for edits queued during an asynchronous read', async () => {
    const validator = new DendryProjectValidator();
    let uris = loadProject(cleanFiles);
    await validator.validateProject(uris);
    const gate = deferred(), entered = deferred();
    const read = workspace.fs.readFile;
    vi.spyOn(workspace.fs, 'readFile').mockImplementationOnce(async uri => {
      entered.resolve(); await gate.promise; return read(uri);
    });
    uris = loadProject([{ ...cleanFiles[0], contents: 'game-over: invalid' }, cleanFiles[1]]);
    workspace.textDocuments = workspace.textDocuments.slice(1); // root must be read asynchronously.
    const first = validator.validateProject(uris, uris[0]);
    await entered.promise;
    uris = loadProject(cleanFiles.map(file => ({ ...file, contents: 'game-over: invalid' })));
    let settled = false;
    const second = validator.validateProject(uris, uris[1]).then(result => { settled = true; return result; });
    await Promise.resolve();
    expect(settled).toBe(false);
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    for (const result of [a, b]) {
      expect([...result.values()].flat().filter(item => item.severity === DiagnosticSeverity.Error)).toHaveLength(2);
    }
  });

  it.each([
    ['health.quality.dry', 'name: Health', 'min: not-a-number\nname: Health'],
    ['info.dry', 'title: Game\nauthor: Author', 'title: Game'],
    ['rating.qdisplay.dry', '\n(..) Good', '\n(1.2.3..4) Bad'],
  ])('reparses a batch containing a scene and %s', async (name, clean, invalid) => {
    const validator = new DendryProjectValidator();
    await validator.validateProject(loadProject([cleanFiles[0], { name, contents: clean }]));
    const uris = loadProject([{ ...cleanFiles[0], contents: 'game-over: invalid' }, { name, contents: invalid }]);
    const results = await validator.validateProject(uris, uris);
    expect([...results.values()].flat().filter(item => item.severity === DiagnosticSeverity.Error)).toHaveLength(2);
  });

  it('coalesces simultaneous calls before starting a pass', async () => {
    const validator = new DendryProjectValidator();
    await validator.validateProject(loadProject(cleanFiles));
    const uris = loadProject(cleanFiles.map(file => ({ ...file, contents: 'game-over: invalid' })));
    const first = validator.validateProject(uris, uris[0]);
    const second = validator.validateProject(uris, uris[1]);
    for (const result of await Promise.all([first, second])) expect([...result.values()].flat()).toHaveLength(2);
  });

  it('uses the latest workspace inventory when a target is deleted during a read', async () => {
    const validator = new DendryProjectValidator();
    const root = { name: 'root.scene.dry', contents: 'title: Root\ngo-to: other' };
    let uris = loadProject([root, cleanFiles[1]]);
    await validator.validateProject(uris);
    const gate = deferred(), entered = deferred();
    const oldOther = new TextEncoder().encode(cleanFiles[1].contents);
    vi.spyOn(workspace.fs, 'readFile').mockImplementationOnce(async () => { entered.resolve(); await gate.promise; return oldOther; });
    workspace.textDocuments = workspace.textDocuments.slice(0, 1);
    const oldTarget = uris[1];
    const first = validator.validateProject(uris, oldTarget);
    await entered.promise;
    uris = loadProject([root]);
    const second = validator.validateProject(uris, oldTarget);
    gate.resolve();
    for (const result of await Promise.all([first, second])) {
      expect([...result.keys()].map(uri => uri.path)).toEqual([uris[0].path]);
      expect([...result.values()].flat()[0].message).toContain('other');
      expect([...result.values()].flat()).toHaveLength(1);
    }
  });

  it.each(['\n', '\r\n'])('validates the same source snapshot as the cached AST: %j', async newline => {
    const validator = new DendryProjectValidator();
    const lines = ['title: Root', 'on-arrival: {!', 'const x=1;', '!}', 'game-over: invalid'];
    let uris = loadProject([{ ...cleanFiles[0], contents: lines.join(newline) }, cleanFiles[1]]);
    workspace.textDocuments = workspace.textDocuments.slice(0, 1);
    const gate = deferred(), entered = deferred();
    const read = workspace.fs.readFile;
    vi.spyOn(workspace.fs, 'readFile').mockImplementationOnce(async uri => { entered.resolve(); await gate.promise; return read(uri); });
    const pass = validator.validateProject(uris);
    await entered.promise;
    uris = loadProject(cleanFiles); // The old AST has fields beyond the new document's last line.
    gate.resolve();
    const results = await pass;
    const diagnostics = [...results.values()].flat();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('game-over');
    expect(diagnostics[0].range.start.line).toBe(4);
    expect([...(await validator.validateProject(uris, uris[0])).values()].flat()).toEqual([]);
  });

  it('treats a full refresh as re-reading cached files', async () => {
    const validator = new DendryProjectValidator();
    await validator.validateProject(loadProject(cleanFiles));
    const uris = loadProject(cleanFiles.map(file => ({ ...file, contents: 'game-over: invalid' })));
    expect([...(await validator.validateProject(uris)).values()].flat()).toHaveLength(2);
  });

  it('retains a read error, then recovers when the dirty file becomes readable', async () => {
    const validator = new DendryProjectValidator();
    const uris = loadProject(cleanFiles);
    await validator.validateProject(uris);
    workspace.textDocuments = workspace.textDocuments.slice(1);
    vi.spyOn(workspace.fs, 'readFile').mockRejectedValueOnce(new Error('Temporary read failure'));
    const failed = await validator.validateProject(uris, uris[0]);
    expect([...failed.values()].flat()[0].message).toContain('Temporary read failure');
    expect([...(await validator.validateProject(uris, uris[1])).values()].flat()).toHaveLength(1);
    expect([...(await validator.validateProject(uris, uris[0])).values()].flat()).toEqual([]);
  });

  it('merges cached QDisplay errors and duplicate warnings under the current URI', async () => {
    const validator = new DendryProjectValidator();
    const files = [
      { name: 'a/rating.qdisplay.dry', contents: '\n(..) [+ Q.bad +]' },
      { name: 'b/rating.qdisplay.dry', contents: '\n(..) Good' },
      cleanFiles[0],
    ];
    await validator.validateProject(loadProject(files));
    const uris = loadProject(files); // New URI objects, same logical files.
    const results = await validator.validateProject(uris, uris[2]);
    expect(results.get(uris[0])).toHaveLength(2);
    expect(results.get(uris[1])).toHaveLength(1);
    expect(results.size).toBe(2);
  });

  it('does not reintroduce an out-of-project dirty file into the symbol index', async () => {
    const validator = new DendryProjectValidator();
    const uris = loadProject([
      { name: 'root.scene.dry', contents: 'title: Root\ngo-to: outside' },
      { name: 'outside.scene.dry', contents: 'title: Outside' },
    ]);
    const results = await validator.validateProject(uris.slice(0, 1), uris[1]);
    expect([...results.keys()]).toEqual([uris[0]]);
    const diagnostics = [...results.values()].flat();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('outside');
  });
});
