"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DendryDebugConfigurationProvider = void 0;
exports.runDendryDebug = runDendryDebug;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
class DendryDebugConfigurationProvider {
    resolveDebugConfiguration(folder, config, token) {
        // If launch.json is missing or empty
        if (!config.type && !config.request && !config.name) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'dendry') {
                config.type = 'dendry';
                config.name = 'Launch Dendry';
                config.request = 'launch';
            }
        }
        if (!config.buildCommand) {
            const settings = vscode.workspace.getConfiguration('dendry.debug');
            config.buildCommand = settings.get('buildCommand', 'npm run dendrynexus make-html -- --pretty');
        }
        if (!config.outputPath) {
            const settings = vscode.workspace.getConfiguration('dendry.debug');
            config.outputPath = settings.get('outputPath', 'out/html/index.html');
        }
        return config;
    }
}
exports.DendryDebugConfigurationProvider = DendryDebugConfigurationProvider;
async function runDendryDebug(config) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
    }
    const settings = vscode.workspace.getConfiguration('dendry.debug');
    const buildCommand = config?.buildCommand || settings.get('buildCommand', 'npm run dendrynexus make-html -- --pretty');
    const outputPath = config?.outputPath || settings.get('outputPath', 'out/html/index.html');
    // Show output channel
    const outputChannel = vscode.window.createOutputChannel('Dendry Build');
    outputChannel.show();
    outputChannel.appendLine(`Building Dendry project...`);
    outputChannel.appendLine(`Command: ${buildCommand}`);
    outputChannel.appendLine(`Working directory: ${workspaceFolder.uri.fsPath}`);
    outputChannel.appendLine('');
    try {
        await runBuildCommand(buildCommand, workspaceFolder.uri.fsPath, outputChannel);
        // Build successful, open the HTML file
        const htmlPath = path.join(workspaceFolder.uri.fsPath, outputPath);
        const uri = vscode.Uri.file(htmlPath);
        outputChannel.appendLine('');
        outputChannel.appendLine(`Build successful! Opening ${htmlPath}`);
        // Open in default browser
        await vscode.env.openExternal(uri);
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine('');
        outputChannel.appendLine(`Build failed: ${errorMessage}`);
        vscode.window.showErrorMessage(`Dendry build failed: ${errorMessage}`);
    }
}
function runBuildCommand(command, cwd, outputChannel) {
    return new Promise((resolve, reject) => {
        // Parse command into executable and args
        const parts = command.split(' ');
        const executable = parts[0];
        const args = parts.slice(1);
        const process = (0, child_process_1.spawn)(executable, args, {
            cwd,
            shell: true
        });
        process.stdout.on('data', (data) => {
            outputChannel.append(data.toString());
        });
        process.stderr.on('data', (data) => {
            outputChannel.append(data.toString());
        });
        process.on('close', (code) => {
            if (code === 0) {
                resolve();
            }
            else {
                reject(new Error(`Build process exited with code ${code}`));
            }
        });
        process.on('error', (error) => {
            reject(error);
        });
    });
}
//# sourceMappingURL=debug-adapter.js.map