import * as vscode from 'vscode';
import { DendryProjectValidator } from './project-validator';
import { dendryFileKind } from './file-kinds';
import { uriKey } from './uri-key';
import { discoverProjects } from './project-inputs';
import { validationSettings } from './validation-settings';

let stopCore: (() => void) | undefined;

/** Shared desktop/web lifecycle. All queue state belongs to this activation. */
export function activateCore(context: vscode.ExtensionContext) {
    stopCore?.();
    const diagnostics = vscode.languages.createDiagnosticCollection('dendry');
    const output = vscode.window.createOutputChannel('Dendry');
    const watcher = vscode.workspace.createFileSystemWatcher('**');
    const validators = new Map<string, DendryProjectValidator>();
    let knownFiles: vscode.Uri[] = [];
    const lastDiagnostics = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>();
    const dirtyFiles = new Map<string, vscode.Uri>();
    let fullRefresh = false;
    let generation = 0;
    let running = false;
    let ready = false;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let startupTimer: ReturnType<typeof setTimeout> | undefined;

    function schedule(uri?: vscode.Uri) {
        if (disposed) return;
        if (uri) dirtyFiles.set(uriKey(uri), uri);
        else fullRefresh = true;
        generation++;
        ready = false;
        clearTimeout(timer);
        timer = setTimeout(() => {
            timer = undefined;
            ready = true;
            void drain();
        }, 500);
    }

    function publish(current: Map<vscode.Uri, vscode.Diagnostic[]>) {
        const seen = new Set<string>();
        for (const [uri, items] of current) {
            const key = uriKey(uri), previous = lastDiagnostics.get(key);
            seen.add(key);
            if (stableDiagKey(items) !== stableDiagKey(previous?.diagnostics || [])) {
                // Retain one diagnostic URI even if a provider changes its
                // query/fragment or returns a new URI object for this file.
                const target = previous?.uri || uri;
                diagnostics.set(target, items);
                lastDiagnostics.set(key, { uri: target, diagnostics: items });
            }
        }
        for (const [key, entry] of lastDiagnostics) {
            if (!seen.has(key)) {
                diagnostics.delete(entry.uri);
                lastDiagnostics.delete(key);
            }
        }
    }

    async function drain() {
        if (running || disposed) return;
        running = true;
        try {
            while (ready && !disposed) {
                ready = false;
                const batch = [...dirtyFiles.values()];
                const full = fullRefresh;
                const revision = generation;
                dirtyFiles.clear();
                fullRefresh = false;
                try {
                    const projects = await discoverProjects();
                    if (disposed) return;
                    knownFiles = projects.flatMap(project => project.files);
                    const active = new Set(projects.map(project => project.key));
                    for (const key of validators.keys()) if (!active.has(key)) validators.delete(key);
                    const projectResults = await Promise.all(projects.map(project => {
                        if (!project.files.some(uri => validationSettings(uri).enabled)) return Promise.resolve(new Map<vscode.Uri, vscode.Diagnostic[]>());
                        let validator = validators.get(project.key);
                        if (!validator) { validator = new DendryProjectValidator(); validators.set(project.key, validator); }
                        return validator.validateProject(project.files, full ? undefined : batch);
                    }));
                    const results = new Map(projectResults.flatMap(result => [...result]));
                    // Events invalidate publication immediately, even before
                    // their debounce expires. Their queued pass will publish.
                    if (!disposed && revision === generation) publish(results);
                } catch (error) {
                    for (const uri of batch) if (!dirtyFiles.has(uriKey(uri))) dirtyFiles.set(uriKey(uri), uri);
                    fullRefresh ||= full;
                    if (!disposed) {
                        output.appendLine(`ERROR: ${error}`);
                        void vscode.window.showErrorMessage(`Dendry validation failed: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            }
        } finally {
            running = false;
        }
    }

    const dispose = () => {
        if (disposed) return;
        disposed = true;
        clearTimeout(timer);
        clearTimeout(startupTimer);
        dirtyFiles.clear();
        watcher.dispose();
        validators.clear();
        diagnostics.dispose();
        output.dispose();
    };
    stopCore = dispose;
    context.subscriptions.push({ dispose });

    output.appendLine('Dendry activated');
    startupTimer = setTimeout(() => schedule(), 1000);

    // '**' includes parent-directory deletion/move events that narrower file
    // globs miss. Ignore unrelated changes and only stat untyped creations.
    context.subscriptions.push(watcher,
        watcher.onDidChange(uri => { if (dendryFileKind(uri.path)) schedule(uri); }),
        watcher.onDidCreate(async uri => {
            if (disposed) return;
            if (dendryFileKind(uri.path)) schedule(uri);
            else {
                try {
                    if ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) schedule();
                } catch { /* A transient creation already disappeared. */ }
            }
        }),
        watcher.onDidDelete(uri => {
            const prefix = uriKey(uri).replace(/\/$/, '') + '/';
            if (dendryFileKind(uri.path) || knownFiles.some(file => uriKey(file).startsWith(prefix))) schedule();
        }),
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            if (dendryFileKind(event.document.uri.path)) schedule(event.document.uri);
        }),
        vscode.workspace.onDidSaveTextDocument(document => {
            if (dendryFileKind(document.uri.path)) schedule(document.uri);
        }),
        vscode.workspace.onDidOpenTextDocument(document => {
            if (dendryFileKind(document.uri.path)) schedule(document.uri);
        }),
        vscode.workspace.onDidCreateFiles(() => schedule()),
        vscode.workspace.onDidRenameFiles(() => schedule()),
        vscode.workspace.onDidDeleteFiles(() => schedule()),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (disposed || !event.affectsConfiguration('dendry.validation')) return;
            schedule();
            // Disabling validation clears existing findings without waiting
            // for discovery or for an in-flight pass to complete.
            for (const [key, entry] of lastDiagnostics) if (!validationSettings(entry.uri).enabled) {
                diagnostics.delete(entry.uri);
                lastDiagnostics.delete(key);
            }
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => schedule()),
        vscode.workspace.onDidCloseTextDocument(document => {
            if (disposed) return;
            if (dendryFileKind(document.uri.path)) schedule(document.uri);
        }),
    );
}

function stableDiagKey(diagnostics: readonly vscode.Diagnostic[]): string {
    return JSON.stringify(diagnostics.map(diagnostic => JSON.stringify([
        diagnostic.range.start.line, diagnostic.range.start.character,
        diagnostic.range.end.line, diagnostic.range.end.character,
        diagnostic.message, diagnostic.severity,
    ])).sort());
}

export function deactivateCore() {
    stopCore?.();
    stopCore = undefined;
}
