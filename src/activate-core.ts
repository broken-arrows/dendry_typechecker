import * as vscode from 'vscode';
import { DendryProjectValidator } from './project-validator';
import { DENDRY_FILE_GLOBS, dendryFileKind } from './file-kinds';
import { uriKey } from './uri-key';

let stopCore: (() => void) | undefined;

/** Shared desktop/web lifecycle. All queue state belongs to this activation. */
export function activateCore(context: vscode.ExtensionContext) {
    stopCore?.();
    const diagnostics = vscode.languages.createDiagnosticCollection('dendry');
    const output = vscode.window.createOutputChannel('Dendry');
    const validator = new DendryProjectValidator();
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
                    const config = vscode.workspace.getConfiguration('dendry');
                    if (!config.get('validation.enable', true)) continue;
                    const excludes = config.get<string[]>('validation.exclude', [
                        '**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/out/**',
                    ]);
                    const exclude = excludes.length > 1 ? `{${excludes.join(',')}}` : excludes[0] || undefined;
                    const files = (await Promise.all(DENDRY_FILE_GLOBS.map(pattern => vscode.workspace.findFiles(pattern, exclude)))).flat();
                    if (disposed) return;
                    const results = await validator.validateProject(files, full ? undefined : batch);
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
        diagnostics.dispose();
        output.dispose();
    };
    stopCore = dispose;
    context.subscriptions.push({ dispose });

    output.appendLine('Dendry activated');
    if (vscode.workspace.workspaceFolders?.length) startupTimer = setTimeout(() => schedule(), 1000);

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.languageId === 'dendry') schedule(event.document.uri);
        }),
        vscode.workspace.onDidSaveTextDocument(document => {
            if (document.languageId === 'dendry') schedule(document.uri);
        }),
        vscode.workspace.onDidOpenTextDocument(document => {
            if (document.languageId === 'dendry') schedule(document.uri);
        }),
        vscode.workspace.onDidDeleteFiles(event => {
            if (event.files.some(file => dendryFileKind(file.path) !== undefined)) schedule();
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => schedule()),
        vscode.workspace.onDidCloseTextDocument(document => {
            if (disposed) return;
            const key = uriKey(document.uri);
            diagnostics.delete(lastDiagnostics.get(key)?.uri || document.uri);
            lastDiagnostics.delete(key);
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
